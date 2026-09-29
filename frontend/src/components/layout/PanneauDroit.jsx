import { createContext, useContext, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Un panneau latéral DROIT, à la manière de Notion (2026-09-28, demande du
 * porteur, capture de Notion à l'appui) : une colonne de la FENÊTRE, collée au
 * bord droit, sur toute la hauteur — pas une carte posée dans la page.
 *
 * ═══ COMMENT ═══
 * La coquille place un EMPLACEMENT à droite de la zone de page, dans la même
 * rangée flexible. Une page y « téléporte » son panneau (`createPortal`) ; la
 * zone de page — barre du haut comprise — se resserre alors d'elle-même, sans
 * que rien soit recouvert. Vide, l'emplacement ne prend aucune largeur.
 *
 * ⚠️ `display: contents` SUR L'EMPLACEMENT : le panneau devient un enfant
 *    DIRECT de la rangée, donc un élément flex à part entière. Un `div`
 *    ordinaire s'intercalerait et le panneau n'aurait plus sa pleine hauteur.
 *
 * ⚠️ SANS COQUILLE (test, page isolée), le panneau se rend EN PLACE plutôt que
 *    de disparaître : mieux vaut un panneau mal placé qu'un rapport invisible.
 */
const Contexte = createContext(null);

export function FournirPanneauDroit({ children }) {
  const [emplacement, setEmplacement] = useState(null);
  return (
    <Contexte.Provider value={{ emplacement, setEmplacement }}>{children}</Contexte.Provider>
  );
}

/** À poser par la coquille, juste APRÈS la zone de page, dans la même rangée. */
export function EmplacementPanneauDroit() {
  const contexte = useContext(Contexte);
  return <div ref={contexte?.setEmplacement} className="contents print:hidden" />;
}

/** Ce qu'une page affiche dans le panneau de droite. */
export function PanneauDroit({ children }) {
  const contexte = useContext(Contexte);
  if (!contexte?.emplacement) return children;
  return createPortal(children, contexte.emplacement);
}
