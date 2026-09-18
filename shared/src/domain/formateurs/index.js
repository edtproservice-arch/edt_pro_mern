/**
 * Identité des formateurs.
 *
 * Ce dossier remplace six fonctions dispersées dans le code PHP/JS, dont quatre
 * faisaient la même chose avec des résultats parfois différents :
 *
 *   includes/functions.php        getBaseName, getFormattedName,
 *                                 resolveNameConflicts, detectDuplicateLastNames
 *   includes/parse_base_rows.php  pb_resolveNameConflicts
 *   public/emploi.html            getBaseNameJS, getFormattedName
 *   public/edition.html           getFormattedName
 *
 * Le choix entre elles n'a pas été fait au jugé : les quatre ont été rejouées
 * sur le corpus réel de production (156 noms, 4 groupes, 79 formateurs), et les
 * divergences constatées sont documentées dans `nomBase.js`.
 */

export { nomBase, prenom, decouper } from './nomBase.js';
export { resoudreHomonymes } from './homonymes.js';
