/**
 * Import Konosys — les stagiaires de l'établissement.
 * ← api/students/upload.php
 *
 * Konosys est le système de gestion des stagiaires de l'OFPPT : sa source est
 * DISTINCTE de l'e-note, qui porte formateurs, groupes et modules.
 */
export { COLONNES_KONOSYS, decomposerLibelle, lireStagiaires } from './parseStagiaires.js';
