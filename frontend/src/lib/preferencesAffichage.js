import { creerStockage } from './stockageLocal';

/**
 * Réglages d'affichage de la zone de contenu.
 * ← « Petit texte » et « pleine largeur » du menu Notion
 *
 * Ce sont des préférences de LECTURE, pas des données : elles restent dans le
 * navigateur et ne partent jamais au serveur. Deux personnes du même
 * établissement peuvent donc lire la même page autrement.
 */
const AFFICHAGE = creerStockage('edtpro.affichage', { petitTexte: false, pleineLargeur: false });

export const lireAffichage = AFFICHAGE.obtenir;
export const useAffichage = AFFICHAGE.utiliser;

export function basculerAffichage(clef) {
  // ⚠️ Un objet NEUF à chaque bascule : `useSyncExternalStore` compare par
  // identité, une mutation en place ne redéclencherait aucun rendu.
  AFFICHAGE.definir((courant) => ({ ...courant, [clef]: !courant[clef] }));
}

/**
 * Classes à poser sur la zone de contenu.
 *
 * ⚠️ Les deux règles vivent dans `globals.css` et non ici : elles doivent
 * REDÉFINIR les utilitaires Tailwind (`text-sm`, `max-w-*`) que les pages
 * posent elles-mêmes. Une classe utilitaire de plus sur le conteneur n'y
 * suffirait pas — c'est l'erreur de la première version, où « petit texte » ne
 * changeait rien à l'écran parce que 55 % des éléments fixent leur taille.
 */
export function classesAffichage({ petitTexte, pleineLargeur }) {
  return [petitTexte && 'petit-texte', pleineLargeur && 'pleine-largeur']
    .filter(Boolean)
    .join(' ');
}
