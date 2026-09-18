import { lundiPremiereSemaine } from '../planning/anneeScolaire.js';
import { jourFerie, stageDuGroupe, vacances } from '../planning/calendrier.js';
import { dateRentree } from '../planning/rentree.js';

/**
 * Le TAUX OBJECTIF PÉDAGOGIQUE d'un groupe.
 * ← `calculateObjectiveRate()` d'avancement.html (l. 2461-2524)
 *
 * ═══ CE QU'IL DIT, ET POURQUOI IL VAUT UNE COURBE ═══
 * C'est la part des JOURS DE FORMATION déjà écoulés sur l'année du groupe —
 * autrement dit, où il DEVRAIT en être s'il avançait exactement au rythme du
 * calendrier. Comparé au taux d'avancement réel, il dit d'un regard qui est en
 * avance et qui décroche. Un taux de 40 % ne veut rien dire seul : en novembre
 * c'est de l'avance, en mai c'est un retard de six mois.
 *
 * ⚠️ IL NE COMPTE PAS LES JOURS DU CALENDRIER, MAIS LES JOURS OUVRÉS RÉELS :
 * dimanches, jours fériés, vacances et STAGES DU GROUPE sont retirés. Deux
 * groupes de la même promotion n'ont donc pas le même objectif si l'un part en
 * entreprise et l'autre non — et c'est exactement ce qu'on veut comparer.
 *
 * ═══ ⚠️ DEUX DÉFAUTS DE L'EXISTANT NON REPRODUITS ═══
 * 1. `today.getMonth() >= 8` — la règle du MOIS, celle que le §2 du plan
 *    signale comme fausse : elle diverge de la vraie règle sur les neuf
 *    derniers jours d'août. On part de `lundiPremiereSemaine`, comme partout.
 * 2. `date.toISOString().slice(0, 10)` — au Maroc, minuit local est 23 h UTC la
 *    VEILLE : chaque jour était comparé au calendrier sous la date du jour
 *    précédent. C'est le décalage déjà corrigé sur les absences.
 */

/**
 * Les fins d'année de formation, par niveau.
 * ← le `switch (groupInfo.niveau)` de l'existant, repris tel quel : ce sont des
 * dates réglementaires, pas un réglage d'affichage.
 */
const FINS = {
  1: { mois: 6, jour: 18 }, // 18 juillet
  2: { mois: 5, jour: 2 }, //  2 juin
  3: { mois: 0, jour: 6 }, //  6 janvier
};
const FIN_PAR_DEFAUT = FINS[1];

/**
 * @param {object} options
 * @param {number} options.anneeScolaire — année de septembre (2026 pour 2026-2027)
 * @param {number} options.annee — l'année de formation du groupe (1, 2, 3)
 * @param {string} options.groupe — pour retirer SES périodes de stage
 * @param {Date|string} [options.aujourdhui] — la date d'observation
 * @param {Array} [options.joursFeries] · [options.vacances] · [options.stages]
 * @param {Array<{anneeFormation, date}>} [options.rentrees] — l'année du groupe
 *   ne commence qu'à SA rentrée ; sans réglage, on repart de la S1.
 * @returns {number|null} — pourcentage, ou `null` si l'année ne porte aucun jour
 *   ouvré (état impossible en pratique, mais `0 %` s'y lirait comme un retard).
 */
export function tauxObjectifPedagogique({
  anneeScolaire,
  annee,
  groupe,
  aujourdhui = new Date(),
  joursFeries = [],
  vacances: periodesVacances = [],
  stages = [],
  rentrees = [],
}) {
  if (!Number.isInteger(anneeScolaire)) return null;

  /*
   * ═══ ⚠️ L'ANNÉE COMMENCE À LA RENTRÉE DU GROUPE, PAS À LA S1 ═══
   * (décision du porteur, 2026-09-02.) Les 1ʳᵉ années reprennent le 11
   * septembre quand les 2ᵉ sont là depuis le 7 : partir du lundi de la S1 pour
   * tout le monde comptait comme « écoulés » des jours où la promotion
   * n'existait pas encore, et son objectif partait donc en avance sur elle.
   *
   * ⚠️ CONSTRUITE À MIDI, jamais à minuit : minuit local est 23 h UTC la veille
   * au Maroc, et la date reculerait d'un jour — le décalage déjà corrigé trois
   * fois dans ce projet.
   *
   * ⚠️ SANS RÉGLAGE, ON GARDE LA S1. C'est la même règle que partout ailleurs :
   * tant que l'admin n'a rien saisi, rien ne change.
   */
  const rentree = dateRentree(annee, rentrees);
  const debut = rentree
    ? new Date(`${rentree}T12:00:00`)
    : lundiPremiereSemaine(anneeScolaire);
  const finition = FINS[annee] ?? FIN_PAR_DEFAUT;
  const fin = new Date(anneeScolaire + 1, finition.mois, finition.jour);

  if (fin < debut) return null;

  const observation = aujourdhui instanceof Date ? aujourdhui : new Date(aujourdhui);
  // ⚠️ Passé la fin de formation, l'objectif est 100 %, pas davantage.
  const borne = observation > fin ? fin : observation;

  let ouvres = 0;
  let ecoules = 0;

  const curseur = new Date(debut);
  while (curseur <= fin) {
    if (estJourDeFormation(curseur, groupe, { joursFeries, periodesVacances, stages })) {
      ouvres += 1;
      if (curseur <= borne) ecoules += 1;
    }
    curseur.setDate(curseur.getDate() + 1);
  }

  if (ouvres === 0) return null;
  return Math.round((ecoules / ouvres) * 1000) / 10;
}

/**
 * ⚠️ LE SAMEDI EST UN JOUR DE FORMATION. Seul le dimanche est exclu — la grille
 * porte six jours (`JOURS`), et l'existant ne retirait que `getDay() === 0`.
 * Le compter comme chômé raccourcirait l'année d'un sixième et l'objectif
 * paraîtrait toujours en avance.
 */
function estJourDeFormation(date, groupe, { joursFeries, periodesVacances, stages }) {
  if (date.getDay() === 0) return false;
  if (jourFerie(date, joursFeries)) return false;
  if (vacances(date, periodesVacances)) return false;
  // ⚠️ Le stage est propre au GROUPE : c'est ce qui distingue deux objectifs.
  if (stageDuGroupe(groupe, date, stages)) return false;
  return true;
}

/**
 * L'objectif de chaque groupe, en une passe.
 *
 * ⚠️ IL SE CALCULE UNE FOIS PAR GROUPE, pas par ligne : le parcours va de
 * septembre à juillet, soit ~320 itérations, et le refaire pour chacune des
 * 238 lignes coûterait 76 000 tours pour vingt et un résultats distincts.
 */
export function objectifsParGroupe(lignes = [], contexte = {}) {
  const annees = new Map();
  for (const ligne of lignes) {
    if (ligne.groupe && !annees.has(ligne.groupe)) annees.set(ligne.groupe, ligne.annee);
  }

  const objectifs = {};
  for (const [groupe, annee] of annees) {
    objectifs[groupe] = tauxObjectifPedagogique({ ...contexte, groupe, annee });
  }
  return objectifs;
}
