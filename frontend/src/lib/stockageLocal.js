import { useSyncExternalStore } from 'react';

/**
 * Petit socle pour les valeurs persistées lues par React.
 * ← même mécanique que `lib/anneeActive.js`, extraite pour ne pas la réécrire.
 *
 * ═══ POURQUOI HORS DE REACT ═══
 * Ces réglages sont lus par des composants qui n'ont pas de parent commun
 * proche — l'en-tête, la barre latérale, le contenu. Un contexte imposerait de
 * remonter un fournisseur au-dessus de tout, et de re-rendre l'application
 * entière à chaque bascule. La valeur vit donc dans ce module, et React s'y
 * abonne par `useSyncExternalStore`.
 *
 * ⚠️ Le stockage peut être REFUSÉ (navigation privée stricte, cookies bloqués).
 * Chaque accès est donc gardé : sans cela, ouvrir l'application dans une
 * fenêtre privée la ferait planter au démarrage, sur un réglage d'affichage.
 */
export function creerStockage(cle, valeurParDefaut, { lire, ecrire } = {}) {
  const decoder = lire ?? ((brut) => JSON.parse(brut));
  const encoder = ecrire ?? ((valeur) => JSON.stringify(valeur));

  let valeur = charger();
  const abonnes = new Set();

  function charger() {
    try {
      const brut = window.localStorage.getItem(cle);
      return brut === null ? valeurParDefaut : decoder(brut);
    } catch {
      // Stockage refusé, ou contenu illisible parce qu'écrit par une version
      // précédente : on repart du défaut plutôt que de propager l'erreur.
      return valeurParDefaut;
    }
  }

  const obtenir = () => valeur;

  function definir(nouvelle) {
    valeur = typeof nouvelle === 'function' ? nouvelle(valeur) : nouvelle;

    try {
      window.localStorage.setItem(cle, encoder(valeur));
    } catch {
      // Sans stockage, le réglage ne survit pas au rechargement — mais il vaut
      // pour la session en cours, ce qui est déjà l'essentiel.
    }

    for (const abonne of abonnes) abonne();
  }

  function sAbonner(rappel) {
    abonnes.add(rappel);
    return () => abonnes.delete(rappel);
  }

  /*
   * ⚠️ `useSyncExternalStore` compare les instantanés par IDENTITÉ. `obtenir`
   * doit donc rendre la MÊME référence tant que rien ne change — c'est le cas
   * ici, puisque `valeur` n'est remplacée que dans `definir`. Recalculer un
   * objet à chaque appel provoquerait une boucle de rendu infinie.
   */
  const utiliser = () => useSyncExternalStore(sAbonner, obtenir, () => valeurParDefaut);

  return { obtenir, definir, sAbonner, utiliser };
}
