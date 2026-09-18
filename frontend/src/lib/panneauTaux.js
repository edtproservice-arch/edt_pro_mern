import { creerStockage } from './stockageLocal';

/**
 * Le panneau du taux, à droite du graphe à bâtons, est-il DÉPLIÉ ?
 *
 * ═══ POURQUOI CE RÉGLAGE EXISTE ═══
 * L'anneau et ses mesures décrivent la SÉLECTION ; le graphe, lui, compare les
 * sujets entre eux. Les deux se lisent ensemble — d'où le panneau — mais sur un
 * écran étroit, ou quand on vient seulement comparer des barres, il prend une
 * place qu'on préfère rendre au graphique.
 *
 * ⚠️ UNE PRÉFÉRENCE DE POSTE, PAS UNE DONNÉE : elle reste dans le navigateur et
 * ne part jamais au serveur. Et elle PERSISTE — un état local se serait remis à
 * zéro à chaque retour sur la page, ce qui aurait obligé à replier le panneau
 * dix fois par jour. Même choix que l'épingle de la barre latérale.
 */
const PANNEAU = creerStockage('edtpro.avancement.panneau-taux', true);

export const usePanneauTaux = PANNEAU.utiliser;

export function basculerPanneauTaux() {
  PANNEAU.definir((courant) => !courant);
}
