import { enJour } from './jour.js';

/**
 * Rentrée scolaire par année de formation, et gel de ce qui la précède.
 * (demande du porteur, 2026-09-02.)
 *
 * ═══ POURQUOI CETTE NOTION EXISTE ═══
 * Les groupes ne rentrent pas tous le même jour : en 2026-2027, les 2ᵉ et 3ᵉ
 * années reprennent le 7 septembre, les 1ʳᵉ années le 11. Poser une séance à un
 * groupe avant SA rentrée, c'est promettre un cours à des stagiaires qui ne sont
 * pas encore inscrits.
 *
 * ═══ ⚠️ UNE PORTÉE NOUVELLE : L'ANNÉE DE FORMATION ═══
 * Les quatre causes d'indisponibilité déjà connues portent sur l'ÉTABLISSEMENT
 * (férié, vacances), sur un GROUPE (stage) ou sur une PERSONNE (formation).
 * Celle-ci porte sur une ANNÉE DE FORMATION — donc sur un sous-ensemble de
 * groupes, et sur AUCUN formateur en particulier : le même enseignant peut avoir
 * cours avec ses 2ᵉ années le 8 septembre et rien avec ses 1ʳᵉ années.
 */

/**
 * La date de rentrée d'une année de formation.
 *
 * ⚠️ `null` QUAND ELLE N'EST PAS PARAMÉTRÉE, jamais une date par défaut : sans
 * réglage, RIEN ne doit être gelé. Inventer « le 1er septembre » figerait des
 * journées que personne n'a déclarées fermées.
 *
 * @param {number} anneeFormation  1, 2, 3…
 * @param {Array<{anneeFormation: number, date: string}>} rentrees
 * @returns {string|null} « AAAA-MM-JJ »
 */
export function dateRentree(anneeFormation, rentrees = []) {
  const annee = Number.parseInt(anneeFormation, 10);
  if (!Number.isInteger(annee)) return null;

  const trouvee = rentrees.find((r) => Number.parseInt(r?.anneeFormation, 10) === annee);
  return trouvee?.date ? enJour(trouvee.date) : null;
}

/**
 * La plus PRÉCOCE des rentrées déclarées, tous niveaux confondus.
 *
 * ⚠️ SERT AU TAUX RÉGIONAL, PAS AU CHRONOGRAMME (2026-09-03, demande du
 * porteur). `dateRentree` répond pour UN niveau, parce que le chronogramme et
 * l'objectif pédagogique gèlent GROUPE PAR GROUPE, chacun sur SA rentrée. Le
 * taux régional, lui, est un chiffre UNIQUE pour tout l'établissement : dès
 * qu'UN SEUL niveau a commencé, l'établissement n'est plus totalement à
 * l'arrêt — c'est cette première date qui compte.
 *
 * ⚠️ `null` SI AUCUNE RENTRÉE N'EST DÉCLARÉE, jamais une date par défaut :
 * même règle que `dateRentree` — sans réglage, rien ne change.
 *
 * @param {Array<{anneeFormation: number, date: string}>} rentrees
 * @returns {string|null} « AAAA-MM-JJ »
 */
export function premiereRentree(rentrees = []) {
  const dates = rentrees.map((r) => enJour(r?.date)).filter(Boolean);
  if (dates.length === 0) return null;
  return dates.reduce((plusTot, date) => (date < plusTot ? date : plusTot));
}

/**
 * Ce jour précède-t-il la rentrée de cette année de formation ?
 *
 * ⚠️ LA COMPARAISON EST TEXTUELLE : les dates sont des chaînes « AAAA-MM-JJ »,
 * dont l'ordre alphabétique EST l'ordre chronologique. Passer par `Date`
 * rouvrirait le décalage de fuseau déjà corrigé trois fois dans ce projet.
 *
 * @returns {{date: string, anneeFormation: number}|null} la rentrée attendue,
 *   ou `null` si le jour est à partir de la rentrée — ou si rien n'est réglé.
 */
export function avantRentree(date, anneeFormation, rentrees = []) {
  const jour = enJour(date);
  if (!jour) return null;

  const rentree = dateRentree(anneeFormation, rentrees);
  if (!rentree) return null;

  return jour < rentree
    ? { date: rentree, anneeFormation: Number.parseInt(anneeFormation, 10) }
    : null;
}

/**
 * Les jours d'une semaine qui tombent AVANT la rentrée.
 *
 * Sert au chronogramme, qui raisonne en semaines : une semaine à cheval sur la
 * rentrée n'est pas fermée, elle est RÉDUITE — exactement comme une semaine
 * amputée par un stage de trois jours.
 *
 * @param {string[]} joursDeLaSemaine  les dates « AAAA-MM-JJ » de la semaine
 * @returns {number} le nombre de jours perdus
 */
export function joursAvantRentree(joursDeLaSemaine = [], anneeFormation, rentrees = []) {
  const rentree = dateRentree(anneeFormation, rentrees);
  if (!rentree) return 0;

  return joursDeLaSemaine.filter((jour) => {
    const normalise = enJour(jour);
    return normalise !== null && normalise < rentree;
  }).length;
}

/**
 * Fusionne les vacances nationales avec celles de l'établissement.
 * ← le même mécanisme que `fusionnerJoursFeries`, et pour la même raison.
 *
 * ═══ ⚠️ « PAR DÉFAUT » NE VEUT PAS DIRE « IMPOSÉ » ═══ (décision du porteur,
 * 2026-09-02.) L'admin pose les vacances du réseau ; l'établissement peut en
 * ÉCARTER une qui ne le concerne pas, et ajouter les siennes. Sans cela, un
 * établissement qui ferme un jour de plus n'aurait aucun moyen de le dire — et
 * y poserait des séances.
 *
 * ⚠️ L'APPARIEMENT SE FAIT SUR LE NOM, comme pour les fériés : c'est la seule
 * clé stable quand l'admin décale une période d'un jour. Deux périodes
 * nationales ne peuvent donc pas porter le même nom — le service le refuse.
 *
 * @param {Array<{nom: string, debut: string, fin: string}>} nationales
 * @param {Array<{nom: string, debut: string, fin: string}>} propres
 * @param {string[]} ecartees  noms des périodes nationales mises de côté
 * @returns {Array<{nom, debut, fin, origine: 'nationale'|'etablissement'}>}
 */
export function fusionnerVacances(nationales = [], propres = [], ecartees = []) {
  const misesDeCote = new Set(ecartees.map((nom) => cle(nom)));

  const retenues = nationales
    .filter((periode) => !misesDeCote.has(cle(periode?.nom)))
    .map((periode) => ({
      nom: periode.nom,
      debut: enJour(periode.debut),
      fin: enJour(periode.fin),
      origine: 'nationale',
    }));

  const locales = propres.map((periode) => ({
    nom: periode.nom,
    debut: enJour(periode.debut),
    fin: enJour(periode.fin),
    origine: 'etablissement',
  }));

  return [...retenues, ...locales]
    .filter((periode) => periode.debut && periode.fin)
    .sort((a, b) => a.debut.localeCompare(b.debut));
}

const cle = (valeur) => String(valeur ?? '').trim().toLowerCase();
