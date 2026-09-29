import { estSalleReelle, groupesSeCroisent } from '../emploi/conflits.js';

/**
 * Ce qu'un collègue a DÉJÀ proposé sur ce créneau — la case « RÉSERVÉ ».
 * ← `getConflict()` de inbox.html (et le bloc « conflictColleague » de
 *   `propRenderGrid()`)
 *
 * Décision du porteur (2026-09-23) : ces cases BLOQUENT, comme dans l'existant.
 * Deux formateurs qui proposent le même groupe au même moment, c'est la
 * certitude que le directeur devra en refuser un.
 *
 * ═══ CE QUI CHANGE PAR RAPPORT À L'EXISTANT ═══
 *  · Le groupe se compare par `groupesSeCroisent` : fusions découpées, groupes
 *    FQ descendus vers leurs constituants, suffixes de secteur respectés.
 *    L'existant découpait sur les espaces et comparait les chaînes — « GE101
 *    (GC) » y devenait deux groupes, « GE101 » et « (GC) ».
 *  · La salle passe par `estSalleReelle` : TEAMS et ABSENT ne sont pas des
 *    locaux, dix groupes peuvent être en TEAMS en même temps.
 *
 * @param {{jour, seance, groupe, salle}} seance  la séance qu'on veut proposer
 * @param {Array<{auteur: string, seances: Array}>} propositions
 *        les propositions EN ATTENTE des collègues, pour la même semaine
 * @param {object} [options]
 * @param {Array} [options.groupesFq]
 * @returns {{type: 'groupe'|'salle', auteur: string, message: string, seance: object}|null}
 */
export function conflitAvecCollegues(seance, propositions = [], { groupesFq = [] } = {}) {
  for (const { auteur, seances = [] } of propositions) {
    for (const autre of seances) {
      if (autre.jour !== seance.jour || autre.seance !== seance.seance) continue;

      if (groupesSeCroisent(seance.groupe, autre.groupe, groupesFq)) {
        return {
          type: 'groupe',
          auteur,
          message: `${autre.groupe} est déjà proposé par ${auteur} sur ce créneau`,
          seance: autre,
        };
      }

      const salle = String(seance.salle ?? '').trim();
      if (estSalleReelle(salle) && String(autre.salle ?? '').trim().toUpperCase() === salle.toUpperCase()) {
        return {
          type: 'salle',
          auteur,
          message: `L’espace ${salle} est déjà demandé par ${auteur} sur ce créneau`,
          seance: autre,
        };
      }
    }
  }

  return null;
}

/**
 * Toutes les séances d'une proposition qui heurtent celle d'un collègue.
 * C'est le contrôle que le SERVEUR rejoue à l'envoi : l'existant ne le faisait
 * qu'à l'écran, et deux formateurs qui envoyaient au même moment passaient tous
 * les deux.
 */
export function conflitsAvecCollegues(seances = [], propositions = [], options = {}) {
  return seances
    .map((seance) => ({ seance, conflit: conflitAvecCollegues(seance, propositions, options) }))
    .filter(({ conflit }) => conflit !== null);
}
