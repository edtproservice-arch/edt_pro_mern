import { useSyncExternalStore } from 'react';

/**
 * Établissement actif — celui sur lequel porte tout ce que l'écran affiche.
 * (2026-09-24, demande du porteur : « pour les formateurs mutualisés, affectés
 * dans deux établissements, il faut pouvoir choisir puis switcher sans se
 * déconnecter ».)
 *
 * ═══ MÊME MÉCANIQUE QUE L'ANNÉE ACTIVE (`anneeActive.js`) ═══ `apiClient` doit
 * poser l'en-tête `X-Etablissement-Id` sur CHAQUE requête, y compris celles
 * déclenchées hors d'un composant — la valeur vit donc hors de React, qui s'y
 * abonne par `useSyncExternalStore`.
 *
 * ⚠️ CE N'EST QU'UNE PRÉFÉRENCE DE CLIENT, PAS UN DROIT : `resolveTenant`
 * (backend) revérifie à CHAQUE requête que l'établissement demandé figure bien
 * dans `etablissementIds` du compte connecté — un identifiant qui traînerait
 * ici (compte partagé sur un poste, ancien collègue) ne donne accès à rien de
 * plus que ce que ce compte-là a le droit de voir.
 *
 * Persistée : un rafraîchissement de page ne doit pas ramener silencieusement
 * un formateur sur l'autre établissement.
 */
const CLE = 'edtpro.etablissementId';
const RE_OBJECTID = /^[a-f0-9]{24}$/;

let etablissementId = lireDepuisStockage();
const abonnes = new Set();

function lireDepuisStockage() {
  try {
    const brut = window.localStorage.getItem(CLE);
    return brut && RE_OBJECTID.test(brut) ? brut : null;
  } catch {
    // Stockage refusé (navigation privée stricte) : on fonctionne sans, le
    // serveur retombe alors sur le premier établissement du compte.
    return null;
  }
}

/** Identifiant de l'établissement actif, ou `null` tant qu'aucun n'a été choisi. */
export function lireEtablissementActif() {
  return etablissementId;
}

export function definirEtablissementActif(valeur) {
  etablissementId = typeof valeur === 'string' && RE_OBJECTID.test(valeur) ? valeur : null;

  try {
    if (etablissementId === null) window.localStorage.removeItem(CLE);
    else window.localStorage.setItem(CLE, etablissementId);
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

/** Abonnement React à l'établissement actif. */
export function useEtablissementActif() {
  return useSyncExternalStore(sAbonner, lireEtablissementActif, () => null);
}
