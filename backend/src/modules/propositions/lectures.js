import { PERIODES, TYPES_COURS } from 'shared/constants';
import {
  SALLE_DISTANCIEL,
  SEANCES_JOUR,
  analyserSemaine,
  cleModule,
  fichesModules,
  indexerContraintes,
  optionsDuFormateur,
  salleParDefaut,
} from 'shared/domain';
import { Chronogramme } from '../../models/Chronogramme.js';
import { Message } from '../../models/Message.js';
import { Seance } from '../../models/Seance.js';
import { User } from '../../models/User.js';
import { depuisMongo } from '../chronogramme/chronogramme.service.js';
import { tachesDeLaSemaine } from '../generation/taches.js';
import { lister as listerContraintes } from '../base/contraintes.service.js';
import { heuresAnnee } from '../seances/seances.service.js';

/**
 * Propositions d'emploi du temps — les LECTURES (Phase 9 b) : l'emploi actuel
 * du formateur, ce que le chronogramme prévoit, ce que les collègues ont déjà
 * proposé. Aucune écriture ici.
 */

/** Une proposition qui retient encore des créneaux. */
export const STATUTS_OUVERTS = ['en_attente', 'partielle'];

export const enSeance = ({ jour, seance, groupe, module, salle }) => ({
  jour,
  seance,
  groupe,
  module,
  salle: salle ?? '',
});

/**
 * Ce que le CHRONOGRAMME prévoit pour ce formateur cette semaine-là.
 * ← `propLoadChrono()` de inbox.html
 *
 * ⚠️ LA MÊME JOINTURE QUE LA GÉNÉRATION (`tachesDeLaSemaine`) : chronogramme ×
 * affectations, fusion des synchrones sous leur libellé, `ceil(heures / 2,5)`
 * séances. L'existant la réécrivait dans la page, en retrouvant le formateur
 * par son NOM (`propMatchesFormateur`) — une cinquième copie, et la moins sûre.
 *
 * La salle proposée : TEAMS pour un synchrone, sinon le premier espace préféré
 * du formateur (ses contraintes), sinon aucune — il la choisira.
 *
 * @returns {Array<{groupe, module, type, nombre, salle}>}
 */
export async function seancesAImporter(etablissementId, anneeScolaire, semaine, matricule, base) {
  const analyse = analyserSemaine(semaine);
  if (!analyse || !base) return [];

  const [chronogrammes, contraintes] = await Promise.all([
    Chronogramme.find({ etablissementId, anneeScolaire }).select('groupe planning').lean(),
    listerContraintes(etablissementId, anneeScolaire),
  ]);

  const { taches } = tachesDeLaSemaine({
    // ⚠️ `.lean()` rend un objet nu : `depuisMongo` attend une `Map`.
    chronogrammes: chronogrammes.map((c) => ({
      groupe: c.groupe,
      planning: depuisMongo(new Map(Object.entries(c.planning ?? {}))),
    })),
    affectations: base.affectations ?? [],
    groupes: base.groupes ?? [],
    numero: analyse.numero,
  });

  const salle = salleParDefaut(indexerContraintes(contraintes), matricule);
  const cle = String(matricule).trim().toUpperCase();

  return taches
    .filter((t) => String(t.formateurMatricule).trim().toUpperCase() === cle)
    .map((t) => ({
      groupe: t.groupeLibelle,
      module: t.module,
      type: t.type,
      nombre: t.seancesRequises,
      salle: t.type === TYPES_COURS.SYNCHRONE ? SALLE_DISTANCIEL : salle,
    }))
    .sort((a, b) => a.groupe.localeCompare(b.groupe, 'fr', { numeric: true }) || a.module.localeCompare(b.module));
}

/**
 * Ce que le directeur a saisi pour ce formateur (page Formateurs → contraintes) :
 *  · ses créneaux INDISPONIBLES — AFFICHÉS, JAMAIS BLOQUANTS (demande du
 *    porteur, 2026-09-23 : « ne fige pas, seulement affiché ») ;
 *  · ses ESPACES attribués — le premier est PRÉSÉLECTIONNÉ quand il ajoute une
 *    séance à la main, et il peut en changer (demande du porteur, 2026-09-23).
 *
 * @returns {{indisponibilites: Array<{jour, seance}>, espaces: string[]}}
 */
export async function contraintesDu(etablissementId, anneeScolaire, matricule) {
  const cle = String(matricule).trim();
  const contraintes = await listerContraintes(etablissementId, anneeScolaire);
  const sienne = contraintes.find((c) => String(c.formateur).trim() === cle);
  return { indisponibilites: sienne?.indisponibilites ?? [], espaces: sienne?.espaces ?? [] };
}

/**
 * Semestre, ⭐ régional et heures prévues / posées de CHAQUE module du formateur —
 * ce que la liste des modules de la page Emploi affiche (demande du porteur,
 * 2026-09-23 : « comme celui en emploi du directeur »).
 *
 * ⚠️ LES MÊMES FONCTIONS QUE LA PAGE EMPLOI : `fichesModules` (prévu, semestre,
 * régional) et `heuresAnnee` → `heuresPosees` (posé sur l'année). L'écran en
 * tire le taux par `avancementModule`, comme la grille du directeur — trois
 * chiffres identiques des deux côtés, ou aucun.
 *
 * ⚠️ RÉDUIT AUX MODULES DU FORMATEUR : la carte entière n'a pas à partir chez
 * lui, et l'écran n'en lirait qu'une poignée.
 *
 * @returns {{fiches: object, posees: object}} indexés par `cleModule(groupe, module)`
 */
export async function indicateursDesModules(etablissementId, anneeScolaire, base, matricule) {
  const { modulesParGroupe } = optionsDuFormateur(base?.affectations ?? [], matricule);
  const cles = new Set();
  for (const [groupe, modules] of modulesParGroupe) {
    for (const module of modules) cles.add(cleModule(groupe, module));
  }

  const [toutesFiches, { posees: toutesPosees }] = [
    fichesModules(base?.affectations ?? []),
    await heuresAnnee(etablissementId, anneeScolaire),
  ];

  const fiches = {};
  const posees = {};
  for (const cle of cles) {
    if (toutesFiches.has(cle)) fiches[cle] = toutesFiches.get(cle);
    if (toutesPosees[cle]) posees[cle] = toutesPosees[cle];
  }
  return { fiches, posees };
}

/** Les séances de JOUR (S1-S4) d'un formateur sur une semaine. */
export function seancesDuFormateur(etablissementId, anneeScolaire, semaine, matricule, { jour, session = null } = {}) {
  return Seance.find({
    etablissementId,
    anneeScolaire,
    semaine,
    formateurMatricule: matricule,
    periode: PERIODES.JOUR,
    seance: { $in: SEANCES_JOUR },
    ...(jour && { jour }),
  })
    .session(session)
    .lean();
}

/**
 * Ce que les COLLÈGUES ont proposé et que le directeur n'a pas encore traité.
 *
 * ⚠️ JOUR PAR JOUR : un jour déjà appliqué est dans les séances réelles, un jour
 * refusé ne retient plus rien. Seuls les jours en attente réservent encore.
 */
export async function reservationsDesCollegues(etablissementId, semaine, utilisateurId) {
  const messages = await Message.find({
    'proposition.etablissementId': etablissementId,
    'proposition.semaine': semaine,
    'proposition.statut': { $in: STATUTS_OUVERTS },
    expediteurId: { $ne: utilisateurId },
  })
    .select('expediteurId proposition.seances proposition.jours')
    .lean();

  const noms = await nomsDes(messages.map((m) => m.expediteurId));

  return messages.map((m) => ({
    auteur: noms.get(String(m.expediteurId)) ?? 'Un collègue',
    seances: (m.proposition.seances ?? [])
      .filter((s) => (m.proposition.jours?.[s.jour] ?? 'en_attente') === 'en_attente')
      .map(enSeance),
  }));
}

/** Ma proposition encore ouverte pour cette semaine — que l'écran rouvre. */
export async function propositionEnCours(etablissementId, semaine, utilisateurId) {
  const message = await Message.findOne({
    expediteurId: utilisateurId,
    'proposition.etablissementId': etablissementId,
    'proposition.semaine': semaine,
    'proposition.statut': { $in: STATUTS_OUVERTS },
  })
    .sort({ createdAt: -1 })
    .select('proposition createdAt')
    .lean();

  if (!message) return null;
  return {
    id: String(message._id),
    statut: message.proposition.statut,
    jours: message.proposition.jours ?? {},
    seances: (message.proposition.seances ?? []).map(enSeance),
    envoyeeLe: message.createdAt,
  };
}

async function nomsDes(ids) {
  const comptes = await User.find({ _id: { $in: ids } }).select('nomComplet').lean();
  return new Map(comptes.map((c) => [String(c._id), c.nomComplet]));
}
