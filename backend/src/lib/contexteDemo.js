import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * ═══ LA DÉMO NE SORT JAMAIS DE SON BAC À SABLE (2026-11-01) ═══
 * Un visiteur de la page d'accueil essaie EDT Pro dans une copie fictive d'établissement
 * (`modules/demo`). Tout ce qu'il fait doit rester dedans : aucun e-mail, aucune notification
 * poussée vers un appareil. Plutôt que de garder chaque fonctionnalité une à une, la requête
 * d'un compte de démo porte ce contexte (posé par `authenticate`) — et les deux portes de
 * sortie (`envoyerEmail`, `envoyerPush`) le lisent.
 */
const stockage = new AsyncLocalStorage();

/** Exécute la suite de la requête « en démo ». */
export function executerEnDemo(suite) {
  return stockage.run({ demo: true }, suite);
}

/** La requête en cours vient-elle d'un compte de démo ? */
export function estRequeteDemo() {
  return stockage.getStore()?.demo === true;
}

/** Les comptes de démo ont une adresse en `.invalid` : le domaine est réservé, rien n'y part. */
export const DOMAINE_DEMO = 'demo.invalid';
export const estAdresseDemo = (adresse) => String(adresse ?? '').toLowerCase().endsWith(`@${DOMAINE_DEMO}`);
