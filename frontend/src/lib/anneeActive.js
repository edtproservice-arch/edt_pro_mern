import { useSyncExternalStore } from 'react';

/**
 * Année scolaire active — celle sur laquelle porte tout ce que l'écran affiche.
 *
 * ═══ POURQUOI HORS DE REACT ═══
 * `apiClient` doit poser l'en-tête `X-Annee-Scolaire` sur CHAQUE requête, y
 * compris celles déclenchées hors d'un composant. Un contexte React ne lui
 * serait pas accessible : la valeur vit donc dans ce module, et React s'y
 * abonne par `useSyncExternalStore`.
 *
 * Elle est persistée : un rafraîchissement de page ne doit pas ramener
 * silencieusement le directeur sur une autre année que celle qu'il consultait.
 */
const CLE = 'edtpro.anneeScolaire';

let annee = lireDepuisStockage();
const abonnes = new Set();

function lireDepuisStockage() {
  try {
    const brut = Number(window.localStorage.getItem(CLE));
    return Number.isInteger(brut) && brut >= 2000 && brut <= 2100 ? brut : null;
  } catch {
    // Stockage refusé (navigation privée stricte) : on fonctionne sans, le
    // serveur retombe alors sur l'année de l'établissement.
    return null;
  }
}

/** Année active, ou `null` tant qu'aucune n'a été choisie. */
export function lireAnneeActive() {
  return annee;
}

export function definirAnneeActive(valeur) {
  /*
   * ⚠️ `Number(null)` vaut 0, et `Number.isInteger(0)` est VRAI : sans ce
   * filtre, effacer l'année posait l'en-tête `X-Annee-Scolaire: 0`, que le
   * serveur écarte silencieusement pour retomber sur l'année de
   * l'établissement — le bon résultat, par accident, et un 0 écrit dans le
   * stockage local.
   */
  const nombre = valeur === null || valeur === undefined || valeur === '' ? NaN : Number(valeur);
  annee = Number.isInteger(nombre) && nombre >= 2000 && nombre <= 2100 ? nombre : null;

  try {
    if (annee === null) window.localStorage.removeItem(CLE);
    else window.localStorage.setItem(CLE, String(annee));
  } catch {
    // Sans stockage, le choix ne survit pas au rechargement — mais il vaut
    // pour la session en cours, ce qui est déjà l'essentiel.
  }

  for (const abonne of abonnes) abonne();
}

function sAbonner(rappel) {
  abonnes.add(rappel);
  return () => abonnes.delete(rappel);
}

/** Abonnement React à l'année active. */
export function useAnneeActive() {
  return useSyncExternalStore(sAbonner, lireAnneeActive, () => null);
}
