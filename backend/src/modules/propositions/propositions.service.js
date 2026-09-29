import { TYPES_COURS } from 'shared/constants';
import {
  conflitsAvecCollegues,
  ecartsAuMode,
  estProtegee,
  libelleSemaine,
  modeDeProposition,
  normaliserProposition,
  optionsDuFormateur,
  semaineProposable,
} from 'shared/domain';
import { Base } from '../../models/Base.js';
import { Etablissement } from '../../models/Etablissement.js';
import { Message } from '../../models/Message.js';
import { badRequest, conflict, notFound } from '../../lib/httpError.js';
import { envoyer } from '../messagerie/messagerie.service.js';
import { publicationCourante } from '../seances/seances.service.js';
import {
  STATUTS_OUVERTS,
  enSeance,
  contraintesDu,
  indicateursDesModules,
  propositionEnCours,
  reservationsDesCollegues,
  seancesAImporter,
  seancesDuFormateur,
} from './lectures.js';

/**
 * Propositions d'emploi du temps — côté FORMATEUR (F10, Phase 9 b).
 * ← `openProposition()` / `submitProposition()` de inbox.html, et
 *   api/messaging/get_proposals_conflicts.php
 *
 * ═══ CE QUI CHANGE PAR RAPPORT À L'EXISTANT ═══
 *  · La proposition est un SOUS-DOCUMENT du message, plus un JSON collé dans le
 *    corps et relu par expression régulière.
 *  · Le formateur est désigné par son MATRICULE, pris dans SON compte. L'existant
 *    retrouvait sa grille en cherchant son nom dans les clés du blob — le
 *    mécanisme des « formateurs qui disparaissent ».
 *  · Les contrôles de l'écran sont REJOUÉS ici : semaine publiée, cases
 *    réservées par un collègue, affectations. L'existant ne les faisait qu'à
 *    l'écran — deux formateurs qui envoyaient au même moment passaient tous deux.
 */

function matriculeDe(utilisateur) {
  const matricule = String(utilisateur?.identifiant ?? '').trim();
  if (matricule === '') {
    throw badRequest('Votre compte ne porte pas de matricule de formateur', { code: 'MATRICULE_ABSENT' });
  }
  return matricule;
}

/**
 * Tout ce qu'il faut à l'écran pour composer une proposition.
 *
 * ⚠️ LA GRILLE PART DE L'EMPLOI ACTUEL (comme `propLoadEDT`) : c'est ce qui fait
 * qu'un créneau laissé vide signifie « retirez cette séance » à l'application.
 */
export async function preparer(etablissementId, anneeScolaire, utilisateur, maintenant = new Date()) {
  const matricule = matriculeDe(utilisateur);
  const publication = await publicationCourante(etablissementId, anneeScolaire);
  const { semaine, ouverte, motif } = semaineProposable(anneeScolaire, {
    maintenant,
    semainePubliee: publication?.semaine ?? null,
  });

  const [base, etablissement, actuelles, reservees, enCours] = await Promise.all([
    Base.findOne({ etablissementId, anneeScolaire }).select('affectations groupes').lean(),
    Etablissement.findById(etablissementId).select('espaces groupesFq').lean(),
    seancesDuFormateur(etablissementId, anneeScolaire, semaine, matricule),
    reservationsDesCollegues(etablissementId, semaine, utilisateur.id),
    propositionEnCours(etablissementId, semaine, utilisateur.id),
  ]);

  /*
   * ═══ DEUX LISTES, COMME LA PAGE EMPLOI (porteur, 2026-09-23) ═══
   * En TEAMS, seuls les libellés FUSIONNÉS (« OPCM101 OPCM102 ») : la séance à
   * distance est donnée une fois pour tous. En salle, les groupes UN PAR UN : on
   * ne réunit pas deux classes dans une pièce. C'est le filtre `type` de
   * `optionsDuFormateur`, celui de la grille du directeur.
   */
  const enListes = (type) => {
    const options = optionsDuFormateur(base?.affectations ?? [], matricule, { type });
    return { groupes: options.groupes, modulesParGroupe: Object.fromEntries(options.modulesParGroupe) };
  };
  const [aImporter, contraintes, indicateurs] = await Promise.all([
    seancesAImporter(etablissementId, anneeScolaire, semaine, matricule, base),
    contraintesDu(etablissementId, anneeScolaire, matricule),
    indicateursDesModules(etablissementId, anneeScolaire, base, matricule),
  ]);

  return {
    semaine,
    libelle: libelleSemaine(semaine, { court: true }),
    ouverte,
    motif,
    mode: modeDeProposition({ actuelles, aImporter }),
    aImporter,
    indisponibilites: contraintes.indisponibilites,
    espacesAttribues: contraintes.espaces,
    indicateurs,
    actuelles: actuelles.map((s) => ({ ...enSeance(s), protegee: estProtegee(s) })),
    reservees,
    enCours,
    options: {
      presentiel: enListes(TYPES_COURS.PRESENTIEL),
      synchrone: enListes(TYPES_COURS.SYNCHRONE),
    },
    espaces: etablissement?.espaces ?? [],
    groupesFq: etablissement?.groupesFq ?? [],
  };
}

/**
 * Envoie la proposition au directeur.
 *
 * ⚠️ UNE NOUVELLE PROPOSITION REMPLACE LA PRÉCÉDENTE (décision du 2026-09-23) —
 * l'existant refusait (`already_submitted`). Sauf si le directeur en a déjà
 * appliqué une partie : la remplacer rendrait ses jours appliqués impossibles à
 * retirer proprement. Le formateur doit alors passer par le directeur.
 */
export async function soumettre(etablissementId, anneeScolaire, utilisateur, entree, maintenant = new Date()) {
  const matricule = matriculeDe(utilisateur);

  let proposition;
  try {
    proposition = normaliserProposition(entree);
  } catch (erreur) {
    if (erreur.code === 'PROPOSITION_INVALIDE') {
      throw badRequest(erreur.message, { code: 'PROPOSITION_INVALIDE' });
    }
    throw erreur;
  }

  const publication = await publicationCourante(etablissementId, anneeScolaire);
  const { semaine, ouverte, motif } = semaineProposable(anneeScolaire, {
    maintenant,
    semainePubliee: publication?.semaine ?? null,
  });
  if (!ouverte) {
    throw conflict(
      motif === 'publiee'
        ? `L’emploi du temps de la ${libelleSemaine(semaine, { court: true })} est déjà publié : il ne se propose plus`
        : 'La semaine suivante n’appartient pas à l’année scolaire active',
      { code: motif === 'publiee' ? 'SEMAINE_PUBLIEE' : 'SEMAINE_HORS_ANNEE' }
    );
  }

  const [base, etablissement, actuelles, reservees, enCours] = await Promise.all([
    Base.findOne({ etablissementId, anneeScolaire }).select('affectations groupes').lean(),
    Etablissement.findById(etablissementId).select('proprietaireId groupesFq').lean(),
    seancesDuFormateur(etablissementId, anneeScolaire, semaine, matricule),
    reservationsDesCollegues(etablissementId, semaine, utilisateur.id),
    Message.find({
      expediteurId: utilisateur.id,
      'proposition.etablissementId': etablissementId,
      'proposition.semaine': semaine,
      'proposition.statut': { $in: STATUTS_OUVERTS },
    })
      .select('proposition.statut')
      .lean(),
  ]);

  if (!etablissement) throw notFound('Établissement introuvable', { code: 'ETABLISSEMENT_INCONNU' });

  // ⚠️ Les mêmes options que `poser()` : ce qui passerait ici serait refusé à l'application.
  const options = optionsDuFormateur(base?.affectations ?? [], matricule);
  const horsAffectation = proposition.seances.filter(
    (s) => !(options.modulesParGroupe.get(s.groupe) ?? []).includes(s.module)
  );
  if (horsAffectation.length > 0) {
    throw badRequest('Certaines séances ne correspondent à aucune de vos affectations', {
      code: 'AFFECTATION_ABSENTE',
      details: horsAffectation.map((s) => ({
        jour: s.jour,
        seance: s.seance,
        message: `${s.jour} ${s.seance} : « ${s.module} » avec ${s.groupe} ne vous est pas affecté`,
      })),
    });
  }

  /*
   * ═══ LES TROIS CAS DU PORTEUR (2026-09-23) ═══ Emploi planifié : déplacer
   * seulement. Chronogramme : importer puis déplacer. Sinon : libre. L'écran
   * cache les boutons ; c'est ici que la règle tient.
   */
  const aImporter = await seancesAImporter(etablissementId, anneeScolaire, semaine, matricule, base);
  const mode = modeDeProposition({ actuelles, aImporter });
  const ecarts = ecartsAuMode({ mode, seances: proposition.seances, actuelles, aImporter });
  if (ecarts.length > 0) {
    throw badRequest(
      mode === 'deplacer'
        ? 'Votre emploi de cette semaine est déjà planifié : vous pouvez seulement déplacer vos séances'
        : 'Les séances de cette semaine viennent du chronogramme : importez-les, puis déplacez-les',
      { code: 'MODE_NON_RESPECTE', details: ecarts.map((message) => ({ message })) }
    );
  }

  const conflits = conflitsAvecCollegues(proposition.seances, reservees, {
    groupesFq: etablissement.groupesFq ?? [],
  });
  if (conflits.length > 0) {
    throw conflict('Des créneaux sont déjà réservés par un collègue', {
      code: 'CRENEAU_RESERVE',
      details: conflits.map(({ seance, conflit }) => ({
        jour: seance.jour,
        seance: seance.seance,
        type: conflit.type,
        message: `${seance.jour} ${seance.seance} : ${conflit.message}`,
      })),
    });
  }

  if (enCours.some((m) => m.proposition.statut === 'partielle')) {
    throw conflict('Le directeur a déjà appliqué une partie de votre proposition pour cette semaine', {
      code: 'PROPOSITION_EN_COURS',
    });
  }

  const libelle = libelleSemaine(semaine, { court: true });
  const { ids } = await envoyer(utilisateur.id, {
    destinataires: [String(etablissement.proprietaireId)],
    sujet: `Proposition d’emploi du temps — ${libelle}`,
    corps:
      proposition.motif ||
      `${utilisateur.nomComplet} vous propose son emploi du temps pour la semaine ${libelle}.`,
    proposition: {
      etablissementId,
      anneeScolaire,
      semaine,
      formateurMatricule: matricule,
      seances: proposition.seances,
      motif: proposition.motif,
    },
  });

  /*
   * ⚠️ L'ANCIENNE N'EST MARQUÉE « REMPLACÉE » QU'APRÈS L'ENVOI RÉUSSI : l'ordre
   * inverse laisserait le directeur sans aucune proposition si l'envoi échouait.
   */
  if (enCours.length > 0) {
    await Message.updateMany(
      { _id: { $in: enCours.map((m) => m._id) } },
      { $set: { 'proposition.statut': 'remplacee' } }
    );
  }

  return { id: ids[0], semaine, remplacees: enCours.length };
}
