/**
 * Colonnes de la base e-note « AvancementProgramme ».
 *
 * ← includes/parse_base_rows.php:148-157
 *
 * Le fichier compte 51 colonnes ; l'import n'en lit que 14. Elles sont
 * repérées par leur NOM quand l'en-tête est disponible, et par leur INDEX
 * sinon — certains fichiers arrivent sans ligne d'en-tête, et les index sont
 * alors la seule prise.
 */
export const COLONNES = {
  codeFiliere: { index: 4, nom: 'Code Filière' },
  groupe: { index: 8, nom: 'Groupe' },
  fusionGroupe: { index: 12, nom: 'FusionGroupe' },
  mode: { index: 15, nom: 'Mode' },
  module: { index: 16, nom: 'Code Module' },
  /** Colonne S : « O » marque un EFM régional. */
  efmRegional: { index: 18, nom: null },
  matriculePresentiel: { index: 19, nom: 'Mle Affecté Présentiel Actif' },
  formateurPresentiel: { index: 20, nom: 'Formateur Affecté Présentiel Actif' },
  matriculeSynchrone: { index: 21, nom: 'Mle Affecté Syn Actif' },
  formateurSynchrone: { index: 22, nom: 'Formateur Affecté Syn Actif' },
  /** Colonne X : part du semestre 1. */
  partS1: { index: 23, nom: null },
  /** Colonne AB : part du semestre 2. */
  partS2: { index: 27, nom: null },
  /* Les masses du RÉFÉRENTIEL DRIF — ce que le programme prévoit, à distinguer
     des masses AFFECTÉES (35-36), qui disent ce qui a été confié. */
  masseDrifPresentiel: { index: 31, nom: null },
  masseDrifSynchrone: { index: 32, nom: null },
  /** Colonne AJ : masse horaire présentielle. */
  masseHorairePresentiel: { index: 35, nom: null },
  /** Colonne AK : masse horaire synchrone. */
  masseHoraireSynchrone: { index: 36, nom: null },

  /*
   * ═══ CE QUE L'ÉTABLISSEMENT A DÉCLARÉ RÉALISÉ DANS E-NOTE ═══
   * (ajouté le 2026-08-26 pour l'avancement, F7.)
   *
   * ⚠️ NE PAS CONFONDRE AVEC LES COLONNES « DRIF » (31 à 34), qui portent la
   * maquette théorique. Les colonnes 35-36 que l'import lit déjà sont les
   * masses AFFECTÉES — ce que l'établissement a réellement confié à ses
   * formateurs — et 38-39 ce qu'il déclare avoir fait. Les deux faces de
   * l'écran d'avancement partagent donc le même PRÉVU et ne diffèrent que par
   * le RÉALISÉ : e-note le déclare, eDTpro le compte dans la grille.
   */
  realisePresentiel: { index: 38, nom: 'MH Réalisée Présentiel' },
  realiseSynchrone: { index: 39, nom: 'MH Réalisée Sync' },
};

/**
 * Ligne d'en-tête d'un fichier e-note — les 51 colonnes, dans l'ordre.
 * ← ENOTE_HEADERS de affectation-carte.js:3691-3703
 *
 * Elle sert à l'EXPORT : le classeur produit doit être relisible par l'import,
 * qui repère ses colonnes par leur nom quand l'en-tête est présent. Un libellé
 * qui dérive ici ferait retomber l'import sur les index — silencieusement tant
 * que l'ordre ne bouge pas, puis brutalement le jour où il bouge.
 *
 * ⚠️ « MH Totale  DRIF » porte DEUX espaces, comme dans les fichiers réels.
 * La coquille vient de l'outil e-note : la corriger casserait l'appariement
 * par nom sur les fichiers d'origine.
 */
export const ENTETES_ENOTE = [
  "Date MAJ",
  "Année",
  "Niveau",
  "Secteur",
  "Code Filière",
  "filière",
  "Type de formation",
  "Créneau",
  "Groupe",
  "Effectif Groupe",
  "Sous Groupe",
  "Statut Sous-Groupe",
  "FusionGroupe",
  "Code Fusion",
  "Année de formation",
  "Mode",
  "Code Module",
  "Module",
  "Régional",
  "Mle Affecté Présentiel Actif",
  "Formateur Affecté Présentiel Actif",
  "Mle Affecté Syn Actif",
  "Formateur Affecté Syn Actif",
  "MHP S1 DRIF",
  "MHSYN S1 DRIF",
  "MHASYN S1 DRIF",
  "MH Totale S1 DRIF",
  "MHP S2 DRIF",
  "MHSYN S2 DRIF",
  "MHASYN S2 DRIF",
  "MH Totale S2 DRIF",
  "MHP Totale DRIF",
  "MHSYN Totale DRIF",
  "MHASYN Totale DRIF",
  "MH Totale  DRIF",
  "MH Affectée Présentiel",
  "MH Affectée Sync",
  "MH Affectée Globale (P & SYN)",
  "MH Réalisée Présentiel",
  "MH Réalisée Sync",
  "MH Réalisée Globale",
  "Taux Réalisation Présentiel",
  "Taux Réalisation Syn",
  "Taux Réalisation (P & SYN )",
  "Moy Absence",
  "NB CC",
  "Séance EFM",
  "Validation EFM",
  "Classe Teams",
  "Module PIE",
  "EFP PIE",
];

/**
 * Résout l'index d'une colonne : par son nom si l'en-tête le porte, sinon par
 * sa position. Reprend `$col()` de parse_base_rows.php:140.
 */
export function indexColonne(champ, entete = []) {
  const colonne = COLONNES[champ];
  if (!colonne) throw new Error(`Colonne inconnue : ${champ}`);

  if (Array.isArray(entete) && entete.length > 0 && colonne.nom) {
    const trouve = entete.indexOf(colonne.nom);
    if (trouve !== -1) return trouve;
  }

  return colonne.index;
}

/** Table complète des index, résolue une fois pour tout un fichier. */
export function resoudreColonnes(entete = []) {
  return Object.fromEntries(
    Object.keys(COLONNES).map((champ) => [champ, indexColonne(champ, entete)])
  );
}
