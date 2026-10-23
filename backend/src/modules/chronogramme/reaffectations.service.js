import mongoose from 'mongoose';
import {
  SALLE_DISTANCIEL,
  analyserSemaine,
  changementsDeTitulaire,
  cleReaffectation,
  detecterReaffectations,
  dureeSeance,
  separerFusion,
  typeChronogramme,
} from 'shared/domain';
import { Base } from '../../models/Base.js';
import { Reaffectation } from '../../models/Reaffectation.js';
import { Seance } from '../../models/Seance.js';
import { User } from '../../models/User.js';
import { badRequest, notFound } from '../../lib/httpError.js';

/**
 * ═══ LES RÉAFFECTATIONS EN COURS D'ANNÉE (2026-10-22, demande du porteur) ═══
 * Voir `shared/domain/chronogramme/reaffectation.js` pour la règle. Ce service
 * en fournit les deux sources — le journal et l'emploi du temps — et écrit le
 * journal quand la carte change de titulaire.
 */

const majuscules = (valeur) => String(valeur ?? '').trim().toUpperCase();

/** Le nom d'un formateur de la base, par matricule (ou nom, à défaut). */
function nommer(base, cle) {
  const recherche = majuscules(cle);
  const formateur = (base?.formateurs ?? []).find(
    (candidat) =>
      majuscules(candidat.matricule) === recherche || majuscules(candidat.nomComplet) === recherche
  );
  return formateur?.nomComplet ?? String(cle ?? '').trim();
}

/**
 * Écrit dans le journal les changements de titulaire d'un enregistrement de la
 * carte. Appelé DANS la transaction qui remplace la base : c'est le seul
 * instant où l'on voit les deux versions.
 *
 * ⚠️ EN DEUX TEMPS : la carte s'enregistre toute seule pendant la saisie. On
 *    efface le nom (retrait : `nouveau` vide), puis on choisit le successeur —
 *    l'arrivée complète alors l'entrée restée sans successeur.
 *
 * @returns {Promise<number>} les réaffectations journalisées
 */
export async function journaliser({ etablissementId, anneeScolaire, avant, apres, auteur = null, session = null }) {
  const changements = changementsDeTitulaire(avant, apres);
  let journalisees = 0;

  for (const changement of changements) {
    const filtre = {
      etablissementId,
      anneeScolaire,
      groupe: changement.groupe,
      module: changement.module,
      type: changement.type,
    };
    if (changement.ancien) {
      await Reaffectation.updateOne(
        { ...filtre, ancien: changement.ancien },
        { $set: { nouveau: changement.nouveau, auteur } },
        { upsert: true, session }
      );
      journalisees += 1;
    } else {
      await Reaffectation.updateMany(
        { ...filtre, nouveau: '' },
        { $set: { nouveau: changement.nouveau } },
        { session }
      );
    }
  }

  return journalisees;
}

/**
 * Les séances de l'emploi qui disent QUI a enseigné quoi, et quelle semaine.
 *
 * ⚠️ NE COMPTENT PAS : les absences (le cours n'a pas eu lieu), les séances
 *    rattrapées et les rattrapages (ils tombent souvent après la bascule, et
 *    feraient croire l'ancien encore titulaire), les surveillances d'EFM (ce
 *    n'est pas un cours).
 */
async function seancesConsolidees(etablissementId, anneeScolaire) {
  const lignes = await Seance.aggregate([
    {
      $match: {
        etablissementId: new mongoose.Types.ObjectId(String(etablissementId)),
        anneeScolaire: Number(anneeScolaire),
        statut: { $nin: ['absent', 'rattrape'] },
        estEfm: { $ne: true },
        rattrapageDe: null,
        module: { $nin: ['', null] },
      },
    },
    {
      $group: {
        _id: {
          formateur: '$formateurMatricule',
          groupe: '$groupe',
          module: '$module',
          semaine: '$semaine',
          distanciel: {
            $eq: [{ $toUpper: { $trim: { input: { $ifNull: ['$salle', ''] } } } }, SALLE_DISTANCIEL],
          },
        },
        // Les créneaux de la semaine : leurs heures sont celles qu'il a FAITES (2026-10-23).
        creneaux: { $push: '$seance' },
      },
    },
  ]);

  return lignes.map(({ _id, creneaux }) => ({
    formateur: _id.formateur,
    groupe: _id.groupe,
    module: _id.module,
    type: _id.distanciel ? 'S' : 'P',
    numero: analyserSemaine(_id.semaine)?.numero ?? 0,
    heures: (creneaux ?? []).reduce((somme, creneau) => somme + dureeSeance(creneau), 0),
  }));
}

/**
 * Les réaffectations de l'année : clé (groupe, module, type) → anciens
 * titulaires, avec leur nom, leur bascule, la date et l'auteur du journal.
 *
 * @param {object} base — la base de l'année (déjà lue par l'appelant)
 * @returns {Promise<Map<string, Array>>}
 */
export async function reaffectationsDeLAnnee(etablissementId, anneeScolaire, base) {
  if (!base) return new Map();

  const [seances, journal] = await Promise.all([
    seancesConsolidees(etablissementId, anneeScolaire),
    Reaffectation.find({ etablissementId, anneeScolaire }).lean(),
  ]);

  const identifiants = [...new Set(journal.flatMap((e) => [e.auteur, e.basculePar]).filter(Boolean).map(String))];
  const comptes = identifiants.length
    ? await User.find({ _id: { $in: identifiants } }).select('nomComplet').lean()
    : [];
  const nomsComptes = new Map(comptes.map((compte) => [String(compte._id), compte.nomComplet]));

  const detectees = detecterReaffectations({
    affectations: base.affectations ?? [],
    seances,
    journal: journal.map((entree) => ({
      ...entree,
      id: String(entree._id),
      date: entree.createdAt ?? null,
      auteur: nomsComptes.get(String(entree.basculePar ?? entree.auteur ?? '')) ?? null,
    })),
  });

  for (const anciens of detectees.values()) {
    for (const ancien of anciens) ancien.nom = nommer(base, ancien.ancien);
  }
  return detectees;
}

/** Les anciens d'un module d'un groupe, par type — la forme que lit l'écran. */
export function reaffectationsDuModule(reaffectations, groupe, module) {
  const P = reaffectations?.get(cleReaffectation(groupe, module, 'P')) ?? [];
  const S = reaffectations?.get(cleReaffectation(groupe, module, 'S')) ?? [];
  return P.length > 0 || S.length > 0 ? { P, S } : null;
}

/**
 * Fixe à la main la dernière semaine de l'ancien titulaire — ou la rend à
 * l'emploi du temps (`derniereSemaine: null`).
 *
 * ⚠️ UNE RÉAFFECTATION RETROUVÉE DANS L'EMPLOI N'A PAS ENCORE D'ENTRÉE : elle
 *    est créée ici, avec les titulaires actuels pour successeurs.
 */
export async function fixerBascule(
  etablissementId,
  anneeScolaire,
  { groupe, module, type, ancien, derniereSemaine, ignoree = false },
  utilisateurId = null
) {
  const base = await Base.findOne({ etablissementId, anneeScolaire }).select('affectations groupes');
  if (!base) throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });
  if (!(base.groupes ?? []).includes(groupe)) {
    throw badRequest(`Le groupe « ${groupe} » n’existe pas dans la base`, { code: 'GROUPE_INCONNU' });
  }

  const leType = typeChronogramme(type);
  const titulaires = (base.affectations ?? [])
    .filter(
      (a) =>
        majuscules(a.module) === majuscules(module) &&
        typeChronogramme(a.type) === leType &&
        separerFusion(a.groupe).some((g) => majuscules(g) === majuscules(groupe))
    )
    .map((a) => String(a.formateur ?? '').trim())
    .filter(Boolean);

  if (titulaires.some((titulaire) => majuscules(titulaire) === majuscules(ancien))) {
    throw badRequest('Ce formateur est encore titulaire du module : il n’y a pas de bascule à fixer.', {
      code: 'TITULAIRE_ACTUEL',
    });
  }

  const entree = await Reaffectation.findOneAndUpdate(
    { etablissementId, anneeScolaire, groupe, module, type: leType, ancien: String(ancien).trim() },
    {
      $set: {
        derniereSemaine: ignoree ? null : (derniereSemaine ?? null),
        ignoree: Boolean(ignoree),
        basculePar: utilisateurId,
      },
      $setOnInsert: { nouveau: titulaires.join(' · '), auteur: utilisateurId },
    },
    { upsert: true, new: true }
  ).lean();

  return { id: String(entree._id), derniereSemaine: entree.derniereSemaine };
}
