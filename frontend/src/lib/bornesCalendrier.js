import { bornesAnneeScolaire } from 'shared/domain';

/**
 * Bornes de navigation d'un calendrier, pour l'année scolaire active.
 *
 * ═══ POURQUOI BORNER ═══
 * Sans borne, un calendrier laisse remonter à 2019 et descendre à 2031. Or tout
 * ce qui se saisit ici — vacances, stages, formations — est rattaché à UNE année
 * scolaire, celle du sélecteur en tête de barre. Une date posée en dehors est
 * enregistrée sans erreur, puis n'est jamais retrouvée : `estDisponible()`
 * interroge l'année courante, et la période saisie appartient à une autre.
 * C'est une indisponibilité invisible, qui ne se manifeste qu'au moment où le
 * générateur place une séance sur un groupe pourtant en entreprise.
 *
 * ⚠️ Les bornes ne sont PAS « 1er septembre → 31 août ». Elles viennent de
 * `bornesAnneeScolaire()`, donc du lundi de la semaine contenant le 1er
 * septembre — un lundi qui tombe souvent en AOÛT. Arrondir au 1er septembre
 * rendrait inaccessibles les premiers jours de l'année, ceux de la semaine S1.
 *
 * @param {number|null} anneeScolaire année de septembre (2026 pour « 2026-2027 »)
 * @returns {object} propriétés à étaler sur `<Calendar>` — vide si l'année est
 *   inconnue, auquel cas mieux vaut un calendrier libre qu'un calendrier borné
 *   sur une année devinée.
 */
export function bornesCalendrier(anneeScolaire) {
  if (!Number.isInteger(anneeScolaire)) return {};

  const { debut, fin } = bornesAnneeScolaire(anneeScolaire);
  const premierJour = enDate(debut);
  const dernierJour = enDate(fin);

  return {
    // Limite la NAVIGATION : les flèches s'arrêtent, on ne sort pas de l'année.
    startMonth: premierJour,
    endMonth: dernierJour,
    /*
     * Et limite la SÉLECTION : les mois de bordure affichent des jours qui
     * débordent de l'année (fin août avant la rentrée, début septembre après la
     * sortie). Visibles mais non cliquables, ils disent où l'année s'arrête au
     * lieu de laisser croire à un oubli.
     */
    disabled: [{ before: premierJour }, { after: dernierJour }],
  };
}

/** « AAAA-MM-JJ » → minuit LOCAL. `new Date('2026-08-31')` serait de l'UTC. */
function enDate(jour) {
  return new Date(`${jour}T00:00:00`);
}
