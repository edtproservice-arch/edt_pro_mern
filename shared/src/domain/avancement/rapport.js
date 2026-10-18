import { agregerAvancement, dimensionComplement, totalAvancement } from './agregation.js';
import { FILTRES_VIDES, filtrerAvancement } from './filtres.js';

/**
 * ═══ LE RAPPORT D'AVANCEMENT D'UN FORMATEUR OU D'UN GROUPE (2026-10-17) ═══
 * Les lignes d'un rapport — une par module, avec son graphe à bâtons et son
 * tableau côté serveur : ce qui est affecté et ce qui est réalisé.
 *
 * ⚠️ LES AUTRES FILTRES DE LA PAGE S'APPLIQUENT : le rapport est celui de la
 * vue filtrée (« selon formateur / groupe filtré ») — filtré sur le semestre 1,
 * le rapport d'un formateur ne parle que de ses modules du S1. Seule la facette
 * du sujet est remplacée par le sujet lui-même.
 *
 * ⚠️ UN FORMATEUR NE PORTE QUE SES PROPRES HEURES : le présentiel et le
 * synchrone d'un même module peuvent être assurés par deux personnes — la
 * règle de l'axe formateur (`agregerAvancement`). Les heures de l'autre sont
 * retirées avant d'agréger, sinon son rapport lui prêterait celles d'un collègue.
 *
 * ⚠️ LE TOTAL VIENT DE `totalAvancement`, jamais de la somme des lignes : un
 * formateur dont la séance synchrone est mutualisée entre deux groupes la voit
 * sur deux lignes (une par groupe), mais ne l'a donnée qu'une fois.
 *
 * @param {Array} brutes — les lignes d'avancement de la face affichée
 * @param {{type: 'formateur'|'groupe', sujet: string, filtres?: object,
 *          intitules?: object, intitulesParGroupe?: object}} options
 * @returns {{sujet, total: {affecte, realise, …}, lignes: Array<{module, intitule, complement, affecte, realise, …}>}}
 *   — affecté et réalisé, et leur part présentielle et distancielle : les quatre
 *   séries du graphe, comme celui de la page (2026-10-17).
 */
export function rapportAvancement(brutes = [], { type, sujet, filtres = FILTRES_VIDES, intitules = {}, intitulesParGroupe = {} }) {
  const filtresSujet = { ...FILTRES_VIDES, ...filtres, [type]: [sujet] };
  let retenues = filtrerAvancement(brutes, filtresSujet);

  if (type === 'formateur') {
    retenues = retenues.map((ligne) => ({
      ...ligne,
      ...(ligne.formateurPresentiel === sujet ? {} : { prevuPresentiel: 0, realisePresentiel: 0 }),
      ...(ligne.formateurSynchrone === sujet ? {} : { prevuSynchrone: 0, realiseSynchrone: 0 }),
    }));
  }

  // Formateur → ses modules, un par groupe ; groupe → ses modules et leurs formateurs.
  const complement = dimensionComplement('module', filtresSujet);
  const lignes = agregerAvancement(retenues, 'module', complement)
    .filter((ligne) => ligne.prevu > 0 || ligne.realise > 0)
    .map((ligne) => {
      const groupe = type === 'groupe' ? sujet : ligne.ventilation;
      return {
        module: ligne.sujet,
        intitule: (groupe && intitulesParGroupe[`${groupe}||${ligne.sujet}`]) || intitules[ligne.sujet] || '',
        complement: ligne.ventilation ?? ligne.complements.join(', '),
        affecte: ligne.prevu,
        realise: ligne.realise,
        ...repartition(ligne),
      };
    });

  const total = totalAvancement(retenues);
  return { sujet, total: { affecte: total.prevu, realise: total.realise, ...repartition(total) }, lignes };
}

/** Les quatre séries du graphe : affecté et réalisé, en présentiel et en distanciel (synchrone). */
const repartition = (valeurs) => ({
  affectePresentiel: valeurs.prevuPresentiel,
  affecteDistanciel: valeurs.prevuSynchrone,
  realisePresentiel: valeurs.realisePresentiel,
  realiseDistanciel: valeurs.realiseSynchrone,
});
