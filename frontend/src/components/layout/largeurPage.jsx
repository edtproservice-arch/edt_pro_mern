import { createContext, useContext } from 'react';

/**
 * De quelle largeur une page dispose — décidé par la COQUILLE, pas par la page.
 * (2026-09-06, demande du porteur : « mettre le max width de la page le même
 * max width du navbar pour toutes les pages des sessions formateur et
 * stagiaire ».)
 *
 * ═══ ⚠️ POURQUOI UN CONTEXTE, ET NON UNE PROP SUR CHAQUE PAGE ═══
 * `CadreReglage` bornait toutes ses pages à `max-w-4xl` — juste pour un écran
 * de réglages, qui aligne des lignes de texte qu'on ne lit pas plus large ; faux
 * pour les sessions formateur et stagiaire, dont les tableaux comptent jusqu'à
 * NEUF colonnes et s'y trouvaient coupés à droite.
 *
 * Poser la largeur page par page, ce serait un réglage à ne pas oublier à
 * chaque écran ajouté — et le premier oublié rétrécirait sans qu'aucune erreur
 * ne le signale. La coquille le décide UNE fois, pour tout ce qu'elle monte,
 * pages à venir comprises.
 *
 * ⚠️ ELLE PORTE UNE CLASSE, PAS UN BOOLÉEN : c'est la valeur exportée par la
 * barre (`LARGEUR_BARRE`) qui voyage, de sorte que le contenu se cale sur la
 * mesure RÉELLE de la barre plutôt que sur une constante recopiée.
 */
const ContexteLargeurPage = createContext(null);

export const FournirLargeurPage = ContexteLargeurPage.Provider;

/** La classe de largeur imposée par la coquille, ou `null` si elle n'en pose pas. */
export function useLargeurPage() {
  return useContext(ContexteLargeurPage);
}
