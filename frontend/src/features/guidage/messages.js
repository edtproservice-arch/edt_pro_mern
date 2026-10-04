import { toast } from 'sonner';

/**
 * ═══ LES MESSAGES PENDANT LE GUIDAGE (2026-10-04) ═══
 * (demande du porteur : « n'importe quel message qui s'affiche chez moi
 * s'affiche chez lui ».)
 *
 * Les notifications naissent d'un geste — un enregistrement réussi, une case
 * refusée — et seul l'écran qui l'a fait les voit. Plutôt que d'aller les
 * chercher dans chaque page (des centaines d'appels à `toast`), on regarde la
 * zone des notifications : tout toast qui y APPARAÎT est décrit en texte et
 * reproduit chez l'autre.
 *
 * ⚠️ JAMAIS D'ÉCHO : un toast reproduit porte `MARQUE`, et n'est pas renvoyé.
 */
const MARQUE = 'guidage-recu';
const GENRES = ['success', 'error', 'info', 'warning'];

const texte = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Observe la zone des notifications ; `envoyer` reçoit chaque nouveau toast. */
export function observerMessages(envoyer) {
  const vus = new WeakSet();

  const decrire = (toastElement) => {
    if (vus.has(toastElement)) return;
    vus.add(toastElement);
    if (toastElement.classList.contains(MARQUE)) return;
    // Le contenu est posé au rendu suivant celui qui crée l'élément.
    requestAnimationFrame(() => {
      const type = toastElement.getAttribute('data-type');
      // Un chargement en cours se change en succès ou en erreur : c'est CE toast-là qui compte.
      if (type === 'loading') return;
      const titre = texte(toastElement.querySelector('[data-title]')).slice(0, 300);
      if (!titre) return;
      const description = texte(toastElement.querySelector('[data-description]')).slice(0, 1000);
      envoyer({ genre: GENRES.includes(type) ? type : 'default', titre, ...(description ? { description } : {}) });
    });
  };

  const observateur = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const noeud of mutation.addedNodes) {
        if (!(noeud instanceof Element)) continue;
        if (noeud.matches('[data-sonner-toast]')) decrire(noeud);
        else noeud.querySelectorAll?.('[data-sonner-toast]').forEach(decrire);
      }
    }
  });
  // ⚠️ Le corps entier, mais SEULEMENT les ajouts de nœuds : Sonner monte sa liste à la demande.
  observateur.observe(document.body, { childList: true, subtree: true });
  return () => observateur.disconnect();
}

/** Reproduit un message reçu de l'autre écran. */
export function afficherMessage({ genre, titre, description }) {
  const afficher = GENRES.includes(genre) ? toast[genre] : toast;
  afficher(titre, { ...(description ? { description } : {}), className: MARQUE });
}
