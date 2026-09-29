/**
 * Règles propres à l'établissement lui-même — son identité, par opposition à
 * sa carte pédagogique (`carte/`) ou à son calendrier (`planning/`).
 */
export { LONGUEUR_MAXIMALE, propositionsNomAbrege } from './nomAbrege.js';
export {
  ETAPES_CONFIGURATION,
  etapeDeReprise,
  etapesConfigurationFaites,
  etapesConfigurationManquantes,
} from './configuration.js';
export {
  CHEFS_LIEUX,
  COORDONNEES,
  localiserEtablissement,
  normaliserLieu,
} from './localisation.js';
