/**
 * Carte d'établissement construite à la main (F3, F13).
 * ← public/partials/affectation-carte.html + assets/js/affectation-carte.js
 *
 * Voie alternative à l'import e-note : le directeur choisit une filière dans la
 * répartition DRIF, génère ses groupes, puis affecte un formateur à chaque
 * module. Le résultat repasse par le MÊME parseur que l'import
 * (`construireBase`) — deux chemins, une seule structure produite.
 */

export * from './nomsGroupes.js';
export * from './lignesEnote.js';
export * from './importFormateurs.js';
export * from './bilanCharge.js';
export * from './affectations.js';
/* La carte vue PAR FORMATEUR — l'autre moitié de la même question. */
export { affectationsDuFormateur, placesDisponibles } from './vueFormateur.js';

export {
  anneeDuNomGroupe,
  ensemblesAReconstruire,
  filieresParGroupe,
  reconstruireFormateurs,
  reconstruireGroupes,
  separerFusion,
} from './reconstruction.js';
