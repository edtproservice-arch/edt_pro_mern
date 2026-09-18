import { nombre } from './nombre.js';

/**
 * Le semestre d'une ligne d'avancement.
 * ← le filtre « Semestre » d'avancement.html (S1 · S2 · Annual)
 *
 * ⚠️ IL SE DÉDUIT DES MASSES, il n'est écrit nulle part. Un module qui porte des
 * heures des deux côtés est ANNUEL ; c'est la même règle que le badge de
 * semestre de la grille, où « A » désigne exactement ce cas.
 *
 * ⚠️ LES DEUX FACES LE CALCULENT DEPUIS DES SOURCES DIFFÉRENTES — les colonnes
 * `partS1`/`partS2` du fichier e-note d'un côté, `s1Heures`/`s2Heures` des
 * affectations de l'autre — mais par LA MÊME fonction. Deux règles auraient
 * classé le même module en S1 sur une face et en annuel sur l'autre, et la
 * bascule aurait paru changer les données.
 */

export const SEMESTRES = ['S1', 'S2', 'A'];

/**
 * @returns {'S1'|'S2'|'A'|''} — chaîne vide quand rien n'est déclaré.
 *
 * ⚠️ ON LIT AVEC `nombre()`, PAS AVEC `Number()`. Les cellules du fichier
 * arrivent en TEXTE, parfois à la virgule : « 12,5 » lu par `Number()` rend
 * `NaN`, la part passait pour nulle, et la facette « Semestre » se vidait pour
 * le fichier entier — sans la moindre erreur. Trouvé par un test.
 */
export function semestreDe(partS1, partS2) {
  const s1 = nombre(partS1) > 0;
  const s2 = nombre(partS2) > 0;

  if (s1 && s2) return 'A';
  if (s1) return 'S1';
  if (s2) return 'S2';
  return '';
}

/**
 * Le semestre d'un ENSEMBLE de lignes — celui d'un module vu à travers tous ses
 * groupes, par exemple.
 *
 * ⚠️ DEUX SEMESTRES DIFFÉRENTS DONNENT « A », jamais le premier rencontré : un
 * module donné en S1 à une promotion et en S2 à une autre s'étale bien sur
 * l'année. Retenir « S1 » ferait disparaître ses groupes du filtre « S2 ».
 */
export function semestreCumule(semestres = []) {
  const vus = new Set(semestres.filter((valeur) => valeur !== ''));

  if (vus.size === 0) return '';
  if (vus.size === 1) return [...vus][0];
  return 'A';
}
