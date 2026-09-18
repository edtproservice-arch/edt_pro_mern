/**
 * Les colonnes du classeur de répartition DRIF.
 * ← `rep_colonnes_completes()`, `rep_colonnes_utiles()`,
 *   `rep_colonnes_obligatoires()` et `rep_correspondance_sql()` de
 *   `includes/repartition_import.php`.
 *
 * ═══ ⚠️ LES INTITULÉS SONT REPRIS À LA LETTRE ═══
 * Ce sont ceux des classeurs officiels, coquilles comprises : « Anneé de
 * Formation » porte bien son accent au mauvais endroit, et « Secteur groupé »
 * une espace finale. Les corriger romprait l'appariement par nom sur les
 * fichiers réels — c'est le même piège que « MH Totale  DRIF » et ses deux
 * espaces, déjà consigné pour l'e-note.
 */

/** Les 21 colonnes réellement lues. Le reste du classeur est du poids mort. */
export const COLONNES = {
  Secteur: 'secteur',
  'Niveau de formation': 'niveauFormation',
  'Type de formation': 'typeFormation',
  Créneau: 'creneau',
  'Code Filière DRIF': 'codeFiliereDrif',
  'Intitulé Filière DRIF': 'intituleFiliere',
  'Code Filière Carte': 'codeFiliereCarte',
  Filière: 'filiere',
  'Anneé de Formation': 'anneeFormation',
  'Code Module': 'codeModule',
  Module: 'module',
  'MHP S1': 'mhpS1',
  'MHSYN S1': 'mhsynS1',
  'MHASYN S1': 'mhasynS1',
  'MHP S2': 'mhpS2',
  'MHSYN S2': 'mhsynS2',
  'MHASYN S2': 'mhasynS2',
  'MHP Totale': 'mhpTotale',
  'MHD Totale': 'mhdTotale',
  'EFM Régional': 'efmRegional',
  Métier: 'metier',
};

/**
 * Sans elles, la carte ne peut ni proposer une filière ni calculer une masse
 * horaire : leur absence BLOQUE l'import, elle ne le dégrade pas.
 * ← `rep_colonnes_obligatoires()`.
 */
export const COLONNES_OBLIGATOIRES = [
  'Secteur',
  'Niveau de formation',
  'Créneau',
  'Code Filière DRIF',
  'Intitulé Filière DRIF',
  'Anneé de Formation',
  'Code Module',
  'Module',
  'MHP S1',
  'MHP S2',
];

/** Les champs numériques du modèle — tout le reste est du texte. */
export const CHAMPS_NUMERIQUES = [
  'mhpS1',
  'mhsynS1',
  'mhasynS1',
  'mhpS2',
  'mhsynS2',
  'mhasynS2',
  'mhpTotale',
  'mhdTotale',
];

/** La feuille de référence des classeurs officiels. */
export const FEUILLE_PREFEREE = 'RepartitionHoraire';

/**
 * « 12,5 » ou « 12.5 » → 12,5 ; le reste → 0.
 *
 * ⚠️ LA VIRGULE EST TRAITÉE : `Number('12,5')` rend `NaN`, et une masse horaire
 * perdue ne se voit qu'au moment où un chronogramme ne tombe plus juste. Les
 * classeurs marocains l'emploient couramment.
 */
export function nombre(valeur) {
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : 0;

  const converti = Number.parseFloat(String(valeur ?? '').trim().replace(',', '.'));
  return Number.isFinite(converti) ? converti : 0;
}

/**
 * ⚠️ « O » / « N », PAS UN BOOLÉEN : c'est ainsi que le classeur — et la table
 * MySQL — écrivent l'EFM régional. Tout ce qui n'est pas « O » vaut faux, y
 * compris une cellule vide.
 */
export function estRegional(valeur) {
  return String(valeur ?? '').trim().toUpperCase() === 'O';
}
