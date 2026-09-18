/**
 * Schémas Zod partagés front / back.
 *
 * Garde-fou n°1 du §5bis : en l'absence de TypeScript, ces schémas SONT le
 * contrat d'interface. Un schéma est défini une seule fois ici, puis utilisé
 * par la route Express (via `validate()`) ET par le formulaire React (via
 * `zodResolver`). Il devient impossible que les deux côtés divergent.
 *
 * Les schémas sont ajoutés au fil des phases : auth (3), base (4),
 * seances (5), generation (6), absences (8), messagerie (9).
 */

export * from './auth.js';
export * from './admin.js';
export * from './comptes.js';
export * from './repartition.js';
export * from './reseau.js';
export * from './calendrierNational.js';
export * from './tempsReel.js';
export * from './partage.js';
export * from './absenceStagiaire.js';
export * from './contraintesFormateurs.js';
