import { creerStockage } from './stockageLocal';

/**
 * La barre latérale est-elle ÉPINGLÉE ?
 *
 * ═══ POURQUOI CE RÉGLAGE EXISTE ═══
 * La barre se replie d'elle-même au premier clic dans la page : la navigation se
 * fait par à-coups, la grille se lit en continu, et rendre les 16 rem au contenu
 * est ce qu'on veut presque toujours. Presque — sur un grand écran, ou quand on
 * passe d'un réglage à l'autre, la voir se refermer sans arrêt est une gêne.
 * L'épingle rend la main.
 *
 * ⚠️ UNE PRÉFÉRENCE DE POSTE, PAS UNE DONNÉE : elle reste dans le navigateur et
 * ne part jamais au serveur — le même directeur peut vouloir la barre épinglée
 * sur son grand écran et repliée sur son portable. Même choix que les réglages
 * d'affichage (`preferencesAffichage`).
 */
const EPINGLAGE = creerStockage('edtpro.barre-epinglee', false);

export const lireEpinglage = EPINGLAGE.obtenir;
export const useEpinglage = EPINGLAGE.utiliser;

export function basculerEpinglage() {
  EPINGLAGE.definir((courant) => !courant);
}
