import { useEffect, useState } from 'react';

/**
 * Amène des cases de la grille à l'écran et les surligne un instant
 * (2026-09-27, demande du porteur : depuis la fenêtre Conformité, une séance
 * hors chronogramme doit mener « directement à la case », d'où elle se
 * supprime).
 *
 * ⚠️ LES CASES SONT ATTENDUES, PAS SUPPOSÉES : aller à une séance du soir
 *    bascule la grille, qui se redessine après coup. Un observateur les guette
 *    — 5 s au plus — puis s'arrête.
 *
 * @param {React.RefObject<HTMLElement>} racine — le conteneur de la grille
 * @returns {(cles: string[]) => void} — signaler ces clés `data-case`
 */
const DUREE_SURLIGNAGE_MS = 4000;
const ATTENTE_MAX_MS = 5000;
const SURLIGNAGE = ['ring-2', 'ring-inset', 'ring-destructive', 'bg-destructive/10'];

export function useCasesSignalees(racine) {
  const [demande, setDemande] = useState(null);

  useEffect(() => {
    if (!demande || demande.cles.length === 0) return undefined;
    const voulues = new Set(demande.cles);
    let retrait = null;

    const trouver = () =>
      [...(racine.current?.querySelectorAll('[data-case]') ?? [])].filter((element) =>
        voulues.has(element.dataset.case)
      );

    const montrer = (cellules) => {
      cellules[0].scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      for (const cellule of cellules) cellule.classList.add(...SURLIGNAGE);
      retrait = setTimeout(() => {
        for (const cellule of cellules) cellule.classList.remove(...SURLIGNAGE);
      }, DUREE_SURLIGNAGE_MS);
    };

    const deja = trouver();
    if (deja.length > 0) {
      montrer(deja);
      return () => clearTimeout(retrait);
    }

    const observateur = new MutationObserver(() => {
      const cellules = trouver();
      if (cellules.length === 0) return;
      observateur.disconnect();
      clearTimeout(abandon);
      montrer(cellules);
    });
    observateur.observe(racine.current ?? document.body, { childList: true, subtree: true });
    const abandon = setTimeout(() => observateur.disconnect(), ATTENTE_MAX_MS);

    return () => {
      observateur.disconnect();
      clearTimeout(abandon);
      clearTimeout(retrait);
    };
  }, [demande, racine]);

  // Un objet neuf à chaque appel : signaler deux fois la même case la resurligne.
  return (cles) => setDemande({ cles });
}
