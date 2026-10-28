import mongoose from 'mongoose';
import { JOURS, ROLES, SEANCES, STATUTS_COMPTE, TYPES_ABSENCE } from 'shared/constants';
import {
  agregerAvancement,
  calculerBilan,
  ensemblesAReconstruire,
  estActif,
  estSalleReelle,
  libelleEspaceEmprunte,
  noteDiscipline,
  projeterSynchrones,
  reconstruireFormateurs,
  reconstruireGroupes,
  synchronesEffectifs,
  totalAvancement,
} from 'shared/domain';
import { User } from '../../models/User.js';
import { Etablissement } from '../../models/Etablissement.js';
import { Base } from '../../models/Base.js';
import { Seance } from '../../models/Seance.js';
import { AbsenceFormateur } from '../../models/AbsenceFormateur.js';
import { AbsenceStagiaire } from '../../models/AbsenceStagiaire.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { publicationCourante, semaineCourante } from '../seances/seances.service.js';
import { chargerEnsembles } from '../repartitions/ensembles.service.js';
import { RefreshToken } from '../../models/RefreshToken.js';
import { ACTIONS_AUDIT, tracer } from '../../models/AuditLog.js';
import { conflict, forbidden, notFound } from '../../lib/httpError.js';
import { bus, EVENEMENTS } from '../../lib/bus.js';
import { avancement } from '../avancement/avancement.service.js';
import { joursAbsentsConsecutifs } from '../absencesStagiaires/discipline.service.js';

/**
 * ═══ DIRECTEUR DE COMPLEXE (2026-10-27, demande du porteur) ═══
 *
 * « Le directeur crée cette session ; si les autres directeurs du même complexe ne
 * veulent pas, le directeur de complexe ne voit pas leur établissement — il ne
 * consulte que celui (ou ceux) qui l'ont autorisé. » Décisions du porteur :
 * plusieurs comptes par complexe, accord GLOBAL (tout l'établissement ou rien),
 * les chiffres seulement pour les stagiaires, création depuis « Sessions ».
 *
 * ═══ L'ACCÈS, C'EST `etablissementIds` ═══
 * Le compte n'y porte QUE les établissements qui l'ont autorisé : « autoriser »
 * l'y ajoute, « retirer » l'en ôte. `resolveTenant` refuse déjà tout autre
 * établissement — l'isolation n'a donc pas une seconde règle à tenir, elle
 * réutilise la seule qui existe.
 */

/** Le complexe d'un établissement — région comprise : deux régions ont des complexes homonymes. */
export const cleComplexe = (etablissement) =>
  `${String(etablissement?.region ?? '').trim().toLowerCase()}|${String(etablissement?.complexe ?? '').trim().toLowerCase()}`;

async function etablissementDe(etablissementId) {
  const etablissement = await Etablissement.findById(etablissementId).select('nom nomAbrege region complexe').lean();
  if (!etablissement) throw notFound('Établissement introuvable');
  return etablissement;
}

/** Un compte de directeur de complexe DU MÊME complexe que l'établissement — sinon 404. */
async function compteDuComplexe(etablissement, compteId) {
  const compte = await User.findOne({
    _id: compteId,
    role: ROLES.DIRECTEUR_COMPLEXE,
    complexe: cleComplexe(etablissement),
  });
  // ⚠️ 404 et non 403 : un directeur n'a pas à apprendre qu'un compte existe ailleurs.
  if (!compte) throw notFound('Compte introuvable');
  return compte;
}

const nomCourt = (e) => e.nomAbrege || e.nom;

/** Les comptes du complexe, vus par un de ses directeurs. */
export async function lister(etablissementId) {
  const etablissement = await etablissementDe(etablissementId);
  const comptes = await User.find({ role: ROLES.DIRECTEUR_COMPLEXE, complexe: cleComplexe(etablissement) })
    .select('nomComplet email estActif etablissementIds creeParEtablissementId createdAt')
    .sort({ nomComplet: 1 })
    .lean();

  // Les noms des établissements qui ont autorisé chacun — tous du même complexe.
  const ids = [...new Set(comptes.flatMap((c) => c.etablissementIds.map(String)))];
  const noms = new Map(
    (await Etablissement.find({ _id: { $in: ids } }).select('nom nomAbrege').lean()).map((e) => [String(e._id), nomCourt(e)])
  );

  return comptes.map((compte) => ({
    id: String(compte._id),
    nomComplet: compte.nomComplet,
    email: compte.email,
    estActif: compte.estActif,
    autorise: compte.etablissementIds.some((id) => String(id) === String(etablissementId)),
    creeParMoi: String(compte.creeParEtablissementId ?? '') === String(etablissementId),
    etablissements: compte.etablissementIds.map((id) => noms.get(String(id))).filter(Boolean).sort(),
  }));
}

/**
 * Crée un compte, d'emblée autorisé sur l'établissement qui le crée — c'est le
 * geste même de le créer.
 */
export async function creer(etablissementId, { nomComplet, email, motDePasse }, acteur, ip) {
  const etablissement = await etablissementDe(etablissementId);

  const existant = await User.findOne({ $or: [{ email }, { identifiant: email }] }).select('_id').lean();
  if (existant) throw conflict('Un compte utilise déjà cette adresse', { code: 'COMPTE_EXISTANT' });

  const compte = await User.create({
    nomComplet,
    identifiant: email,
    email,
    motDePasse,
    role: ROLES.DIRECTEUR_COMPLEXE,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
    estActif: true,
    // ⚠️ Rien à configurer : l'assistant de configuration est celui d'un directeur d'établissement.
    configurationTerminee: true,
    etablissementIds: [etablissementId],
    complexe: cleComplexe(etablissement),
    creeParEtablissementId: etablissementId,
  });

  await tracer({
    acteur,
    action: ACTIONS_AUDIT.COMPLEXE_COMPTE_CREE,
    cible: compte,
    details: { etablissementId: String(etablissementId), etablissement: nomCourt(etablissement) },
    ip,
  });
  return (await lister(etablissementId)).find((c) => c.id === String(compte._id));
}

/** Autorise le compte sur CET établissement — l'accord global du porteur : tout, en lecture. */
export async function autoriser(etablissementId, compteId, acteur, ip) {
  const etablissement = await etablissementDe(etablissementId);
  const compte = await compteDuComplexe(etablissement, compteId);
  await User.updateOne({ _id: compte._id }, { $addToSet: { etablissementIds: etablissementId } });
  await tracer({
    acteur,
    action: ACTIONS_AUDIT.COMPLEXE_ACCES_ACCORDE,
    cible: compte,
    details: { etablissementId: String(etablissementId), etablissement: nomCourt(etablissement) },
    ip,
  });
  return (await lister(etablissementId)).find((c) => c.id === String(compte._id));
}

/**
 * Retire l'accès de CET établissement.
 *
 * ⚠️ EFFET IMMÉDIAT : les requêtes suivantes sont refusées par `resolveTenant`, qui
 * relit le compte à chaque fois ; les sockets ouvertes sont fermées — la page
 * temps réel d'un établissement retiré ne doit pas continuer d'annoncer ses écritures.
 */
export async function retirer(etablissementId, compteId, acteur, ip) {
  const etablissement = await etablissementDe(etablissementId);
  const compte = await compteDuComplexe(etablissement, compteId);
  await User.updateOne({ _id: compte._id }, { $pull: { etablissementIds: etablissementId } });
  bus.emit(EVENEMENTS.SESSIONS_REVOQUEES, { utilisateurIds: [String(compte._id)] });
  await tracer({
    acteur,
    action: ACTIONS_AUDIT.COMPLEXE_ACCES_RETIRE,
    cible: compte,
    details: { etablissementId: String(etablissementId), etablissement: nomCourt(etablissement) },
    ip,
  });
  return (await lister(etablissementId)).find((c) => c.id === String(compte._id));
}

/** Supprime le compte — seul l'établissement qui l'a créé le peut. */
export async function supprimer(etablissementId, compteId, acteur, ip) {
  const etablissement = await etablissementDe(etablissementId);
  const compte = await compteDuComplexe(etablissement, compteId);
  if (String(compte.creeParEtablissementId ?? '') !== String(etablissementId)) {
    throw forbidden('Seul l’établissement qui a créé ce compte peut le supprimer', { code: 'PAS_CREATEUR' });
  }
  await tracer({
    acteur,
    action: ACTIONS_AUDIT.COMPLEXE_COMPTE_SUPPRIME,
    cible: compte,
    details: { etablissementId: String(etablissementId), autorisesAlors: compte.etablissementIds.map(String) },
    ip,
  });
  await RefreshToken.deleteMany({ utilisateurId: compte._id });
  await User.deleteOne({ _id: compte._id });
  bus.emit(EVENEMENTS.SESSIONS_REVOQUEES, { utilisateurIds: [String(compte._id)] });
  return { supprime: true };
}

/**
 * ═══ LE TABLEAU DE BORD DU COMPLEXE ═══ Une carte par établissement AUTORISÉ :
 * ses effectifs, et son avancement — calculé par la MÊME fonction que la page
 * « Avancement », pour qu'un chiffre ne puisse jamais différer d'un écran à l'autre.
 *
 * ⚠️ DES CHIFFRES, AUCUN NOM DE STAGIAIRE (décision du porteur). Un établissement
 * en panne de données ne fait pas tomber les autres : sa carte le dit.
 */
export async function tableau(utilisateur) {
  const etablissements = await Etablissement.find({ _id: { $in: utilisateur.etablissementIds ?? [] } })
    .select('nom nomAbrege region complexe anneeScolaire espacesMutualises')
    .sort({ nom: 1 })
    .lean();

  const cartes = await Promise.all(
    etablissements.map(async (etablissement) => {
      const id = String(etablissement._id);
      const anneeScolaire = etablissement.anneeScolaire;
      try {
        // ⚠️ LA BASE ENTIÈRE : la carte se reconstruit à partir d'elle (filières, modes, synchrones).
        const base = await Base.findOne({ etablissementId: id, anneeScolaire }).lean();
        /* Sans base, l'avancement n'a rien à calculer : le dire, plutôt qu'une panne
           anonyme — c'est une alerte à part entière pour le complexe. */
        if (!base) return { id, nom: nomCourt(etablissement), anneeScolaire, sansBase: true };
        const [donnees, publication, vieScolaire] = await Promise.all([
          avancement(id, anneeScolaire),
          publicationCourante(id, anneeScolaire),
          vieScolaireEnChiffres(id, anneeScolaire),
        ]);
        const lignesEdtpro = donnees.faces?.edtpro ?? [];
        return {
          id,
          nom: nomCourt(etablissement),
          anneeScolaire,
          effectifs: {
            groupes: base?.groupes?.length ?? 0,
            formateurs: base?.formateurs?.length ?? 0,
            affectations: base?.affectations?.length ?? 0,
          },
          edtpro: totalAvancement(lignesEdtpro),
          enote: donnees.source ? totalAvancement(donnees.faces?.enote ?? []) : null,
          enoteImporteLe: donnees.source?.importeLe ?? null,
          semaineCourante: donnees.semaineCourante ?? null,
          regional: donnees.regional?.taux ?? null,
          groupes: statutsDesGroupes(lignesEdtpro, donnees.regional),
          // La courbe de la page Avancement, semaine par semaine — l'accueil la superpose aux autres.
          progression: (donnees.progression ?? [])
            .filter((point) => point.numero <= SEMAINES_ANNEE)
            .map(({ numero, libelle, avancement: taux, regional, vacances }) => ({ numero, libelle, avancement: taux, regional, vacances })),
          modules: modulesParAvancement(lignesEdtpro, donnees),
          vieScolaire,
          publication,
          affectation: await bilanAffectation(base),
          espacesPretes: (etablissement.espacesMutualises ?? []).length,
        };
      } catch (erreur) {
        return { id, nom: nomCourt(etablissement), anneeScolaire, erreur: 'Données indisponibles' };
      }
    })
  );

  return { etablissements: cartes };
}

/*
 * ═══ L'ÉCART AU RYTHME RÉGIONAL, PAR GROUPE (2026-10-27) ═══ Les mêmes seuils
 * que l'accueil du directeur d'établissement (`STATUTS` de
 * `TableauDeBordAccueil`) : en retard sous −2 points, critique sous −10.
 */
const SEUIL_RETARD = -2;
const SEUIL_CRITIQUE = -10;

function statutsDesGroupes(lignes, regional) {
  const groupes = agregerAvancement(lignes, 'groupe').filter((groupe) => groupe.prevu > 0);
  if (!regional) return { total: groupes.length, enRetard: 0, critiques: 0 };
  const ecarts = groupes.map((groupe) => (groupe.taux ?? 0) - regional.taux);
  return {
    total: groupes.length,
    enRetard: ecarts.filter((ecart) => ecart < SEUIL_RETARD && ecart >= SEUIL_CRITIQUE).length,
    critiques: ecarts.filter((ecart) => ecart < SEUIL_CRITIQUE).length,
  };
}

/** Les semaines de l'année régionale — la courbe s'arrête là, comme chez le directeur. */
const SEMAINES_ANNEE = 39;

/** Un module (d'un groupe) est « bientôt terminé » entre ces deux taux : son EFM approche. */
const BIENTOT_TERMINE = 80;

/**
 * ═══ LES MODULES PAR AVANCEMENT (2026-10-27, demande du porteur : séparer les
 * tuiles, un graphe par statistique — puis « je veux lister ») ═══ Chaque module
 * d'un groupe, rangé dans sa tranche — pas commencé, moins de 50 %, de 50 à 80 %,
 * bientôt terminé (80 % ou plus), achevé —, et la LISTE complète : l'écran montre
 * les modules de la tranche choisie. Des codes de modules et des groupes, aucun
 * nom de stagiaire.
 */
function modulesParAvancement(lignes, donnees) {
  const tranches = { nonCommence: 0, debut: 0, milieu: 0, bientot: 0, acheve: 0 };
  const liste = [];
  for (const ligne of lignes) {
    const [module] = agregerAvancement([ligne], 'module');
    if (!module || !(module.prevu > 0)) continue;
    const valeur = module.taux ?? 0;
    const tranche =
      valeur >= 100 ? 'acheve' : valeur >= BIENTOT_TERMINE ? 'bientot' : valeur >= 50 ? 'milieu' : valeur > 0 ? 'debut' : 'nonCommence';
    tranches[tranche] += 1;
    liste.push({
      groupe: ligne.groupe,
      module: ligne.module,
      intitule: donnees.intitulesParGroupe?.[`${ligne.groupe}||${ligne.module}`] ?? donnees.intitules?.[ligne.module] ?? '',
      taux: valeur,
      realise: module.realise,
      prevu: module.prevu,
      tranche,
    });
  }
  return { tranches, liste: liste.sort((a, b) => b.taux - a.taux || String(a.groupe).localeCompare(String(b.groupe))) };
}

/** Le palier de la grille d'assiduité, par sa gravité — les familles de `BadgeSanction`. */
const NIVEAUX_SANCTION = ['mise-en-garde', 'avertissement', 'blame', 'exclusion'];

/** Une absence qui s'étend sur au moins ces jours successifs signale un risque d'abandon. */
const SERIE_ABANDON = 3;

/**
 * ═══ LA VIE SCOLAIRE EN CHIFFRES (2026-10-27) ═══ Combien de stagiaires ont
 * atteint chaque famille de sanction de la grille d'assiduité, et combien ont
 * manqué au moins trois jours successifs — les mêmes règles que les seuils de
 * l'accueil du directeur (`noteDiscipline`, `joursAbsentsConsecutifs`).
 * ⚠️ DES COMPTES, JAMAIS UN NOM DE STAGIAIRE (décision du porteur).
 */
async function vieScolaireEnChiffres(etablissementId, anneeScolaire) {
  const correspondance = { etablissementId: new mongoose.Types.ObjectId(etablissementId), anneeScolaire };
  const [cumuls, jours] = await Promise.all([
    AbsenceStagiaire.aggregate([
      { $match: { ...correspondance, justifiee: { $ne: true } } },
      {
        $group: {
          _id: '$matricule',
          seances: { $sum: { $cond: [{ $eq: ['$typeAbsence', TYPES_ABSENCE.RETARD] }, 0, 1] } },
          retards: { $sum: { $cond: [{ $eq: ['$typeAbsence', TYPES_ABSENCE.RETARD] }, 1, 0] } },
        },
      },
    ]),
    AbsenceStagiaire.aggregate([
      { $match: { ...correspondance, typeAbsence: { $ne: TYPES_ABSENCE.RETARD } } },
      { $group: { _id: { matricule: '$matricule', date: '$date' }, absent: { $max: 1 } } },
    ]),
  ]);

  const seuils = Object.fromEntries(NIVEAUX_SANCTION.map((niveau) => [niveau, 0]));
  for (const { seances, retards } of cumuls) {
    const niveau = noteDiscipline({ seancesAbsentes: seances, retards }).assiduite.sanction?.niveau;
    if (niveau) seuils[niveau] += 1;
  }
  const series = joursAbsentsConsecutifs(jours);
  const risqueAbandon = [...series.values()].filter((serie) => serie.jours >= SERIE_ABANDON).length;
  return { seuils, risqueAbandon };
}

/** Au-delà, les noms des formateurs en dépassement sont comptés, pas listés. */
const SURCHARGES_NOMMEES = 5;

/**
 * ═══ L'AFFECTATION D'UN ÉTABLISSEMENT (2026-10-27, demande du porteur : « l'offre
 * et la demande en l'affectation ») ═══ Les tuiles de la page Affectation —
 * Offre (affecté / statutaire), Demande (couvert / total), modules non affectés,
 * formateurs en dépassement — calculées comme elle : la carte reconstruite depuis
 * la base et la répartition DRIF (`useCarteEnregistree`), les synchrones par
 * défaut (`useCarte`), puis `calculerBilan`. Le même calcul, donc les mêmes chiffres.
 */
async function bilanAffectation(base) {
  const { ensembles } = ensemblesAReconstruire(base);
  const referentiel = new Map(Object.entries(await chargerEnsembles(ensembles)));
  const reconstruits = reconstruireGroupes(base, referentiel);
  const groupes = projeterSynchrones(reconstruits, synchronesEffectifs(reconstruits, {}));
  const bilan = calculerBilan({ groupes, formateurs: reconstruireFormateurs(base) });

  let modules = 0;
  let affectes = 0;
  for (const groupe of groupes) {
    for (const module of groupe.modules ?? []) {
      if (!estActif(module)) continue;
      modules += 1;
      if (module.formateurPresentiel) affectes += 1;
    }
  }

  return {
    offre: bilan.offre,
    demande: bilan.demande,
    modules,
    nonAffectes: modules - affectes,
    surcharges: {
      nombre: bilan.surcharges.length,
      heures: bilan.reconciliation.surcharge,
      noms: bilan.surcharges.slice(0, SURCHARGES_NOMMEES).map((f) => ({ nom: f.nom, depassement: f.depassement })),
    },
    disponible: bilan.reconciliation.disponible,
  };
}

/*
 * ═══ ÉTAPE 2 (2026-10-27) — FORMATEURS, ESPACES, ABSENCES ═══
 * Toujours sur les établissements AUTORISÉS seuls (`etablissementIds`), et pour
 * l'année en cours de chacun. Des chiffres et des noms de PERSONNEL ; jamais un
 * nom de stagiaire (décision du porteur).
 */
async function etablissementsAutorises(utilisateur, champs = 'nom nomAbrege anneeScolaire') {
  return Etablissement.find({ _id: { $in: utilisateur.etablissementIds ?? [] } })
    .select(champs)
    .sort({ nom: 1 })
    .lean();
}

const cleFormateur = (f) => {
  const matricule = String(f.matricule ?? '').trim().toUpperCase();
  return matricule !== '' ? `M:${matricule}` : `N:${String(f.nomComplet ?? '').trim().toUpperCase()}`;
};

const centieme = (valeur) => Math.round(valeur * 100) / 100;

/**
 * Les formateurs du complexe : masse statutaire et heures AFFECTÉES, par
 * établissement — et ceux qui enseignent dans PLUSIEURS établissements du
 * complexe (mutualisés), reconnus à leur matricule, avec leur charge cumulée.
 */
export async function formateurs(utilisateur) {
  const etablissements = await etablissementsAutorises(utilisateur);
  const parCle = new Map();

  await Promise.all(
    etablissements.map(async (etablissement) => {
      const base = await Base.findOne({ etablissementId: etablissement._id, anneeScolaire: etablissement.anneeScolaire })
        .select('formateurs affectations')
        .lean();
      if (!base) return;

      // Heures affectées par identifiant d'affectation (matricule, ou nom en repli).
      const heures = new Map();
      for (const a of base.affectations ?? []) {
        const id = String(a.formateur ?? '').trim().toUpperCase();
        heures.set(id, (heures.get(id) ?? 0) + Number(a.s1Heures ?? 0) + Number(a.s2Heures ?? 0));
      }

      for (const f of base.formateurs ?? []) {
        const cle = cleFormateur(f);
        const affectees =
          heures.get(String(f.matricule ?? '').trim().toUpperCase()) ??
          heures.get(String(f.nomComplet ?? '').trim().toUpperCase()) ??
          0;
        const fiche = parCle.get(cle) ?? { cle, nomComplet: f.nomComplet, matricule: f.matricule ?? '', parEtablissement: [] };
        fiche.parEtablissement.push({
          etablissementId: String(etablissement._id),
          etablissement: nomCourt(etablissement),
          masseHoraire: Number(f.masseHoraire ?? 0),
          heuresAffectees: centieme(affectees),
        });
        parCle.set(cle, fiche);
      }
    })
  );

  const liste = [...parCle.values()]
    .map((fiche) => ({
      ...fiche,
      parEtablissement: fiche.parEtablissement.sort((a, b) => a.etablissement.localeCompare(b.etablissement)),
      heuresAffectees: centieme(fiche.parEtablissement.reduce((s, e) => s + e.heuresAffectees, 0)),
      mutualise: fiche.parEtablissement.length > 1,
    }))
    .sort((a, b) => String(a.nomComplet).localeCompare(String(b.nomComplet)));

  return { etablissements: etablissements.map((e) => ({ id: String(e._id), nom: nomCourt(e) })), formateurs: liste };
}

/** Créneaux d'une semaine de JOUR : 6 jours × 4 séances — la grille de l'emploi du temps. */
const CRENEAUX_JOUR_PAR_SEMAINE = 6 * 4;
/** Les séances de jour — S5 est celle du soir. */
const SEANCES_JOUR = SEANCES.slice(0, 4);

/**
 * Les espaces : chaque salle, et combien de créneaux de jour elle occupe la
 * semaine en cours — la même semaine que celle qu'ouvrent les écrans.
 */
export async function espaces(utilisateur, { maintenant = new Date(), semaine: demandee = null } = {}) {
  const etablissements = await etablissementsAutorises(utilisateur, 'nom nomAbrege anneeScolaire espaces espacesMutualises');

  // Les créneaux de jour occupés de chaque établissement, la semaine en cours : (salle, jour, séance).
  const occupations = new Map(
    await Promise.all(
      etablissements.map(async (etablissement) => {
        const filtre = { etablissementId: etablissement._id, anneeScolaire: etablissement.anneeScolaire };
        const courante = semaineCourante(etablissement.anneeScolaire, maintenant);
        /*
         * ⚠️ LA SEMAINE DEMANDÉE, SINON LA COURANTE — ET SI ELLE EST VIDE, LA DERNIÈRE
         * REMPLIE AVANT ELLE (2026-10-27) : un lundi matin, la semaine qui commence
         * n'a souvent pas encore d'emploi du temps ; tout afficher à 0 ferait croire
         * à des salles vides. L'écran dit quelle semaine il montre.
         */
        let semaine = demandee ? `${etablissement.anneeScolaire}-W${demandee}` : courante;
        let repli = false;
        if (!demandee && !(await Seance.exists({ ...filtre, semaine }))) {
          const numero = (valeur) => Number(/W(\d+)$/.exec(valeur)?.[1] ?? 0);
          const remplies = (await Seance.distinct('semaine', filtre)).filter((v) => numero(v) <= numero(courante));
          const derniere = remplies.sort((a, b) => numero(b) - numero(a))[0];
          if (derniere) {
            semaine = derniere;
            repli = true;
          }
        }
        const lignes = await Seance.aggregate([
          {
            $match: {
              etablissementId: etablissement._id,
              anneeScolaire: etablissement.anneeScolaire,
              semaine,
              periode: 'jour',
              salle: { $ne: '' },
              // Une séance marquée absente ne tient pas sa salle.
              statut: { $ne: 'absent' },
            },
          },
          // Un créneau compte une fois par salle, même partagé par plusieurs groupes (fusion).
          { $group: { _id: { salle: '$salle', jour: '$jour', seance: '$seance' } } },
        ]);
        // ⚠️ SEULES LES PIÈCES RÉELLES : « TEAMS » ou le distanciel n'occupent aucune salle.
        return [
          String(etablissement._id),
          { semaine, courante, repli, lignes: lignes.map((l) => l._id).filter((o) => estSalleReelle(o.salle)) },
        ];
      })
    )
  );

  /*
   * ═══ LES ESPACES MUTUALISÉS (2026-10-27, demande du porteur) ═══ Une pièce
   * prêtée porte deux noms : le sien chez son propriétaire, « Salle 4 (NOM
   * OFFICIEL) » chez l'emprunteur (`libelleEspaceEmprunte`). Son occupation
   * RÉELLE réunit donc les créneaux des deux — ce qu'aucun des deux directeurs
   * ne voit seul. Un emprunteur qui n'a pas autorisé le directeur de complexe est
   * nommé, mais ses créneaux restent illisibles : on le dit.
   */
  const autorises = new Map(etablissements.map((e) => [String(e._id), e]));
  const partenaires = await Etablissement.find({
    _id: { $in: etablissements.flatMap((e) => (e.espacesMutualises ?? []).map((m) => m.etablissementId)) },
  })
    .select('nom nomAbrege')
    .lean();
  const nomDe = new Map(partenaires.map((e) => [String(e._id), nomCourt(e)]));
  const libellesEmpruntes = new Set();
  const mutualises = [];
  for (const proprietaire of etablissements) {
    const parEspace = new Map();
    for (const { espace, etablissementId } of proprietaire.espacesMutualises ?? []) {
      if (!parEspace.has(espace)) parEspace.set(espace, []);
      parEspace.get(espace).push(String(etablissementId));
    }
    for (const [espace, emprunteurs] of parEspace) {
      const libelle = libelleEspaceEmprunte(espace, proprietaire.nom);
      libellesEmpruntes.add(libelle.toUpperCase());
      const creneauxDe = (etablissementId, salle) =>
        (occupations.get(etablissementId)?.lignes ?? []).filter((o) => o.salle.toUpperCase() === salle.toUpperCase());
      const union = new Set();
      const proprietaireId = String(proprietaire._id);
      const parEtablissement = [proprietaireId, ...emprunteurs].map((id) => {
        const lisible = autorises.has(id);
        const creneaux = lisible ? creneauxDe(id, id === proprietaireId ? espace : libelle) : [];
        for (const o of creneaux) union.add(`${o.jour}|${o.seance}`);
        return {
          nom: id === proprietaireId ? nomCourt(proprietaire) : (nomDe.get(id) ?? 'Établissement supprimé'),
          proprietaire: id === proprietaireId,
          lisible,
          creneaux: creneaux.length,
        };
      });
      mutualises.push({
        espace,
        proprietaire: nomCourt(proprietaire),
        parEtablissement,
        creneaux: union.size,
        taux: Math.round((union.size / CRENEAUX_JOUR_PAR_SEMAINE) * 1000) / 10,
      });
    }
  }

  const cartes = etablissements.map((etablissement) => {
    const { semaine, courante, repli, lignes } = occupations.get(String(etablissement._id));
    // Les salles PROPRES : un espace emprunté se lit dans les mutualisés, chez son propriétaire.
    const propres = lignes.filter((o) => !libellesEmpruntes.has(o.salle.toUpperCase()));
    const parSalle = new Map();
    for (const o of propres) parSalle.set(o.salle, (parSalle.get(o.salle) ?? 0) + 1);
    const salles = [...new Set([...(etablissement.espaces ?? []).filter(estSalleReelle), ...parSalle.keys()])]
      .map((nom) => {
        const creneaux = parSalle.get(nom) ?? 0;
        return { nom, creneaux, taux: Math.round((creneaux / CRENEAUX_JOUR_PAR_SEMAINE) * 1000) / 10 };
      })
      .sort((a, b) => b.taux - a.taux || a.nom.localeCompare(b.nom));
    const total = salles.reduce((s, x) => s + x.creneaux, 0);

    // La carte de chaleur : combien de ses salles sont prises, à chaque créneau de la semaine.
    const grille = {};
    for (const o of propres) {
      const cle = `${o.jour}|${o.seance}`;
      grille[cle] = (grille[cle] ?? 0) + 1;
    }
    return {
      id: String(etablissement._id),
      nom: nomCourt(etablissement),
      semaine,
      courante,
      repli,
      salles,
      grille,
      tauxMoyen: salles.length ? Math.round((total / (salles.length * CRENEAUX_JOUR_PAR_SEMAINE)) * 1000) / 10 : null,
    };
  });

  return {
    creneauxParSemaine: CRENEAUX_JOUR_PAR_SEMAINE,
    jours: JOURS,
    seances: SEANCES_JOUR,
    etablissements: cartes,
    mutualises: mutualises.sort((a, b) => b.taux - a.taux),
  };
}

/**
 * Les absences, EN CHIFFRES : formateurs (rattrapées ou non), stagiaires
 * (absences, retards, justifiées). Sur l'année, et sur les 30 derniers jours.
 * ⚠️ Aucun nom : ni de stagiaire, ni de formateur absent — des totaux.
 */
export async function absences(utilisateur, { maintenant = new Date() } = {}) {
  const etablissements = await etablissementsAutorises(utilisateur);
  const depuis = new Date(maintenant.getTime() - 30 * 24 * 3600 * 1000);
  const depuisJour = depuis.toISOString().slice(0, 10);

  const cartes = await Promise.all(
    etablissements.map(async (etablissement) => {
      const filtre = { etablissementId: etablissement._id, anneeScolaire: etablissement.anneeScolaire };
      const rattrapee = { $or: [{ dateRattrapage: { $ne: null } }, { seanceRattrapageId: { $ne: null } }] };
      const [formateursAnnee, formateursRattrapees, formateurs30, stagiaires, effectif, parJour] = await Promise.all([
        AbsenceFormateur.countDocuments(filtre),
        AbsenceFormateur.countDocuments({ ...filtre, ...rattrapee }),
        AbsenceFormateur.countDocuments({ ...filtre, dateAbsence: { $gte: depuis } }),
        AbsenceStagiaire.aggregate([
          { $match: filtre },
          {
            $group: {
              _id: null,
              absences: { $sum: { $cond: [{ $eq: ['$typeAbsence', TYPES_ABSENCE.ABSENCE] }, 1, 0] } },
              retards: { $sum: { $cond: [{ $eq: ['$typeAbsence', TYPES_ABSENCE.RETARD] }, 1, 0] } },
              justifiees: { $sum: { $cond: ['$justifiee', 1, 0] } },
              recentes: { $sum: { $cond: [{ $gte: ['$date', depuisJour] }, 1, 0] } },
            },
          },
        ]),
        /*
         * ⚠️ L'EFFECTIF, POUR UN TAUX PAR STAGIAIRE (2026-10-27) : « 412 absences »
         * dans un grand établissement et « 150 » dans un petit ne se comparent pas.
         * Un stagiaire compte une fois, même inscrit dans deux groupes.
         */
        Stagiaire.distinct('matricule', filtre).then((matricules) => matricules.length),
        // L'évolution par semaine : les absences (retards exclus) jour par jour — l'écran regroupe.
        AbsenceStagiaire.aggregate([
          { $match: { ...filtre, typeAbsence: { $ne: TYPES_ABSENCE.RETARD } } },
          { $group: { _id: '$date', n: { $sum: 1 } } },
        ]),
      ]);
      const s = stagiaires[0] ?? { absences: 0, retards: 0, justifiees: 0, recentes: 0 };
      return {
        id: String(etablissement._id),
        nom: nomCourt(etablissement),
        formateurs: {
          annee: formateursAnnee,
          rattrapees: formateursRattrapees,
          aRattraper: formateursAnnee - formateursRattrapees,
          trenteJours: formateurs30,
        },
        stagiaires: {
          absences: s.absences,
          retards: s.retards,
          justifiees: s.justifiees,
          trenteJours: s.recentes,
          effectif,
          parStagiaire: effectif > 0 ? Math.round((s.absences / effectif) * 10) / 10 : null,
        },
        parJour: parJour.map(({ _id, n }) => ({ date: _id, absences: n })),
      };
    })
  );

  return { etablissements: cartes };
}
