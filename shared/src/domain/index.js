/**
 * Règles métier pures — le cœur du projet.
 *
 * CONTRAINTE ABSOLUE : aucun fichier de ce dossier ne doit importer React,
 * Express ou Mongoose. Ce sont des fonctions de calcul, testables isolément.
 *
 * C'est ici que se règle la cause n°1 d'instabilité de l'application PHP :
 * la même règle métier y existe en plusieurs exemplaires divergents
 * (includes/functions.php, includes/parse_base_rows.php, public/emploi.html).
 *
 * Règle de contribution : tout fichier ajouté ici a son `.test.js` — vérifié en
 * CI, avec un seuil de couverture de 90 %.
 *
 * Avancement :
 *   formateurs/  ✅ nomBase, resoudreHomonymes
 *   enote/       ✅ suffixes de groupes, masses horaires S1/S2
 *   planning/    ✅ année scolaire, semaines scolaires (⏳ calendrier, conflits)
 *   generation/  ⏳ Phase 6 — runAutoGeneration et ses satellites
 *   avancement/  ⏳ Phase 7
 *   discipline/  ✅ note de discipline — grille réglementaire (2026-09-14)
 *
 * Tout ce qui est marqué ✅ est caractérisé sur les données réelles de
 * production, pas seulement testé sur des exemples inventés.
 */

export * from './formateurs/index.js';
export * from './enote/index.js';
export * from './etablissement/index.js';
export * from './planning/index.js';
export * from './carte/index.js';
export * from './messagerie/index.js';
export * from './konosys/index.js';
export * from './chronogramme/index.js';
export * from './emploi/index.js';
export * from './avancement/index.js';
export * from './repartition/index.js';
export * from './partage/index.js';
export * from './discipline/index.js';
