import { arrondir } from '../enote/massesHoraires.js';

/**
 * ═══ NOTE DE DISCIPLINE (F9) ═══
 * La grille réglementaire « Grille de notation de l'Assiduité et du
 * Comportement applicable aux Examens de Passage et de Fin de Formation »
 * (annexe fournie par le porteur, 2026-09-14). Des sanctions RÉELLES en
 * dépendent : chaque ligne de la grille a son test.
 *
 * ← vue SQL `vue_note_discipline` — mais PAS reproduite. Elle s'écartait de la
 * grille sur quatre points, tous corrigés ici :
 *   1. elle comparait des SÉANCES à des seuils en JOURNÉES (1 journée = 5 h =
 *      2 séances, dit la légende) : la « 1ʳᵉ mise en garde » tombait dès une
 *      séance manquée, au lieu d'une journée ;
 *   2. elle IGNORAIT LES RETARDS pour choisir la sanction ;
 *   3. elle prononçait l'exclusion définitive à 10 SÉANCES, quand la grille dit
 *      « au-delà de 10 journées » ;
 *   4. elle n'avait PAS DE COMPORTEMENT : pas de note sur 15.
 *
 * ═══ LA SANCTION SE LIT SUR LE TOTAL DES POINTS RETIRÉS ═══ (décision du
 * porteur.) Les colonnes « Cumul des retards » et « Cumul des absences » de la
 * grille partagent la même colonne « Points à déduire » : retards et absences
 * s'ADDITIONNENT — 2 retards et 1 séance d'absence retirent 1 point, soit la
 * 1ʳᵉ mise en garde. C'est la lecture de la légende (−0,25 par retard, −0,5 par
 * séance).
 *
 * ⚠️ LE CALCUL SE FAIT EN QUARTS DE POINT, entiers : 0,25 × 3 vaut
 * 0,7499999… en flottant, et un palier atteint pile (4 retards = 1 point)
 * pourrait être manqué d'un epsilon — donc une sanction non prononcée.
 */

/** SG = Surveillant général · D = Directeur · CD = Conseil de discipline. */
export const AUTORITES_DISCIPLINE = {
  SG: 'Surveillant général',
  D: 'Directeur',
  CD: 'Conseil de discipline',
};

export const NOTE_ASSIDUITE_MAX = 10;
export const NOTE_COMPORTEMENT_MAX = 5;
export const NOTE_DISCIPLINE_MAX = NOTE_ASSIDUITE_MAX + NOTE_COMPORTEMENT_MAX;

/** Légende : « 1 retard = −0,25 point ; une absence d'une séance = −0,5 point ». */
export const RETRAIT_RETARD = 0.25;
export const RETRAIT_SEANCE_ABSENCE = 0.5;
const QUARTS_RETARD = 1;
const QUARTS_SEANCE = 2;

/*
 * `niveau` porte la GRAVITÉ, pour l'écran : il colore le badge sans avoir à
 * relire le libellé. Quatre familles, dans l'ordre de la grille.
 */
const sanction = (libelle, autorite, niveau) => Object.freeze({ libelle, autorite, niveau });

/** Index = points retirés, entiers. 0 : rien. */
const PALIERS_ASSIDUITE = [
  null,
  sanction('1ère mise en garde', 'SG', 'mise-en-garde'),
  sanction('2ème mise en garde', 'SG', 'mise-en-garde'),
  sanction('1er avertissement', 'D', 'avertissement'),
  sanction('2ème avertissement', 'D', 'avertissement'),
  sanction('Blâme', 'CD', 'blame'),
  sanction('Exclusion de 2 jours', 'CD', 'exclusion'),
];

/** 7 à 10 points : la grille laisse le Conseil trancher. */
const EXCLUSION_A_APPRECIER = sanction(
  'Exclusion temporaire ou définitive à l’appréciation du Conseil de discipline',
  'CD',
  'exclusion'
);
const EXCLUSION_DEFINITIVE = sanction('Exclusion définitive', 'CD', 'exclusion');

/** Index = rang de l'indiscipline (1ʳᵉ, 2ᵉ…). */
const PALIERS_COMPORTEMENT = [
  null,
  sanction('Mise en garde', 'SG', 'mise-en-garde'),
  sanction('Avertissement', 'D', 'avertissement'),
  sanction('Blâme', 'CD', 'blame'),
  sanction('Exclusion de 2 jours', 'CD', 'exclusion'),
  EXCLUSION_DEFINITIVE,
];

/**
 * §5bis règle 2 : le domaine valide ses entrées. Un compte négatif ou décimal
 * vient forcément d'un défaut en amont — le laisser passer donnerait une note
 * au-dessus du maximum, sans rien qui le signale.
 */
function compte(valeur, nom) {
  if (!Number.isInteger(valeur) || valeur < 0) {
    throw new TypeError(`${nom} doit être un entier positif ou nul (reçu : ${valeur})`);
  }
  return valeur;
}

/**
 * La sanction d'assiduité pour un total de points retirés — ou `null`.
 *
 * ⚠️ « AU-DELÀ DE 40 RETARDS / AU-DELÀ DE 10 JOURNÉES » = PLUS de 10 points :
 * 10 points pile relèvent encore de l'appréciation du Conseil.
 */
export function sanctionAssiduite(pointsRetires) {
  if (typeof pointsRetires !== 'number' || Number.isNaN(pointsRetires) || pointsRetires < 0) {
    throw new TypeError('sanctionAssiduite attend un nombre de points positif ou nul');
  }
  const quarts = Math.round(pointsRetires * 4);
  if (quarts > NOTE_ASSIDUITE_MAX * 4) return EXCLUSION_DEFINITIVE;

  const palier = Math.floor(quarts / 4);
  if (palier >= 7) return EXCLUSION_A_APPRECIER;
  return PALIERS_ASSIDUITE[palier];
}

/**
 * La sanction qui accompagne la n-ième indiscipline — ou `null` s'il n'y en a
 * aucune. Au-delà de la 5ᵉ, l'exclusion définitive est déjà prononcée.
 */
export function sanctionComportement(rang) {
  compte(rang, 'Le rang de l’indiscipline');
  if (rang === 0) return null;
  return PALIERS_COMPORTEMENT[Math.min(rang, PALIERS_COMPORTEMENT.length - 1)];
}

/**
 * L'examen auquel la note de discipline s'applique, selon l'année de formation
 * du groupe (2026-09-15, décision du porteur) :
 *   - 1ʳᵉ année → examen de PASSAGE, note ramenée sur 20 (× 20/15) ;
 *   - 2ᵉ et 3ᵉ année → examen de FIN DE FORMATION, la note RESTE SUR 15.
 *
 * ⚠️ L'année se lit dans le numéro du groupe (`anneeDuNomGroupe`) — c'est à
 * l'appelant de la fournir, le barème ne connaît pas les noms de groupe.
 */
export function examenDiscipline(anneeFormation) {
  compte(anneeFormation, 'L’année de formation');
  return anneeFormation <= 1
    ? Object.freeze({ type: 'passage', sur: 20 })
    : Object.freeze({ type: 'fin', sur: NOTE_DISCIPLINE_MAX });
}

/**
 * La note de discipline d'un stagiaire.
 *
 * ⚠️ NE COMPTENT QUE LES ABSENCES ET RETARDS NON JUSTIFIÉS — c'est à l'appelant
 * de les trier (règle de l'existant, conservée : une absence justifiée ne retire
 * rien).
 *
 * `anneeFormation` (facultative) décide de l'examen : sans elle, la note sur 20
 * reste calculée et `examen`/`noteExamen` valent `null`.
 *
 * @param {{seancesAbsentes: number, retards: number, indisciplines: number, anneeFormation?: number}} faits
 */
export function noteDiscipline({ seancesAbsentes = 0, retards = 0, indisciplines = 0, anneeFormation } = {}) {
  compte(seancesAbsentes, 'Le nombre de séances d’absence');
  compte(retards, 'Le nombre de retards');
  compte(indisciplines, 'Le nombre d’indisciplines');
  const examen = anneeFormation === undefined ? null : examenDiscipline(anneeFormation);

  const quarts = seancesAbsentes * QUARTS_SEANCE + retards * QUARTS_RETARD;
  const pointsAssiduite = quarts / 4;
  const noteAssiduite = Math.max(0, (NOTE_ASSIDUITE_MAX * 4 - quarts) / 4);

  /*
   * La grille : la n-ième indiscipline porte le TOTAL retiré à n (1ʳᵉ : −1,
   * 2ᵉ : −2…) — comme les paliers d'assiduité, qui sont eux aussi des cumuls.
   */
  const pointsComportement = Math.min(indisciplines, NOTE_COMPORTEMENT_MAX);
  const noteComportement = NOTE_COMPORTEMENT_MAX - pointsComportement;

  const note15 = noteAssiduite + noteComportement;
  // ⚠️ Fin de formation : pas de conversion — une note sur 20 n'y a pas de sens.
  const note20 = examen?.type === 'fin' ? null : arrondir((note15 * 20) / NOTE_DISCIPLINE_MAX, 2);

  return {
    assiduite: {
      seancesAbsentes,
      retards,
      // Non plafonnés : « 12 points » dit qu'on est au-delà de la grille.
      pointsRetires: pointsAssiduite,
      note: noteAssiduite,
      sanction: sanctionAssiduite(pointsAssiduite),
    },
    comportement: {
      indisciplines,
      pointsRetires: pointsComportement,
      note: noteComportement,
      sanction: sanctionComportement(indisciplines),
    },
    /** Examens de fin de formation : sur 15, non pondérée. */
    note15,
    /** Examens de passage : « (ND × 20/15) » — `null` en fin de formation. */
    note20,
    examen,
    /** La note qui compte pour l'examen du groupe (sur `examen.sur`). */
    noteExamen: examen ? (examen.type === 'fin' ? note15 : note20) : null,
  };
}
