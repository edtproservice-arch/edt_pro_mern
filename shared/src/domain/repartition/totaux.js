/**
 * ═══ LES TOTAUX D'UNE LIGNE DE RÉPARTITION SE CALCULENT (2026-10-10, demande du
 * porteur : « MHP totale et MHD totale se calculent automatiquement ») ═══
 *
 *   MHP totale = MHP S1 + MHP S2
 *   MHD totale = MHSYN S1 + MHASYN S1 + MHSYN S2 + MHASYN S2  — le DISTANCIEL,
 *                synchrone et asynchrone réunis.
 *
 * Vérifié sur le référentiel en place : la règle MHD tient pour 13 370 lignes sur
 * 13 379, la règle MHP pour 12 873.
 *
 * ⚠️ UN TOTAL SANS DÉTAIL PAR SEMESTRE RESTE CE QU'IL EST. Les 506 lignes où la
 * règle MHP ne tient pas ont TOUTES leurs masses semestrielles à zéro et un
 * total renseigné (315 h, 120 h…) : des modules connus seulement par leur volume
 * global. Recalculer y écrirait 0 au premier enregistrement. Le total n'est donc
 * calculé que si le détail existe ; sinon il reste saisi à la main.
 *
 * Une fonction du domaine, lue par le formulaire ET par le serveur : la règle ne
 * peut pas diverger entre ce que l'écran affiche et ce qui est enregistré.
 */
const n = (valeur) => {
  const nombre = Number(valeur ?? 0);
  return Number.isFinite(nombre) ? nombre : 0;
};

/** Arrondi au centième : 0,1 + 0,2 ne doit pas afficher 0,30000000000000004. */
const centieme = (valeur) => Math.round(valeur * 100) / 100;

/**
 * @param {object} ligne  une ligne de répartition (ou les valeurs du formulaire)
 * @returns {{ mhpTotale: number, mhdTotale: number, mhpCalculee: boolean, mhdCalculee: boolean }}
 */
export function totauxRepartition(ligne) {
  const presentiel = centieme(n(ligne?.mhpS1) + n(ligne?.mhpS2));
  const distanciel = centieme(n(ligne?.mhsynS1) + n(ligne?.mhasynS1) + n(ligne?.mhsynS2) + n(ligne?.mhasynS2));
  return {
    mhpTotale: presentiel > 0 ? presentiel : n(ligne?.mhpTotale),
    mhdTotale: distanciel > 0 ? distanciel : n(ligne?.mhdTotale),
    mhpCalculee: presentiel > 0,
    mhdCalculee: distanciel > 0,
  };
}

/** La ligne, ses deux totaux recalculés. */
export function avecTotauxRepartition(ligne) {
  const { mhpTotale, mhdTotale } = totauxRepartition(ligne);
  return { ...ligne, mhpTotale, mhdTotale };
}
