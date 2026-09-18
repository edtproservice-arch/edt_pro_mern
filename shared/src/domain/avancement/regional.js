import { lundiPremiereSemaine } from '../planning/anneeScolaire.js';
import { enJour, vacances } from '../planning/calendrier.js';
import { premiereRentree } from '../planning/rentree.js';

/**
 * Le TAUX D'AVANCEMENT RÉGIONAL.
 * ← le calcul de `#regional-progress-rate` d'avancement.html (l. 3216-3260)
 *
 *     Taux Régional = (semaines actives passées / semaines actives de l'année)
 *                     × 100,   l'année allant de S1 à S39
 *
 * ═══ CE QU'IL EST, ET CE QU'IL N'EST PAS ═══
 * C'est le rythme ATTENDU AU NIVEAU RÉGIONAL : une référence unique pour tout
 * l'établissement, calculée en SEMAINES, sur un calendrier de 39 semaines dont
 * on retire les vacances.
 *
 * ⚠️ IL NE SE CONFOND PAS AVEC LE TAUX OBJECTIF PÉDAGOGIQUE, qui vit dans
 * `objectif.js` : celui-ci compte des JOURS ouvrés, GROUPE PAR GROUPE, en
 * retirant aussi les stages, et s'arrête à la fin de formation du niveau. L'un
 * dit « où la région attend l'établissement », l'autre « où ce groupe-ci devrait
 * en être ». Les deux se comparent au réalisé, mais ils ne répondent pas à la
 * même question — et c'est pour cela qu'ils coexistent.
 *
 * ═══ ⚠️ TROIS DÉFAUTS DE L'EXISTANT NON REPRODUITS ═══
 * 1. `new Date('2025-09-08T00:00:00')` — la date de S1 était CODÉE EN DUR. Le
 *    taux se serait figé sur 2025-2026 et aurait été faux dès la rentrée
 *    suivante. On part de `lundiPremiereSemaine`, comme partout ailleurs.
 * 2. `toISOString().slice(0, 10)` — au Maroc, minuit local est 23 h UTC la
 *    VEILLE : chaque lundi était comparé au calendrier sous la date du dimanche.
 *    C'est le décalage déjà corrigé sur les absences et sur l'objectif.
 * 3. Le repli « 35 semaines » masquait une absence de calendrier derrière un
 *    chiffre plausible. Ici, aucune semaine active rend `null` — un taux qu'on
 *    ne sait pas calculer ne doit pas s'afficher comme un taux nul.
 *
 * ═══ ⚠️⚠️ LES SEMAINES AVANT LA RENTRÉE NE COMPTENT PAS (2026-09-03, demande
 * du porteur) ═══ Cette année, les 2ᵉ et 3ᵉ années reprennent le 7 septembre et
 * les 1ʳᵉ le 11 : la S1 (du 31 août) ne porte donc AUCUN cours nulle part, et
 * annoncer malgré cela un rythme régional de 2,8 % à la S1 prétendait un
 * retard là où rien n'avait encore pu commencer.
 * `premiereRentree()` rend la plus PRÉCOCE des rentrées déclarées, tous
 * niveaux confondus — dès qu'UN SEUL niveau a sa date, l'établissement n'est
 * plus totalement fermé, et c'est cette date qui ouvre l'année régionale.
 * Une semaine dont le lundi tombe AVANT cette ouverture est traitée EXACTEMENT
 * comme une semaine de vacances : retirée du TOTAL, pas seulement des semaines
 * « passées » — c'est la même logique que `tauxObjectifPedagogique`, qui fait
 * commencer le décompte d'un groupe à SA rentrée plutôt qu'à la S1.
 * ⚠️ SANS RENTRÉE DÉCLARÉE, RIEN NE CHANGE : `premiereRentree` rend `null`, et
 * le calcul retombe sur la S1 — la même règle que partout ailleurs dans ce
 * projet (« tant que l'admin n'a rien saisi, rien ne change »).
 */

/** L'année régionale court de S1 à S39, soit 38 semaines après la première. */
export const SEMAINES_ANNEE_REGIONALE = 39;

/**
 * Les semaines de S1 à S39 dont le LUNDI tombe en vacances.
 *
 * ⚠️ EXTRAITE DE `tauxRegional`, PAS RECOPIÉE À CÔTÉ : les deux répondent à la
 * même question — « cette semaine compte-t-elle ? » — et le graphe qui les
 * SIGNALE doit désigner exactement celles que le taux ÉCARTE. Deux parcours
 * séparés auraient fini par montrer une semaine que le calcul n'a pas retirée.
 *
 * @returns {number[]} numéros de semaine, dans l'ordre
 */
export function semainesDeVacances({ anneeScolaire, vacances: periodes = [] }) {
  if (!Number.isInteger(anneeScolaire)) return [];

  const lundi = lundiPremiereSemaine(anneeScolaire);
  const numeros = [];

  for (let semaine = 1; semaine <= SEMAINES_ANNEE_REGIONALE; semaine += 1) {
    /*
     * ⚠️ UNE SEMAINE EST JUGÉE SUR SON LUNDI, comme dans l'existant. C'est
     * grossier — une période qui commence un mercredi laisse la semaine
     * « active » — mais c'est une référence RÉGIONALE, pas un décompte d'heures :
     * la raffiner ici la ferait diverger du chiffre que les établissements
     * comparent entre eux.
     */
    if (vacances(lundi, periodes)) numeros.push(semaine);
    lundi.setDate(lundi.getDate() + 7);
  }

  return numeros;
}

/**
 * @param {object} options
 * @param {number} options.anneeScolaire — année de septembre (2026 pour 2026-2027)
 * @param {Date|string} [options.aujourdhui]
 * @param {Array} [options.vacances] — périodes `{debut, fin}`
 * @param {Array<{anneeFormation, date}>} [options.rentrees] — sans elles, on
 *   repart de la S1 comme avant cette révision.
 * @returns {{taux: number, passees: number, total: number}|null}
 */
export function tauxRegional({
  anneeScolaire,
  aujourdhui = new Date(),
  vacances: periodes = [],
  rentrees = [],
}) {
  if (!Number.isInteger(anneeScolaire)) return null;

  const debut = lundiPremiereSemaine(anneeScolaire);
  const observation = aujourdhui instanceof Date ? aujourdhui : new Date(aujourdhui);
  if (!enJour(observation)) return null;

  const chomees = new Set(semainesDeVacances({ anneeScolaire, vacances: periodes }));
  const ouverture = premiereRentree(rentrees);

  let total = 0;
  let passees = 0;

  const lundi = new Date(debut);
  for (let semaine = 1; semaine <= SEMAINES_ANNEE_REGIONALE; semaine += 1) {
    // ⚠️ AVANT L'OUVERTURE = MÊME TRAITEMENT QU'UNE VACANCE : hors du total.
    const avantOuverture = ouverture !== null && enJour(lundi) < ouverture;
    if (!chomees.has(semaine) && !avantOuverture) {
      total += 1;
      if (lundi <= observation) passees += 1;
    }
    lundi.setDate(lundi.getDate() + 7);
  }

  // ⚠️ `null`, jamais 0 : un taux qu'on ne sait pas calculer n'est pas un retard.
  if (total === 0) return null;

  // Borné à 100 : passé S39, la région n'attend pas davantage.
  const taux = Math.min(100, Math.round((passees / total) * 1000) / 10);
  return { taux, passees, total };
}
