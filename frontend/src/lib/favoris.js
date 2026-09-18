import { creerStockage } from './stockageLocal';

/**
 * Pages mises en favori, par chemin.
 *
 * ═══ UNE ÉTOILE QUI NE MÈNE NULLE PART NE SERT À RIEN ═══
 * Mettre en favori n'a de sens que si les favoris se retrouvent quelque part :
 * ils forment un groupe en TÊTE de la barre latérale. Sans cela, l'étoile
 * n'aurait été qu'un interrupteur décoratif.
 *
 * Le chemin sert de clé, et non un identifiant à part : c'est ce que l'étoile
 * connaît, et ce qui permet de recomposer le lien sans rien stocker de plus.
 */
const FAVORIS = creerStockage('edtpro.favoris', []);

export const useFavoris = FAVORIS.utiliser;
export const lireFavoris = FAVORIS.obtenir;

export function estFavori(chemin) {
  return FAVORIS.obtenir().includes(chemin);
}

export function basculerFavori(chemin) {
  FAVORIS.definir((courants) =>
    courants.includes(chemin)
      ? courants.filter((autre) => autre !== chemin)
      : // Ajouté à la FIN : l'ordre des favoris est celui où on les a posés,
        // pas l'inverse. Une liste qui se réordonne toute seule se relit mal.
        [...courants, chemin]
  );
}
