import { creerStockage } from './stockageLocal';

/**
 * Dernier passage sur chaque page, par chemin.
 * ← la section « Récents » de l'accueil
 *
 * ═══ ⚠️ VISITÉE, PAS MODIFIÉE ═══
 * `derniereModification` existe déjà et dit tout autre chose : « vous avez
 * ENREGISTRÉ cette page ». Or on revient bien plus souvent sur un écran qu'on
 * n'y écrit — l'emploi du temps se consulte dix fois pour une saisie. Mêler les
 * deux ferait disparaître des « Récents » précisément les pages qu'on regarde le
 * plus, et l'en-tête afficherait « Modifié à l'instant » sur une page qu'on n'a
 * fait qu'ouvrir.
 *
 * ⚠️ TRACE LOCALE, comme les favoris et les préférences d'affichage : elle décrit
 * CE POSTE. Un directeur qui consulte depuis chez lui n'y retrouvera pas les
 * pages ouvertes au bureau — c'est le comportement attendu d'un historique de
 * navigation, pas une limitation à corriger.
 */
const VISITES = creerStockage('edtpro.visites', {});

/**
 * Combien de pages on garde.
 *
 * Au-delà, ce n'est plus un « récent » mais un journal : on ne retrouve plus
 * rien, et le stockage local grossit sans fin.
 */
const RETENUES = 12;

export const useVisites = VISITES.utiliser;

export function marquerVisitee(chemin) {
  VISITES.definir((courantes) => {
    const suivantes = { ...courantes, [chemin]: Date.now() };

    const gardees = Object.entries(suivantes)
      .sort(([, a], [, b]) => b - a)
      .slice(0, RETENUES);

    return Object.fromEntries(gardees);
  });
}
