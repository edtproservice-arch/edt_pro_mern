/**
 * Année scolaire — LA définition unique.
 *
 * ═══ POURQUOI CE FICHIER EXISTE ═══
 * Le §2 du plan relève trois représentations concurrentes de la même notion :
 *   - `donnees_de_base.annee_scolaire`  INT       (2025)
 *   - `etablissements.annee_scolaire`   VARCHAR   (« 2025-2026 »)
 *   - `donnees_avancement`              aucune : filtrage sur `date_upload >= AAAA-09-01`
 *
 * Il en existe une quatrième, plus sournoise, découverte en caractérisant : la
 * RÈGLE elle-même diffère selon le langage.
 *
 *   PHP  (schema_annee_scolaire.sql, morocco_holidays.php)
 *        → `mois >= 9 ? année : année - 1`
 *   JS   (emploi.html, getSchoolYear)
 *        → à partir du LUNDI de la semaine contenant le 1er septembre
 *
 * Sur un balayage de trois ans, les deux règles divergent **9 jours** — tous en
 * fin août. Exemple : le lundi 31/08/2026 appartient à la semaine du 1er
 * septembre ; le JS le rattache à 2026, le PHP à 2025.
 *
 * ─── Décision : la règle JavaScript fait foi ───
 * Elle est la seule cohérente avec la numérotation des semaines, où S1 est la
 * semaine CONTENANT le 1er septembre. Le commentaire d'origine dans emploi.html
 * l'explique : avec la règle du mois, « cette semaine s'affichait S53 au lieu
 * de S1 ».
 *
 * ⚠️ Conséquence pour l'ETL (Phase 2) : la migration SQL
 * `schema_annee_scolaire.sql` a réparti les données existantes avec la règle du
 * mois. Les enregistrements datés de la dernière semaine d'août peuvent donc
 * porter la mauvaise année en base et devront être requalifiés.
 */

import { rentreesPour } from './ancres.js';
import { premiereRentree } from './rentree.js';

const SEPTEMBRE = 8; // Date#getMonth() est indexé à partir de 0
/**
 * Mois où la préparation de la rentrée l'emporte sur l'année en cours.
 * Les cours s'achèvent fin juin : à partir de là, ce qu'on configure vaut pour
 * l'année suivante.
 */
const JUIN = 5;

/** Minuit local, pour comparer des jours sans se faire piéger par les heures. */
function auDebutDuJour(date) {
  const copie = new Date(date);
  copie.setHours(0, 0, 0, 0);
  return copie;
}

/**
 * Lundi de la semaine contenant l'ancre de l'année scolaire — la rentrée la
 * plus précoce si l'admin en a saisi, le 1er septembre sinon.
 * C'est l'ancre de tout le calendrier scolaire — et il tombe souvent en AOÛT.
 *
 * ═══ ⚠️ LA RENTRÉE LA PLUS PRÉCOCE REMPLACE LE 1er SEPTEMBRE (demande du
 * porteur, 2026-09-25 : « le S1 n'est pas toujours la première semaine de
 * septembre, prends la date de rentrée saisie en admin ») ═══
 * L'exemple donné : la 2ᵉ et la 3ᵉ année reprennent le 7 septembre 2026, la
 * 1ʳᵉ le 11 — S1 doit être la semaine du 7, pas celle du 1er septembre (le
 * 31 août), qui ne porte alors AUCUN cours nulle part.
 *
 * ⚠️⚠️ CHAQUE ANNÉE SCOLAIRE A SA PROPRE ANCRE (précision du porteur,
 * 2026-09-25 : « chaque année scolaire a sa date de rentrée, chaque année
 * scolaire peut avoir un S1 différent ») — jamais par année de FORMATION :
 * `rentrees` porte les trois niveaux d'UNE SEULE année scolaire, et c'est la
 * plus précoce des trois qui ouvre S1 pour CETTE année-là. La grille reste
 * numérotée S1..S39 de façon UNIQUE et partagée entre tous les niveaux — seule
 * la date qui déclenche S1 change d'une année scolaire à l'autre, jamais d'un
 * niveau à l'autre au sein de la même année.
 *
 * ⚠️ SANS RENTRÉE SAISIE, RIEN NE CHANGE : `premiereRentree` rend `null`, et le
 * 1er septembre reste l'ancre — la même règle que partout ailleurs dans ce
 * projet (« tant que l'admin n'a rien saisi, rien ne change »). C'est aussi ce
 * qui garde CETTE fonction pure et synchrone : elle ne va jamais chercher
 * `rentrees` elle-même, on la lui donne.
 *
 * @param {number} annee  Année de septembre (2025 pour « 2025-2026 »).
 * @param {Array<{anneeFormation: number, date: string}>} [rentrees] — celles
 *   de CETTE année scolaire, telles que stockées dans
 *   `CalendrierNational.rentrees`. Omises, l'ancre reste le 1er septembre.
 * @returns {Date}
 */
export function lundiPremiereSemaine(annee, rentrees = []) {
  if (!Number.isInteger(annee)) {
    throw new TypeError('lundiPremiereSemaine attend une année entière');
  }

  // ⚠️ Omises, ce sont les rentrées RETENUES pour l'année (`ancres.js`) — plus
  //    le 1er septembre en silence : c'était la cause du défaut du 2026-09-28.
  const ouverture = premiereRentree(rentreesPour(annee, rentrees));
  const ancre = ouverture ? new Date(`${ouverture}T12:00:00`) : new Date(annee, SEPTEMBRE, 1);

  const lundi = new Date(ancre);
  // (jour + 6) % 7 → nombre de jours écoulés depuis lundi, dimanche valant 6.
  lundi.setDate(ancre.getDate() - ((ancre.getDay() + 6) % 7));
  return auDebutDuJour(lundi);
}

/**
 * Année scolaire d'une date : l'année du septembre qui l'ouvre.
 *
 * @param {Date} date
 * @returns {number} 2025 pour l'année scolaire « 2025-2026 ».
 */
export function anneeScolaire(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('anneeScolaire attend une Date valide');
  }

  const annee = date.getFullYear();
  return auDebutDuJour(date) >= lundiPremiereSemaine(annee) ? annee : annee - 1;
}

/** Année scolaire en cours aujourd'hui. */
export function anneeScolaireCourante(maintenant = new Date()) {
  return anneeScolaire(maintenant);
}

/**
 * Année scolaire que l'on PRÉPARE aujourd'hui.
 *
 * ═══ POURQUOI ELLE DIFFÈRE DE `anneeScolaireCourante()` ═══
 * `anneeScolaire(date)` répond à « à quelle année appartient CE JOUR ? » — c'est
 * la bonne question pour une séance, un absence, un avancement. Elle est fausse
 * pour la CONFIGURATION : le 16 août, l'année en cours est celle qui s'achève,
 * alors que le directeur saisit sa carte et ses affectations pour la RENTRÉE.
 * L'écran proposait donc « 2025-2026 » à quelqu'un qui préparait « 2026-2027 ».
 *
 * ═══ LA BASCULE EST AU 1ᵉʳ JUIN, PAS AU 1ᵉʳ AOÛT ═══
 * (corrigé le 2026-08-19 — la première version basculait en août)
 *
 * Trois fenêtres, selon ce que le directeur a réellement en tête :
 *
 *   septembre · octobre   → l'année qui vient de S'OUVRIR. Il configure ce
 *                           qu'il va vivre dans la semaine.
 *   novembre → mai        → l'année EN COURS. Cas d'un établissement en retard,
 *                           bien plus fréquent qu'une préparation anticipée : à
 *                           cette saison, ni les inscriptions ni la répartition
 *                           DRIF de l'année suivante n'existent encore.
 *   juin · juillet · août → l'année SUIVANTE. Les cours s'achèvent fin juin ;
 *                           personne ne construit une carte pour une année à
 *                           trois semaines de sa fin.
 *
 * La règle tient donc en un seuil — `mois >= juin` — et non en trois branches :
 * de juin à décembre l'année à préparer est l'année civile courante, de janvier
 * à mai c'est la précédente.
 *
 * ⚠️ Ce n'est qu'un DÉFAUT, pas une contrainte : de novembre à mai la déduction
 * est la moins sûre des trois, et l'assistant de configuration laisse le
 * directeur la changer (sélecteur en tête, `ConfigurationPage`).
 *
 * @param {Date} [maintenant]
 * @returns {number} 2026 pour « 2026-2027 ».
 */
export function anneeScolaireAPreparer(maintenant = new Date()) {
  if (!(maintenant instanceof Date) || Number.isNaN(maintenant.getTime())) {
    throw new TypeError('anneeScolaireAPreparer attend une Date valide');
  }

  return maintenant.getMonth() >= JUIN ? maintenant.getFullYear() : maintenant.getFullYear() - 1;
}

/**
 * Premier et dernier jour d'une année scolaire, en « AAAA-MM-JJ ».
 *
 * ═══ POURQUOI CE N'EST PAS « DU 1ᵉʳ JANVIER AU 31 DÉCEMBRE » ═══
 * L'année scolaire s'ouvre au lundi de la semaine contenant le 1er septembre —
 * lundi qui tombe souvent en AOÛT — et se ferme la veille du lundi suivant.
 * Filtrer sur les deux années CIVILES qu'elle chevauche retient une année de
 * trop : pour « 2025-2026 », cela ramenait les fériés de janvier à août 2025,
 * antérieurs à la rentrée, et ceux de septembre à décembre 2026, postérieurs à
 * la sortie. Le calendrier en affichait 34 au lieu de 17.
 *
 * Les bornes sont des CHAÎNES, comme partout où le projet manipule des dates de
 * calendrier : une `Date` stockée à minuit UTC et relue au Maroc rend la veille.
 *
 * ⚠️ `rentrees` NE VAUT QUE POUR LE DÉBUT, PAS POUR LA FIN : ce sont celles de
 * `annee`, et la fin dépend de l'ancre de `annee + 1` — une année scolaire dont
 * on n'a, ici, aucune rentrée à donner. La borne de fin reste donc calée sur le
 * 1er septembre tant que l'appelant n'a pas de quoi faire mieux.
 *
 * @param {number} annee  Année de septembre (2025 pour « 2025-2026 »).
 * @param {Array<{anneeFormation: number, date: string}>} [rentrees] — celles
 *   de `annee`, voir `lundiPremiereSemaine`.
 * @returns {{debut: string, fin: string}}
 */
export function bornesAnneeScolaire(annee, rentrees = []) {
  if (!Number.isInteger(annee)) {
    throw new TypeError('bornesAnneeScolaire attend une année entière');
  }

  const debut = lundiPremiereSemaine(annee, rentrees);
  const finExclue = lundiPremiereSemaine(annee + 1);
  const fin = new Date(finExclue);
  fin.setDate(fin.getDate() - 1);

  return { debut: enChaine(debut), fin: enChaine(fin) };
}

/** « AAAA-MM-JJ » en heure LOCALE — `toISOString()` décalerait d'un jour. */
function enChaine(date) {
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}

/**
 * Affichage « 2025-2026 ».
 * ← format de `etablissements.annee_scolaire`, conservé pour l'interface — mais
 * jamais pour le stockage, qui reste numérique.
 */
export function libelleAnneeScolaire(annee) {
  if (!Number.isInteger(annee)) {
    throw new TypeError('libelleAnneeScolaire attend une année entière');
  }
  return `${annee}-${annee + 1}`;
}

/**
 * Lecture d'un libellé « 2025-2026 » ou d'un nombre.
 * Sert à absorber les trois représentations de l'existant pendant l'ETL.
 *
 * @returns {number|null} null si la valeur est inexploitable.
 */
export function lireAnneeScolaire(valeur) {
  if (Number.isInteger(valeur)) return valeur;

  const texte = String(valeur ?? '').trim();
  if (texte === '') return null;

  const correspondance = /^(\d{4})/.exec(texte);
  if (!correspondance) return null;

  const annee = Number.parseInt(correspondance[1], 10);
  return annee >= 2000 && annee <= 2100 ? annee : null;
}
