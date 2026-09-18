import { massesCumulees } from './fusion.js';

/**
 * Masse horaire d'une grille : le total de l'année, et ce qu'il représente par
 * semaine.
 *
 * ═══ POURQUOI 35 ET NON 45 ═══
 * La grille compte 45 semaines, mais on ne dispense pas des cours sur les 45 :
 * vacances, stages et examens en retirent une dizaine. 35 est le nombre de
 * semaines de SERVICE retenu par l'établissement — c'est le diviseur qui donne
 * la charge réellement portée chaque semaine.
 *
 * ⚠️ Le rapport ne se lit pas sur la grille. Un total annuel ne dit pas si la
 * semaine sera tenable : 1 060 h paraissent abstraites, 30 h par semaine se
 * comparent immédiatement aux 30 h que peut contenir une semaine. C'est ce
 * chiffre-là qui dit si un chronogramme est jouable AVANT de le remplir.
 */

/** Semaines de service effectives, hors vacances, stages et examens. */
export const SEMAINES_DE_SERVICE = 35;

/**
 * Total annuel d'une liste de modules, présentiel et synchrone confondus.
 *
 * ⚠️ LE SYNCHRONE MUTUALISÉ NE COMPTE QU'UNE FOIS (2026-08-26, défaut signalé
 * par le porteur). En mode formateur, une affectation fusionnée est éclatée en
 * une ligne par groupe — mais la séance est donnée UNE seule fois : additionner
 * les lignes doublait la masse annuelle affichée en tête de bloc. Voir
 * `fusion.js`, qui porte la règle.
 *
 * @param {Array<{masses?: {presentiel?: number, synchrone?: number}}>} modules
 */
export function masseAnnuelle(modules = []) {
  const { presentiel, synchrone } = massesCumulees(modules);
  return arrondir(presentiel + synchrone);
}

/**
 * Charge hebdomadaire correspondante.
 *
 * Arrondie au CENTIÈME et non à l'entier : à 35 semaines, un arrondi à l'unité
 * décale le total de plusieurs dizaines d'heures sur l'année, et le nombre
 * affiché ne se recoupe plus avec la colonne « MHP ».
 */
export function masseHebdomadaire(annuelle) {
  return arrondir(Number(annuelle ?? 0) / SEMAINES_DE_SERVICE);
}

const arrondir = (valeur) => Math.round(valeur * 100) / 100;
