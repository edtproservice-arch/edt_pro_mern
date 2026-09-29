/**
 * Les rentrées RETENUES pour chaque année scolaire — l'ancre de S1.
 * (2026-09-28, défaut signalé par le porteur : la barre annonçait « S1 du 7 au
 * 13 sept » quand la grille datait son lundi du 31/08.)
 *
 * ═══ POURQUOI UN REGISTRE, ET PAS UN PARAMÈTRE DE PLUS ═══
 * Depuis le 2026-09-25, S1 est la semaine de la rentrée la plus précoce. La
 * rentrée voyageait en paramètre (`rentrees`) — et, OMISE, le calcul retombait
 * sans un mot sur le 1er septembre. Relevé le 2026-09-28 : **~45 appels sur une
 * soixantaine** ne la passaient pas — en-tête et calendrier de la grille, date
 * enregistrée des séances, absences, rattrapages, fermetures, exports, import
 * e-note, génération, semaine courante… La même semaine avait deux dates selon
 * l'écran. C'est le constat §4.2 du plan à l'échelle d'une date : une règle
 * que chaque appelant doit se rappeler finit par être oubliée.
 *
 * Ici, l'ancre d'une année est CONNUE une fois pour toutes : le serveur la
 * retient au démarrage et à chaque lecture ou enregistrement du calendrier
 * national, l'écran à l'ouverture de l'application. Tout calcul qui ne reçoit
 * pas de rentrées explicites s'y réfère.
 *
 * ⚠️ UNE RENTRÉE EXPLICITE L'EMPORTE TOUJOURS : les appelants qui la passaient
 *    déjà ne changent pas de comportement, et un test peut fixer la sienne.
 * ⚠️ SANS RIEN DE RETENU, RIEN NE CHANGE : l'ancre reste le 1er septembre.
 */
const retenues = new Map();

/** Retient les rentrées d'une année scolaire (remplace les précédentes). */
export function retenirRentrees(annee, rentrees = []) {
  if (!Number.isInteger(annee)) {
    throw new TypeError('retenirRentrees attend une année entière');
  }
  if (!Array.isArray(rentrees)) {
    throw new TypeError('retenirRentrees attend une liste de rentrées');
  }
  retenues.set(
    annee,
    rentrees
      .filter((r) => r && r.date)
      .map((r) => ({ anneeFormation: r.anneeFormation, date: String(r.date).slice(0, 10) }))
  );
}

/** Les rentrées retenues pour cette année — une liste vide si aucune. */
export function rentreesRetenues(annee) {
  return retenues.get(annee) ?? [];
}

/**
 * Les rentrées à employer : celles de l'appelant s'il en donne, sinon celles
 * retenues pour l'année.
 */
export function rentreesPour(annee, explicites) {
  return Array.isArray(explicites) && explicites.length > 0 ? explicites : rentreesRetenues(annee);
}

/** Oublie tout — pour les tests, qui ne doivent pas se transmettre d'ancre. */
export function oublierRentrees() {
  retenues.clear();
}
