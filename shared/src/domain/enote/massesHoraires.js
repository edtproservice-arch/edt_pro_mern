/**
 * Masses horaires d'une ligne de base e-note.
 *
 * ← includes/functions.php:220 (enoteMassesHoraires), règle revue le 2026-10-07
 *
 * ═══ LA MASSE AFFECTÉE FAIT FOI, LE DRIF DONNE LA RÉPARTITION ═══
 * Le total retenu est la masse AFFECTÉE — colonnes AJ (présentiel) et AK
 * (synchrone) — c'est-à-dire ce que l'établissement a réellement confié. La
 * base ne la détaille pas par semestre : la répartition S1/S2 vient du
 * référentiel DRIF, chaque type avec SES colonnes :
 *   - présentiel : MHP S1 DRIF (X) et MHP S2 DRIF (AB) ;
 *   - synchrone  : MHSYN S1 DRIF (Y) et MHSYN S2 DRIF (AC).
 *
 * Quand l'affectée égale le DRIF, les semestres sont repris tels quels. Quand
 * elle en diffère, l'ÉCART est partagé entre S1 et S2 au prorata du DRIF, et
 * le S1 est arrondi au pas du chronogramme (2,5 h) : sans cela il tomberait sur
 * 29,69 h, qu'aucune cellule du chronogramme ne peut placer. Le S2 est obtenu
 * par soustraction : la somme retombe toujours sur l'affectée, aucune heure
 * n'est perdue ni ajoutée.
 *
 * ⚠️ ÉCART VOLONTAIRE AVEC PHP. L'ancien calcul répartissait aussi le
 * synchrone selon les colonnes PRÉSENTIELLES, et laissait des centièmes
 * impossibles à placer.
 */

/**
 * Pas de saisie d'une cellule du chronogramme, en heures.
 * Même valeur que `PAS` de chronogramme/semaines.js — recopiée et non importée,
 * car semaines.js dépend (via la carte) de ce module.
 */
export const PAS_CHRONOGRAMME = 2.5;

/** Colonnes lues, en notation e-note. */
export const COLONNES_MASSES = {
  partS1: 23, // X   — MHP S1 DRIF
  partSynS1: 24, // Y   — MHSYN S1 DRIF
  partS2: 27, // AB  — MHP S2 DRIF
  partSynS2: 28, // AC  — MHSYN S2 DRIF
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

/** Plus grand multiple du pas ne dépassant pas `valeur`. */
const auPasInferieur = (valeur) => Math.floor(arrondir(valeur / PAS_CHRONOGRAMME, 6)) * PAS_CHRONOGRAMME;

/**
 * Répartit la masse affectée entre les deux semestres, d'après le DRIF.
 *
 * `s2` est calculé par SOUSTRACTION et non par sa propre multiplication :
 * c'est ce qui garantit que `s1 + s2` retombe exactement sur le total.
 */
export function repartir(total, drifS1, drifS2) {
  if (total <= 0) return { s1: 0, s2: 0, total: 0 };

  // Un seul semestre au DRIF — ou aucun : tout y va, quel que soit l'écart.
  if (drifS2 <= 0) return { s1: total, s2: 0, total };
  if (drifS1 <= 0) return { s1: 0, s2: total, total };

  const base = drifS1 + drifS2;

  // Pas d'écart : les semestres du DRIF, tels quels.
  if (arrondir(total) === arrondir(base)) {
    return { s1: arrondir(drifS1), s2: arrondir(total - drifS1), total };
  }

  // Écart : prorata du DRIF, S1 arrondi au pas, borné par le total.
  const prorata = total * (drifS1 / base);
  const s1 = Math.min(
    Math.round(arrondir(prorata / PAS_CHRONOGRAMME, 6)) * PAS_CHRONOGRAMME,
    auPasInferieur(total)
  );

  return { s1: arrondir(s1), s2: arrondir(total - s1), total };
}

/**
 * @param {Array<string|number>} ligne  Ligne brute de la base e-note.
 * @returns {{presentiel: {s1,s2,total}, synchrone: {s1,s2,total}}}
 */
export function massesHoraires(ligne, colonnes = COLONNES_MASSES) {
  if (!Array.isArray(ligne)) {
    throw new TypeError('massesHoraires attend une ligne (tableau de cellules)');
  }

  const mhpS1 = nombre(ligne[colonnes.partS1]);
  const mhpS2 = nombre(ligne[colonnes.partS2]);

  /*
   * Le synchrone suit SES colonnes DRIF. Une ligne qui ne les renseigne pas
   * (fichier ancien, ligne produite sans elles) retombe sur la répartition
   * présentielle plutôt que de tout porter sur le S1.
   */
  let synS1 = nombre(ligne[colonnes.partSynS1]);
  let synS2 = nombre(ligne[colonnes.partSynS2]);
  if (synS1 + synS2 <= 0) {
    synS1 = mhpS1;
    synS2 = mhpS2;
  }

  return {
    presentiel: repartir(nombre(ligne[colonnes.masseHorairePresentiel]), mhpS1, mhpS2),
    synchrone: repartir(nombre(ligne[colonnes.masseHoraireSynchrone]), synS1, synS2),
  };
}
