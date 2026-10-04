/**
 * Chronogramme — planning annuel prévisionnel, par groupe (F7).
 * ← includes/chrono_modules.php + la grille de profil-principal.js
 */
export {
  FIN_SEMESTRE_1,
  JOURS_PAR_SEMAINE,
  NOMBRE_SEMAINES,
  PAS,
  PLAFOND_CELLULE,
  plafondSemaine,
  semainesChronogramme,
  semainesDeLaLigne,
  semainesEnFormation,
} from './semaines.js';

export {
  TYPES,
  TYPE_MIXTE,
  capaciteSemaine,
  celluleDepuisParts,
  estMixte,
  partsDeCellule,
  poserCellule,
  resteAPlanifier,
  totalSemaine,
  totauxModule,
  verifierCellule,
} from './planning.js';

export {
  comparerMaquettes,
  filiereDuNomGroupe,
  signatureMaquette,
} from './duplication.js';

export { SEMAINES_DE_SERVICE, masseAnnuelle, masseHebdomadaire } from './masses.js';

export {
  ENTETES_FORMATEUR,
  ENTETES_GROUPE,
  ENTETES_MASSES,
  FEUILLES_TECHNIQUES,
  VALEURS_AUTORISEES,
  entetes,
  fusionnerCellules,
  lignesClasseur,
  lireFeuilleChronogramme,
} from './classeur.js';

export { SEUIL_HEBDOMADAIRE, chargesHebdomadaires } from './charge.js';

export {
  DERNIERES_SEMAINES,
  HEURES_PAR_JOUR_CIBLE,
  bornerALaFinDeFormation,
  PLAFOND_MODULE_SEMAINE,
  PLANCHER_HEBDOMADAIRE,
  PLANCHER_MASSE_MOYENNE,
  PRIORITES_GENERATION,
  PRIORITE_METIER_FORMATION,
  RESERVE_REGIONALE,
  SEMAINES_METIER_FORMATION,
  SEUIL_PLANCHER_ABSOLU,
  SEUIL_PETITE_MASSE,
  cibleDeLaSemaine,
  cibleHebdomadaire,
  derniereSemaineDuGroupe,
  estModuleMetierFormation,
  fenetreDuSemestre,
  joursPerdusFormateur,
  plafondHebdomadaireModule,
  plafondSoupleGroupe,
  plancherHebdomadaire,
  prioriteGeneration,
  retirerReserve,
  semainesDuSemestre,
} from './generation.js';

export {
  cleLigne,
  cleSynchrone,
  effacerAvecJumelles,
  groupesJumeaux,
  lignesJumelles,
  massesCumulees,
  poserAvecJumelles,
  posesCumulees,
  totalSemaineFusionnee,
} from './fusion.js';

export {
  cleSemaineChronogramme,
  completudeSemaine,
  poseDeLaSemaine,
  prevuDeLaSemaine,
  retraitRapprocheDuPlan,
  tauxConformite,
} from './completude.js';

export { heuresPoseesParSemaine, reporterVersChronogramme } from './report.js';

export {
  NIVEAUX_PLACEMENT,
  RAISONS_NON_PLACEE,
  placerManquantes,
  seancesManquantes,
} from './placementManquantes.js';

export {
  cellulesDuType,
  deplierModules,
  estDepliable,
  estPartageParType,
  fusionnerType,
  planningDeplie,
  planningDepuisLignes,
  planningDesLignes,
  planningReplie,
  scinderParType,
} from './partage.js';
