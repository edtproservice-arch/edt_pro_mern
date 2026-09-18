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
