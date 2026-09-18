/**
 * Avancement réalisé / prévu (F7).
 * ← public/avancement.html + api/data/get_planned_progress.php
 *   + get_completion_status.php
 */
export {
  AXES,
  agregerAvancement,
  complementParDefaut,
  dimensionComplement,
  taux,
  totalAvancement,
} from './agregation.js';
export { lireAvancementEnote, nombre } from './enote.js';
export { lignesDepuisAffectations } from './edtpro.js';
export { SEMESTRES, semestreCumule, semestreDe } from './semestre.js';
export { objectifsParGroupe, tauxObjectifPedagogique } from './objectif.js';
export {
  SEMAINES_ANNEE_REGIONALE,
  semainesDeVacances,
  tauxRegional,
} from './regional.js';
export { progressionEtablissement } from './progression.js';
export { massesGlobalesParGroupe, referenceDeLAxe } from './references.js';
export {
  SEUIL_ACHEVEMENT,
  completionModules,
  datesDeLaPlage,
  plageDeSemaines,
} from './completion.js';
export {
  FACETTES,
  FILTRES_VIDES,
  facettesAvancement,
  filtrerAvancement,
  nombreDeFiltres,
} from './filtres.js';
