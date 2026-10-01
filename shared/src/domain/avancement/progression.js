import { dureeSeance } from '../emploi/grille.js';
import { analyserSemaine } from '../planning/semaines.js';
import { SEMAINES_ANNEE_REGIONALE } from './regional.js';
import { totalAvancement } from './agregation.js';

/**
 * L'avancement de l'ÉTABLISSEMENT semaine après semaine, face au rythme
 * régional.
 *
 * ═══ CE QUE LA COURBE APPORTE, ET QUE LE CHIFFRE NE DIT PAS ═══
 * « 4,1 % » ne dit pas si l'établissement rattrape ou décroche. Posée à côté du
 * rythme régional — qui monte d'une semaine active à l'autre — la progression
 * réelle montre l'écart SE CREUSER ou SE RÉSORBER. C'est la seule lecture qui
 * distingue un retard de début d'année d'un retard qui s'installe.
 *
 * ⚠️ LA COMPARAISON EST GLOBALE, PAS PAR SUJET (correction du porteur,
 * 2026-08-31). Le taux régional est UN nombre pour tout l'établissement : le
 * confronter à chaque module, formateur ou groupe donnait une nappe plate sous
 * cinquante-quatre pics, ce qui n'apprenait rien — ma première version le
 * faisait.
 *
 * ⚠️ LE CUMUL, PAS LA SEMAINE : un taux d'avancement est ce qui a été fait
 * DEPUIS LA RENTRÉE. Tracer les heures de chaque semaine donnerait un dents-de-
 * scie qu'aucune des deux courbes ne pourrait suivre.
 */

/**
 * @param {Array} seances — les séances de l'année, avec `semaine`, `seance`,
 *   `statut`, `estEfm`
 * @param {number} prevu — la masse totale prévue de l'établissement
 * @param {(numero: number) => number|null} rythmeRegional — le taux régional
 *   attendu à la fin de la semaine N
 * @param {number[]} [semainesChomees] — les semaines de vacances, que le graphe
 *   SIGNALE et que le rythme régional ÉCARTE : ce sont les mêmes, et elles
 *   viennent de `semainesDeVacances` pour qu'elles ne puissent pas diverger.
 * @param {Array<{anneeFormation: number, date: string}>} [rentrees] — LES
 *   MÊMES que celles données à `rythmeRegional`/`semainesChomees` : les trois
 *   doivent s'accorder sur la même ancre de S1, sans quoi le numéro d'une
 *   séance décodée ici désignerait une semaine différente de celle que le
 *   rythme régional calcule pour le même chiffre.
 * @returns {Array<{numero, libelle, avancement, regional, vacances}>}
 */
export function progressionEtablissement(
  seances = [],
  prevu = 0,
  rythmeRegional = () => null,
  semainesChomees = [],
  rentrees = []
) {
  const chomees = new Set(semainesChomees);
  const heuresParSemaine = new Map();

  for (const seance of seances) {
    /*
     * ⚠️ LES MÊMES EXCLUSIONS QUE `heuresPosees` : une séance ABSENTE n'a pas eu
     * lieu, et une surveillance d'EFM n'est pas un cours. Deux règles de
     * décompte sur le même écran feraient diverger la courbe du chiffre affiché
     * juste à côté — l'écart le plus difficile à expliquer.
     */
    if (seance.statut === 'absent' || seance.estEfm) continue;

    const analyse = analyserSemaine(seance.semaine, rentrees);
    if (!analyse) continue;
    const { numero } = analyse;

    heuresParSemaine.set(numero, (heuresParSemaine.get(numero) ?? 0) + dureeSeance(seance.seance));
  }

  const points = [];
  let cumul = 0;

  for (let numero = 1; numero <= SEMAINES_ANNEE_REGIONALE; numero += 1) {
    cumul += heuresParSemaine.get(numero) ?? 0;

    points.push({
      numero,
      libelle: `S${numero}`,
      /*
       * ⚠️ `null` ET NON `0` QUAND RIEN N'EST PRÉVU : sans masse déclarée il n'y
       * a pas de taux, et une courbe à zéro se lirait comme un établissement à
       * l'arrêt. Même règle que `taux()`.
       */
      avancement: prevu > 0 ? Math.round((cumul / prevu) * 1000) / 10 : null,
      regional: rythmeRegional(numero),
      /*
       * ⚠️ LA COURBE NE S'INTERROMPT PAS EN VACANCES, elle reste PLATE : le
       * cumul ne recule pas, et une rupture se lirait comme une donnée
       * manquante. Le drapeau ne sert qu'à MARQUER la semaine.
       */
      vacances: chomees.has(numero),
    });
  }

  return points;
}

/*
 * ⚠️ ON PASSE PAR `analyserSemaine`, PAS PAR UN DÉCOUPAGE À LA MAIN : le ZÉRO DE
 * REMPLISSAGE existe en production — « 2026-W039 » côtoie « 2026-W39 » dans
 * `emplois_du_temps` — et cette fonction le traite déjà. Un `split('-W')` ferait
 * disparaître ces semaines de la courbe sans rien signaler.
 */

/**
 * Les heures RÉALISÉES jour par jour, semaine par semaine — la grille d'activité
 * de l'accueil (demande du porteur, 2026-09-28 : « grille des semaines avec les
 * couleurs selon l'avancement, comme celle de Claude Code »).
 *
 * ⚠️ LES MÊMES EXCLUSIONS QUE LA COURBE : une séance ABSENTE n'a pas eu lieu, une
 * surveillance d'EFM n'est pas un cours. La grille et le graphe voisin doivent
 * compter les mêmes heures, sans quoi leurs totaux divergeraient.
 *
 * ⚠️ LE JOUR VIENT DU CHAMP `jour` DE LA SÉANCE, pas de sa `date` : une date
 * stockée en UTC glisserait d'un jour selon le fuseau du serveur.
 *
 * @param {Array} seances — avec `semaine`, `jour`, `seance`, `statut`, `estEfm`
 * @param {string[]} jours — l'ordre des jours de la grille (Lundi… Samedi)
 * @param {Array} [rentrees] — la même ancre de S1 que `progressionEtablissement`
 * @returns {Map<number, number[]>} numéro de semaine → heures par jour
 */
export function heuresParJour(seances = [], jours = [], rentrees = []) {
  const parSemaine = new Map();

  for (const seance of seances) {
    if (seance.statut === 'absent' || seance.estEfm) continue;

    const analyse = analyserSemaine(seance.semaine, rentrees);
    const rang = jours.indexOf(seance.jour);
    if (!analyse || rang < 0) continue;

    if (!parSemaine.has(analyse.numero)) parSemaine.set(analyse.numero, jours.map(() => 0));
    parSemaine.get(analyse.numero)[rang] += dureeSeance(seance.seance);
  }

  return parSemaine;
}

/**
 * ═══ LA COURBE DE LA FACE E-NOTE ═══ (2026-10-01, signalé par le porteur :
 * « lorsque je bascule e-note, le graphe semaine par semaine reste celui
 * d'eDTpro, alors que l'anneau affiche bien le taux e-note ».)
 *
 * E-note n'a pas d'historique par semaine : chaque IMPORT est un état déclaré.
 * La règle « une seule base par semaine » en fait un point hebdomadaire — le
 * taux de chaque dépôt, calculé comme l'anneau (`totalAvancement` des lignes du
 * fichier), rangé dans la semaine scolaire de son import. Deux dépôts d'une même
 * semaine : le dernier fait foi, comme pour la frise.
 *
 * ⚠️ LE TAUX DE CHAQUE DÉPÔT SUR SON PROPRE PRÉVU : le dernier point vaut ainsi
 * exactement ce que dit l'anneau, qui lit le même fichier.
 *
 * @param {Array<{importeLe: Date|string, lignes: Array}>} depots — lignes déjà
 *   lues par `lireAvancementEnote`
 * @param {(date: Date) => number} semaineDe — le numéro de semaine scolaire d'une date
 * @returns {Array<{numero: number, avancement: number|null, importeLe: string}>}
 */
export function pointsEnote(depots = [], semaineDe) {
  const parSemaine = new Map();
  [...depots]
    .filter((depot) => depot?.importeLe)
    .sort((a, b) => new Date(a.importeLe) - new Date(b.importeLe))
    .forEach((depot) => {
      const { prevu, realise } = totalAvancement(depot.lignes ?? []);
      parSemaine.set(semaineDe(new Date(depot.importeLe)), {
        avancement: prevu > 0 ? Math.round((realise / prevu) * 1000) / 10 : null,
        importeLe: new Date(depot.importeLe).toISOString(),
      });
    });

  return [...parSemaine.entries()]
    .sort(([a], [b]) => a - b)
    .map(([numero, point]) => ({ numero, ...point }));
}

/**
 * La progression eDTpro, réécrite avec les points e-note : même axe, même
 * rythme régional et mêmes vacances — seul l'avancement change de source.
 *
 * ⚠️ ENTRE DEUX DÉPÔTS, LE DERNIER ÉTAT DÉCLARÉ TIENT : e-note ne change que
 * par import. Avant le premier dépôt, rien n'est déclaré (`null`) ; après la
 * semaine en cours, rien n'a encore pu l'être (`null`) — prolonger la courbe
 * jusqu'en S39 annoncerait un état futur.
 */
export function progressionEnote(progression = [], points = [], semaineCourante = null) {
  const parNumero = new Map(points.map((point) => [point.numero, point.avancement]));
  const borne = Math.max(semaineCourante ?? 0, points.at(-1)?.numero ?? 0);
  let courant = null;

  return progression.map((point) => {
    if (parNumero.has(point.numero)) courant = parNumero.get(point.numero);
    return { ...point, avancement: point.numero <= borne ? courant : null };
  });
}
