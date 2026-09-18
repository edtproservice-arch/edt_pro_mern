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
  capaciteSemaine,
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
