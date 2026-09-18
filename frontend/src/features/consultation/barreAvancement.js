/**
 * Les deux segments de la barre d'avancement — présentiel et distanciel.
 *
 * ═══ ⚠️⚠️ ELLE PART DU TOTAL DÉJÀ CALCULÉ, JAMAIS DES LIGNES ═══
 * (2026-09-06, défaut signalé par le porteur : « en affectation 120 h synchrone
 * mais en avancement 160 h ».)
 *
 * Ma première version SOMMAIT les lignes d'avancement. Or celles-ci sont
 * ÉCLATÉES PAR GROUPE : une séance synchrone mutualisée — « OPCM101 OPCM102 » —
 * y figure une fois par groupe, et sa masse était donc comptée deux fois. Le
 * chiffre en tête du même écran, lui, passe par `totalAvancement`, qui
 * DÉDOUBLONNE par ensemble : les deux se contredisaient à quelques centimètres,
 * et la ventilation (800 + 160) ne faisait même plus le total affiché (920).
 *
 * ⚠️ LA RÈGLE DU DÉDOUBLONNAGE N'EST PAS RÉÉCRITE ICI : elle vit dans
 * `agregerAvancement`, que `totalAvancement` appelle. La recopier aurait été un
 * cinquième exemplaire d'une règle déjà tenue par le bilan de charge, le bouton
 * « Charge », la feuille du classeur et les masses du chronogramme — la cause
 * n°1 d'instabilité du §4.2. Cette fonction ne fait plus QUE des pourcentages.
 *
 * ⚠️ LES DEUX SEGMENTS SE MESURENT SUR LE PRÉVU TOTAL, pas chacun sur le sien.
 * Deux pourcentages calculés sur des bases différentes ne s'additionnent pas :
 * leur somme ne ferait plus le taux global écrit juste au-dessus, et la barre
 * dirait autre chose que le chiffre qu'elle illustre.
 */

/**
 * @param {object} total  le résultat de `totalAvancement(lignes)` — déjà
 *   dédoublonné. Les champs lus : `prevuPresentiel`, `prevuSynchrone`,
 *   `realisePresentiel`, `realiseSynchrone`.
 * @returns {{realisePresentiel, realiseSynchrone, prevuPresentiel, prevuSynchrone,
 *            prevu, partPresentiel, partSynchrone}}
 */
export function partsAvancement(total = {}) {
  const realisePresentiel = total.realisePresentiel ?? 0;
  const realiseSynchrone = total.realiseSynchrone ?? 0;
  const prevuPresentiel = total.prevuPresentiel ?? 0;
  const prevuSynchrone = total.prevuSynchrone ?? 0;
  const prevu = prevuPresentiel + prevuSynchrone;

  /*
   * ⚠️ BORNÉES À 100 % À ELLES DEUX, pas chacune de son côté : un dépassement
   * du présentiel ne doit pas pousser le distanciel hors de la piste. Le
   * dépassement reste écrit en chiffres — c'est une information — mais une
   * barre qui déborde se lit comme un défaut d'affichage. Même règle que la
   * barre de chaque ligne du tableau.
   */
  const part = (heures) => (prevu > 0 ? (heures / prevu) * 100 : 0);
  const partPresentiel = Math.min(part(realisePresentiel), 100);
  const partSynchrone = Math.min(part(realiseSynchrone), 100 - partPresentiel);

  return {
    realisePresentiel,
    realiseSynchrone,
    prevuPresentiel,
    prevuSynchrone,
    prevu,
    partPresentiel,
    partSynchrone,
  };
}
