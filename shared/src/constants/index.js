/**
 * Constantes du domaine — extraites du code PHP/JS existant.
 * Une seule définition, importée par le front ET l'API.
 */

export const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

export const SEANCES = ['S1', 'S2', 'S3', 'S4', 'S5'];

/**
 * ← enum `role` de la table utilisateurs.
 *
 * ⚠️ `directeur` et non `director` (décision du 2026-08-14). MySQL stockait la
 * seule valeur anglaise du lot, alors que les quatre autres étaient déjà en
 * français — et `apply_proposition.php:18` acceptait déjà les deux orthographes,
 * signe que l'incohérence gênait.
 *
 * Conséquence pour l'ETL de la Phase 2 : les comptes venant de MySQL doivent
 * être convertis (`director` → `directeur`) au moment de la reprise.
 */
export const ROLES = {
  ADMIN: 'admin',
  DIRECTEUR: 'directeur',
  GESTIONNAIRE: 'gestionnaire',
  FORMATEUR: 'formateur',
  STAGIAIRE: 'stagiaire',
};

/** ← enum `status` de la table utilisateurs */
export const STATUTS_COMPTE = {
  EN_ATTENTE: 'pending',
  APPROUVE: 'approved',
  REJETE: 'rejected',
  BLOQUE: 'blocked',
  SUPPRIME: 'deleted',
};

/** ← champ `type` des affectations (parse_base_rows.php) */
export const TYPES_COURS = {
  PRESENTIEL: 'presentiel',
  SYNCHRONE: 'synchrone',
};

/** ← enum `type_absence` de la table absences_stagiaires */
export const TYPES_ABSENCE = {
  ABSENCE: 'absence',
  RETARD: 'retard',
};

export const PERIODES = {
  JOUR: 'jour',
  SOIR: 'soir',
};

/**
 * Les régions du réseau OFPPT.
 * ← « REGIONS OFPPT.xlsx », fourni par le porteur le 2026-09-02.
 *
 * ═══ ⚠️ FIGÉES DANS LE CODE, ET C'EST UNE DÉCISION ═══ (2026-09-02.)
 * Elles ne changent qu'avec un redécoupage administratif national — rare, et qui
 * demanderait de toute façon de revoir les données. En faire une collection,
 * c'était un second CRUD à écrire et à tenir pour dix valeurs qui ne bougent
 * pas ; et une région supprimée par erreur emporterait ses établissements de la
 * cascade d'inscription.
 *
 * ⚠️ CONSÉQUENCE ASSUMÉE : en ajouter une demande une mise en ligne, pas un clic.
 *
 * ⚠️ LES ACCENTS SONT ICI LA DONNÉE, pas un détail de présentation : c'est sur
 * ces chaînes EXACTES que se compare la région d'un établissement. « Fes » et
 * « Fès-Meknès » ne sont pas la même clé.
 */
export const REGIONS_OFPPT = [
  'Béni Mellal-Khénifra',
  'Casablanca-Settat',
  'Drâa-Tafilalet',
  'Fès-Meknès',
  'Marrakech-Safi',
  'Oriental',
  'Provinces du Sud',
  'Rabat-Salé-Kénitra',
  'Souss-Massa',
  'Tanger-Tétouan-Al Hoceima',
];

/**
 * Les deux moteurs de génération (Phase 6 · e).
 *
 * ═══ ⚠️ CES CHAÎNES SONT LE CONTRAT AVEC PYTHON ═══ Elles sont recopiées
 * telles quelles dans `ai/generateur/contrat.py` (`MOTEUR`, `MOTEUR_CPSAT`) et
 * voyagent dans le JSON envoyé au solveur. En renommer une ici sans l'y
 * renommer ferait refuser le problème — bruyamment, c'est voulu : `lecture.py`
 * REFUSE un moteur inconnu au lieu de retomber sur le glouton en silence.
 *
 * ⚠️ `CPSAT` NE REMPLACE PAS `GLOUTON`, il s'y ajoute. Mesuré sur l'année
 * réelle : CP-SAT fait parfois MOINS BIEN (S2 : 150 contre 153 ; S35 : 130
 * contre 143). Le glouton tourne donc toujours, et sa grille est conservée sauf
 * si CP-SAT en place STRICTEMENT plus. Voir `ai/generateur/choix.py`.
 */
export const MOTEURS = {
  /** Heuristique gloutonne, ~30 ms la semaine. Le défaut, et le filet. */
  GLOUTON: 'glouton',
  /** Recherche complète (OR-Tools CP-SAT), ~20 s la semaine, avec repli. */
  CPSAT: 'cpsat',
};

/**
 * Pourquoi CP-SAT n'a finalement pas produit la grille rendue.
 * ← `ai/generateur/choix.py`. Le rapport NOMME la raison : un repli muet
 * laisserait croire à une recherche complète là où il n'y en a pas eu.
 */
export const REPLIS_MOTEUR = {
  /** CP-SAT n'a pas été demandé. */
  NON_DEMANDE: 'non_demande',
  /** Le glouton a tout placé : une semaine complète est optimale par définition. */
  RIEN_A_GAGNER: 'rien_a_gagner',
  /** OR-Tools n'est pas installé — dépendance facultative, jamais bloquante. */
  ORTOOLS_ABSENT: 'ortools_absent',
  /** CP-SAT n'a pas fait strictement mieux : on garde la grille du glouton. */
  PAS_MIEUX: 'pas_mieux',
  /** Le solveur est tombé ; la génération continue avec le glouton. */
  ERREUR_SOLVEUR: 'erreur_solveur',
};

/**
 * Pourquoi un créneau est interdit à une tâche (Phase 6, 2026-09-22).
 *
 * ═══ ⚠️ CE SONT DES ÉTIQUETTES OPAQUES POUR PYTHON ═══
 * `diagnostic.py` les COMPTE, il ne les interprète jamais : « Python rend un
 * code, pas une phrase » — c'est l'en-tête de ce fichier-là, et la frontière
 * du 2026-09-20. Node seul sait qu'un créneau fermé vient d'un stage du
 * groupe, d'une formation du formateur ou d'une rentrée qui n'a pas eu lieu.
 *
 * ⚠️ AVANT, LES QUATRE ARRIVAIENT FUSIONNÉES SOUS `creneau_interdit` — et
 * c'est la cause n°1 mesurée sur l'année réelle (163 séances sur 341). Le
 * rapport envoyait donc chercher dans quatre directions à la fois, là où
 * l'information exacte existait déjà dans `probleme.js` et était jetée à la
 * ligne suivante.
 */
export const MOTIFS_INTERDICTION = {
  /** Le groupe n'a pas encore fait sa rentrée : rien ne peut y avoir lieu. */
  RENTREE: 'rentree',
  /** Le groupe est en stage cette journée-là. */
  STAGE: 'stage',
  /** Le formateur est lui-même en formation. */
  FORMATION: 'formation',
  /**
   * Le formateur a marqué ce créneau « à éviter ».
   * ⚠️ CE N'EST PAS UNE IMPOSSIBILITÉ, C'EST UNE CONSIGNE — et c'est tout
   * l'intérêt de le distinguer : les trois autres motifs se corrigent dans le
   * calendrier, celui-ci s'arbitre avec une personne.
   */
  A_EVITER: 'a_eviter',
};

/**
 * Pourquoi des heures du chronogramme ne deviennent jamais une séance.
 *
 * ═══ ⚠️ DEUX SITUATIONS QUI APPELLENT DES CORRECTIONS OPPOSÉES ═══ (2026-09-22)
 * Elles arrivaient jusqu'ici sous le même message — « aucun formateur ne leur
 * est affecté dans la carte, c'est la carte qu'il faut corriger ». Mesuré sur
 * l'année réelle : **les 39 cas étaient des groupes ABSENTS de la carte**, et
 * aucun n'était un module non affecté. Le directeur cherchait donc une
 * affectation pour des groupes qui n'existent nulle part — `GE101 (GC)`,
 * `DEVOWFS101 (CDS)`, `PM102` : une filière entière que la carte ne porte plus.
 */
export const MOTIFS_IGNOREE = {
  /**
   * Le groupe n'apparaît dans AUCUNE affectation : son chronogramme a survécu
   * à la carte. ⚠️ C'est le CHRONOGRAMME qu'il faut retirer ou renommer, pas
   * une affectation qu'il faut ajouter.
   */
  GROUPE_ABSENT: 'groupe_absent',
  /**
   * Le groupe existe bien, mais ce module-là n'est affecté à personne.
   * ⚠️ Là, et là seulement, il y a une affectation à créer.
   */
  MODULE_NON_AFFECTE: 'module_non_affecte',
};
