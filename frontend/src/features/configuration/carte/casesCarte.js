/**
 * Clés des cases de la carte d'affectations, pour les curseurs et la case
 * ouverte des collègues (Phase 5bis, 2026-09-13).
 *
 * ═══ ⚠️ UNE CLÉ PAR CE QUI SE SAISIT, PAS PAR PIXEL ═══
 * Comme sur l'emploi du temps et le chronogramme : on envoie la case survolée et
 * la fraction de sa largeur, et chaque écran la reprojette sur SA carte.
 *
 *   - `P::<ensemble>::<groupe>::<module>` — une cellule de la matrice présentielle ;
 *   - `S::<ensemble>::<module>`          — le bloc synchrone d'un module ;
 *   - `E::<ensemble>`                    — l'en-tête d'un ensemble.
 *
 * ⚠️ L'ENSEMBLE FAIT PARTIE DE LA CLÉ, et c'est ce qui permet le REPLI : une
 * case qu'un collègue saisit dans un ensemble que j'ai laissé REPLIÉ — les 26
 * ensembles le sont d'office — n'existe pas chez moi. Son cadre « X modifie » se
 * pose alors sur l'en-tête de l'ensemble, qui, lui, est toujours là.
 *
 * ⚠️ `::` ET NON `||` : la clé d'ensemble (`cleEnsemble` du domaine) contient
 * déjà `||` — filière, année, mode. Un même séparateur rendrait la clé
 * impossible à redécouper.
 */
const SEPARATEUR = '::';

export function cleCasePresentiel(ensemble, groupe, module) {
  return ['P', ensemble, groupe, module].join(SEPARATEUR);
}

export function cleCaseSynchrone(ensemble, module) {
  return ['S', ensemble, module].join(SEPARATEUR);
}

export function cleEnTeteEnsemble(ensemble) {
  return ['E', ensemble].join(SEPARATEUR);
}

/**
 * L'en-tête de l'ensemble d'une case — `null` pour ce qui n'en a pas (un
 * en-tête n'a pas de repli : il est toujours affiché).
 */
export function repliCase(cle) {
  const [nature, ensemble] = String(cle ?? '').split(SEPARATEUR);
  if ((nature !== 'P' && nature !== 'S') || !ensemble) return null;
  return cleEnTeteEnsemble(ensemble);
}
