/**
 * La primitive de date du projet : un jour « AAAA-MM-JJ ».
 *
 * ═══ ⚠️ ELLE VIT DANS SON PROPRE FICHIER POUR ÉVITER UN CYCLE ═══
 * (extraite de `calendrier.js` le 2026-09-02.) `calendrier.js` a besoin de la
 * règle de rentrée, et `rentree.js` a besoin de cette conversion : les deux
 * s'importaient l'un l'autre. Un cycle d'imports « marche » en ESM jusqu'au jour
 * où l'ordre d'évaluation change et rend une constante `undefined` sans erreur —
 * piège déjà consigné dans ce projet. Une primitive partagée par les deux ne
 * peut appartenir à ni l'un ni l'autre.
 *
 * ═══ LES DATES SONT DES CHAÎNES, PAS DES `Date` ═══
 * Choix repris de l'existant, et pour la même raison : un `Date` stocké à minuit
 * UTC et relu au Maroc rend la VEILLE. Comparer des chaînes « AAAA-MM-JJ » —
 * dont l'ordre alphabétique est l'ordre chronologique — supprime la question.
 */

/** Convertit une Date ou une chaîne en jour « AAAA-MM-JJ » local. */
export function enJour(valeur) {
  if (typeof valeur === 'string') {
    const correspondance = /^(\d{4}-\d{2}-\d{2})/.exec(valeur.trim());
    return correspondance ? correspondance[1] : null;
  }
  if (valeur instanceof Date && !Number.isNaN(valeur.getTime())) {
    const p = (n) => String(n).padStart(2, '0');
    return `${valeur.getFullYear()}-${p(valeur.getMonth() + 1)}-${p(valeur.getDate())}`;
  }
  return null;
}
