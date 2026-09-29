import { useEffect } from 'react';

/**
 * Amène à l'écran UNE case du chronogramme — `?groupe=…&module=…&semaine=…`
 * (2026-09-27, demande du porteur : depuis la fenêtre de conformité, « Modifier
 * le chronogramme » doit mener à la case concernée, pas à la page entière).
 *
 * ⚠️ ON ATTEND LA CASE, ON NE LA SUPPOSE PAS : la grille arrive après la liste
 *    des groupes, puis après sa propre requête, puis après le dépli de sa
 *    section. Un observateur la guette et s'arrête dès qu'elle paraît — ou au
 *    bout de 15 s, pour ne pas veiller indéfiniment sur une case qui n'existe
 *    pas (module retiré de la carte entre-temps).
 *
 * ⚠️ COMPARAISON SANS CASSE : la fenêtre de conformité nomme le module en
 *    MAJUSCULES (clé de comparaison du bilan), la grille dans sa graphie
 *    d'origine. `data-case` vaut `groupe||module||semaine`.
 */
const DUREE_SURLIGNAGE_MS = 4000;
const ATTENTE_MAX_MS = 15000;
const SURLIGNAGE = ['ring-2', 'ring-inset', 'ring-primary', 'bg-primary/10'];

export function useCaseCiblee({ groupe, module, semaine }) {
  useEffect(() => {
    if (!groupe || !module || !semaine) return undefined;

    const cherchee = `${groupe}||${module}||${semaine}`.toUpperCase();
    const trouver = () =>
      [...document.querySelectorAll('[data-case]')].find(
        (element) => element.dataset.case.toUpperCase() === cherchee
      );

    let retrait = null;
    const montrer = (cellule) => {
      cellule.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      cellule.classList.add(...SURLIGNAGE);
      retrait = setTimeout(() => cellule.classList.remove(...SURLIGNAGE), DUREE_SURLIGNAGE_MS);
    };

    const deja = trouver();
    if (deja) {
      montrer(deja);
      return () => clearTimeout(retrait);
    }

    const observateur = new MutationObserver(() => {
      const cellule = trouver();
      if (!cellule) return;
      observateur.disconnect();
      clearTimeout(abandon);
      montrer(cellule);
    });
    observateur.observe(document.body, { childList: true, subtree: true });
    const abandon = setTimeout(() => observateur.disconnect(), ATTENTE_MAX_MS);

    return () => {
      observateur.disconnect();
      clearTimeout(abandon);
      clearTimeout(retrait);
    };
  }, [groupe, module, semaine]);
}

/** L'adresse qui mène à cette case. */
export function adresseCase({ groupe, module, semaine }) {
  const requete = new URLSearchParams({ groupe, module, semaine: String(semaine) });
  return `/app/parametres/chronogramme?${requete}`;
}
