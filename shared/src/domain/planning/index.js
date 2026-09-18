/**
 * Année scolaire, semaines et calendrier.
 *
 * ← public/emploi.html, public/assets/js/school-year-filter.js,
 *   includes (règle SQL de schema_annee_scolaire.sql)
 *
 * C'est ici que se règle le constat §2 du plan : l'année scolaire existait sous
 * trois représentations de stockage — et, plus grave, sous DEUX RÈGLES de calcul
 * différentes selon le langage. Une seule définition désormais.
 */

export {
  anneeScolaire,
  anneeScolaireAPreparer,
  anneeScolaireCourante,
  bornesAnneeScolaire,
  libelleAnneeScolaire,
  lireAnneeScolaire,
  lundiPremiereSemaine,
} from './anneeScolaire.js';

export {
  analyserSemaine,
  libelleSemaine,
  dateDuJour,
  datesDeLaSemaine,
  lundiDeLaSemaine,
  normaliserValeurSemaine,
  semaineDansAnnee,
  semaineDe,
  valeurSemaine,
  JOURS_SEMAINE_CIVILE,
} from './semaines.js';

export {
  disponibilite,
  enJour,
  absencesDuJour,
  formationDuFormateur,
  fusionnerJoursFeries,
  jourFerie,
  stageDuGroupe,
  stageDuGroupeSurSemaine,
  vacances,
} from './calendrier.js';

/*
 * ⚠️ `fusionnerVacances` PORTE SON DOMAINE DANS SON NOM : `vacances` existe
 * déjà, exporté par `calendrier.js` — et deux noms identiques dans le barillet
 * sont SILENCIEUSEMENT abandonnés (piège de `calculerCharges`, 2026-08-21).
 */
export {
  avantRentree,
  dateRentree,
  fusionnerVacances,
  joursAvantRentree,
} from './rentree.js';
