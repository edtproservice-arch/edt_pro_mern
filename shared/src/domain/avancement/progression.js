import { dureeSeance } from '../emploi/grille.js';
import { analyserSemaine } from '../planning/semaines.js';
import { SEMAINES_ANNEE_REGIONALE } from './regional.js';

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
 * @returns {Array<{numero, libelle, avancement, regional, vacances}>}
 */
export function progressionEtablissement(
  seances = [],
  prevu = 0,
  rythmeRegional = () => null,
  semainesChomees = []
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

    const analyse = analyserSemaine(seance.semaine);
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
