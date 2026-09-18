import { conflict } from './httpError.js';

/**
 * Version optimiste des pages « tout ou rien » (Phase 5bis, étape d3).
 *
 * ═══ LE PROBLÈME ═══
 * Espaces, stages, formations, groupes FQ, calendrier, carte d'affectations,
 * planning d'un groupe de chronogramme : chacune de ces écritures REMPLACE la
 * liste entière par celle que l'écran envoie. Deux personnes sur la même page,
 * et la seconde efface le travail de la première sans que rien ne le dise.
 *
 * ═══ LA RÈGLE (décision du porteur, 2026-09-12) ═══
 * « Refus si modifiée entre-temps ». Chaque ressource porte un compteur ;
 * l'écran renvoie celui qu'il a lu, et l'écriture ne passe que s'il n'a pas
 * bougé — sinon 409 `VERSION_PERIMEE`, et l'écran recharge.
 *
 * ⚠️ LA COMPARAISON ET L'ÉCRITURE SONT UNE SEULE OPÉRATION (le compteur est
 * dans le FILTRE de la mise à jour, et `$inc` dans la mise à jour) : lire puis
 * écrire en deux temps laisserait passer deux écritures lancées au même instant.
 *
 * ⚠️ LA VERSION EST FACULTATIVE. Sans elle, l'écriture passe sans condition —
 * c'est le cas de l'assistant de configuration, qui écrit une page que personne
 * d'autre ne peut encore voir, et des appelants antérieurs à cette règle.
 */

/**
 * Le morceau de filtre qui exige la version `version` sur le champ `chemin`.
 *
 * ⚠️ LA VERSION 0 ACCEPTE AUSSI UN CHAMP ABSENT : les documents écrits avant
 * cette règle ne portent pas de compteur, et Mongoose leur prête la valeur par
 * défaut À LA LECTURE seulement. Sans cette branche, l'écran lirait 0, le
 * renverrait, et le filtre `{ chemin: 0 }` ne trouverait rien — le tout premier
 * enregistrement de chaque établissement serait refusé en 409.
 *
 * @param {string} chemin  ex. `versions.espaces`
 * @param {number | undefined} version
 */
export function conditionVersion(chemin, version) {
  if (version === undefined || version === null) return {};
  return version === 0
    ? { $or: [{ [chemin]: 0 }, { [chemin]: { $exists: false } }] }
    : { [chemin]: version };
}

export const versionPerimee = () =>
  conflict('Cette page a été modifiée entre-temps par quelqu’un d’autre. Elle a été rechargée.', {
    code: 'VERSION_PERIMEE',
  });

/** Une clé unique violée — l'insertion d'un `upsert` dont le filtre n'a rien trouvé. */
export const estDoublon = (erreur) => erreur?.code === 11000;
