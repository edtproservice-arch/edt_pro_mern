/**
 * Masses horaires d'une ligne de base e-note.
 *
 * ← includes/functions.php:220 (enoteMassesHoraires)
 *
 * La base e-note donne deux totaux — présentiel (colonne AJ) et synchrone
 * (colonne AK) — sans les détailler par semestre. On leur applique la
 * répartition S1/S2 des colonnes X et AB, qui correspond déjà au total dans la
 * grande majorité des lignes. Sans répartition exploitable, tout est porté sur
 * le S1 pour préserver la somme.
 *
 * Ces heures alimentent tout le module d'avancement (F7), où un écart d'arrondi
 * est immédiatement visible et contesté par les établissements. D'où le soin
 * apporté à `arrondir()` ci-dessous.
 */

/** Colonnes lues, en notation e-note. */
export const COLONNES_MASSES = {
  partS1: 23, // X
  partS2: 27, // AB
  masseHorairePresentiel: 35, // AJ  — MHP
  masseHoraireSynchrone: 36, // AK  — MHSYN
};

/**
 * Nombre à partir d'une cellule Excel.
 * La virgule décimale française est acceptée, comme dans l'existant.
 */
function nombre(valeur) {
  const texte = String(valeur ?? '0').trim().replace(',', '.');
  const resultat = Number.parseFloat(texte);
  return Number.isFinite(resultat) ? resultat : 0;
}

/**
 * Arrondi à 2 décimales, reproduisant `round()` de PHP.
 *
 * Deux écarts avec `Math.round()` qu'il faut neutraliser :
 *
 *  1. PHP arrondit les demis **en s'éloignant de zéro** (-2.5 → -3), là où
 *     `Math.round` les arrondit vers le haut (-2.5 → -2).
 *  2. PHP corrige l'imprécision des flottants avant d'arrondir. Sans cela,
 *     1.005 — stocké 1.00499999… — donnerait 1.00 au lieu de 1.01.
 *
 * Vérifié sur les 522 combinaisons réelles de production.
 */
export function arrondir(valeur, decimales = 2) {
  const facteur = 10 ** decimales;
  const ajuste = Number((valeur * facteur).toPrecision(15));
  const arrondi = ajuste >= 0 ? Math.round(ajuste) : -Math.round(-ajuste);
  return arrondi / facteur;
}

/**
 * Répartit un total entre les deux semestres, au prorata de partS1/partS2.
 *
 * `s2` est calculé par SOUSTRACTION et non par sa propre multiplication :
 * c'est ce qui garantit que `s1 + s2` retombe exactement sur le total, sans
 * centième perdu à l'arrondi.
 */
function repartir(total, partS1, base) {
  if (total <= 0) return { s1: 0, s2: 0, total: 0 };
  if (base <= 0) return { s1: total, s2: 0, total };

  const s1 = arrondir(total * (partS1 / base));
  return { s1, s2: arrondir(total - s1), total };
}

/**
 * @param {Array<string|number>} ligne  Ligne brute de la base e-note.
 * @returns {{presentiel: {s1,s2,total}, synchrone: {s1,s2,total}}}
 */
export function massesHoraires(ligne, colonnes = COLONNES_MASSES) {
  if (!Array.isArray(ligne)) {
    throw new TypeError('massesHoraires attend une ligne (tableau de cellules)');
  }

  const partS1 = nombre(ligne[colonnes.partS1]);
  const partS2 = nombre(ligne[colonnes.partS2]);
  const base = partS1 + partS2;

  return {
    presentiel: repartir(nombre(ligne[colonnes.masseHorairePresentiel]), partS1, base),
    synchrone: repartir(nombre(ligne[colonnes.masseHoraireSynchrone]), partS1, base),
  };
}
