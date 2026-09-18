/**
 * Emploi du temps — grille hebdomadaire (F5).
 * ← public/emploi.html + api/data/save_timetable.php
 */
export {
  DUREE_JOUR,
  DUREE_SOIR,
  dureeSeance,
  HEURES_ELEVEES,
  HEURES_SURCHARGE,
  LIGNES_FORMATEUR,
  LIGNES_GROUPE,
  SEANCES_JOUR,
  SEANCE_SOIR,
  assemblerGrille,
  groupesDuSoir,
  heuresParSujet,
  indexerSeances,
  niveauCharge,
  basculeVersSemaineSuivante,
  prochaineBascule,
  semaineAOuvrir,
} from './grille.js';

export {
  SALLES_SANS_CONFLIT,
  SALLE_DISTANCIEL,
  typeDeSeance,
  detecterConflits,
  estSalleReelle,
  groupesCompares,
  groupesSeCroisent,
  memeGroupe,
  optionsDuFormateur,
} from './conflits.js';

export {
  AVANCEMENT_ELEVE,
  AVANCEMENT_MOYEN,
  HEURES_BADGE_BAS,
  HEURES_BADGE_HAUT,
  avancementModule,
  avancementParSemaine,
  cleModule,
  fichesModules,
  heuresPosees,
  niveauAvancement,
  niveauHeures,
} from './indicateurs.js';

export { DUREE_RATTRAPAGE, groupesConcernes, reporterRattrapage } from './rattrapage.js';

export {
  modulesRegionaux,
  seancesDeLExamen,
  surveillantsPossibles,
  titulairesDuModule,
} from './efm.js';

export {
  AXES_CONSULTATION,
  LIBELLES_NIVEAUX,
  ORDRE_NIVEAUX,
  agendaDuSujet,
  assemblerConsultation,
  contenuLigne,
  facettesDesGroupes,
  filtrerGroupes,
  filtrerSujets,
  horaireCreneau,
  instantLocal,
  sallesDeLaSemaine,
  seanceTerminee,
} from './consultation.js';

export {
  CRENEAUX_CONTRAINTES,
  creneauAEviter,
  indexerContraintes,
  normaliserContraintes,
  salleParDefaut,
} from './contraintesFormateurs.js';
