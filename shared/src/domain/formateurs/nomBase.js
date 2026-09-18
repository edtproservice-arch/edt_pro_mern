/**
 * Nom de base d'un formateur — la partie du nom complet qui l'identifie.
 *
 * ═══ IMPLÉMENTATION UNIQUE ═══
 * Remplace quatre fonctions concurrentes du code PHP/JS :
 *   - `getBaseName()`        includes/functions.php:18
 *   - `getFormattedName()`   includes/functions.php:54
 *   - `getBaseNameJS()`      public/emploi.html
 *   - `getFormattedName()`   public/emploi.html:6003
 *
 * ─── Décision, fondée sur la caractérisation ───
 * Confrontation des quatre sur le corpus réel (156 noms, tous les imports
 * e-note de production) : `getBaseName` et `getBaseNameJS` s'accordent sur la
 * TOTALITÉ du corpus. Ce sont les deux `getFormattedName` qui divergent.
 * C'est donc la règle de `getBaseName` qui fait foi ici.
 *
 * Divergences abandonnées, en connaissance de cause :
 *
 *   « AIT EL CADI AYOUB » (4 mots)
 *       getBaseName / getBaseNameJS / JS getFormattedName → AYOUB   ← retenu
 *       PHP getFormattedName                              → EL CADI
 *     PHP getFormattedName appliquait la règle du 2e mot court dès 3 mots,
 *     là où getBaseName la réserve à exactement 3 mots.
 *
 *   « TAIA Ahmed »
 *       les trois autres      → AHMED   ← retenu
 *       JS getFormattedName   → Ahmed
 *     La variante du navigateur ne met pas en majuscules. Utilisée comme clé,
 *     elle ne correspond alors plus à la valeur stockée — c'est une cause
 *     directe des « formateurs qui disparaissent ».
 */

/** Découpe normalisée : majuscules, espaces multiples réduits, vides écartés. */
function decouper(nomComplet) {
  return String(nomComplet ?? '')
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * @param {string} nomComplet
 * @returns {string} Nom de base, en majuscules. Chaîne vide si l'entrée l'est.
 *
 * Règles, reprises telles quelles :
 *   0 mot   → ''
 *   1 mot   → ce mot
 *   3 mots  → si le 2e fait 3 lettres ou moins : « 2e 3e » (ex. « BEN ALI »),
 *             sinon le 3e seul
 *   sinon   → le dernier mot
 *
 * La règle des 3 mots vise les particules arabes courtes — AIT, BEN, EL, OU —
 * qui font partie du nom de famille et ne doivent pas en être détachées.
 */
export function nomBase(nomComplet) {
  if (nomComplet !== null && nomComplet !== undefined && typeof nomComplet !== 'string') {
    throw new TypeError(`nomBase attend une chaîne, reçu ${typeof nomComplet}`);
  }

  const mots = decouper(nomComplet);

  if (mots.length === 0) return '';
  if (mots.length === 1) return mots[0];

  if (mots.length === 3) {
    return mots[1].length <= 3 ? `${mots[1]} ${mots[2]}` : mots[2];
  }

  return mots[mots.length - 1];
}

/** Prénom présumé : le premier mot. Convention de l'existant, conservée. */
export function prenom(nomComplet) {
  return decouper(nomComplet)[0] ?? '';
}

export { decouper };
