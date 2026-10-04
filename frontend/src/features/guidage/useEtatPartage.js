import { useEffect, useRef } from 'react';
import { envoyerGuidage } from '@/lib/tempsReel';

/**
 * ═══ L'ÉTAT D'UNE PAGE, PARTAGÉ PENDANT LE GUIDAGE (2026-10-04) ═══
 * (signalé par le porteur : « dans l'emploi, la sélection et le déplacement ne
 * s'affichent pas chez le directeur, et inversement ».)
 *
 * Certains gestes ne passent par AUCUN élément cliquable que `gestes.js` saurait
 * retrouver : sélectionner des cases à la souris, glisser une séance. Ce qu'ils
 * produisent vit dans l'état de la page. La page le PUBLIE donc elle-même, sous
 * une clé (`emploi.selection`), et l'autre écran l'applique tel quel.
 *
 * ⚠️ JAMAIS D'ÉCHO : la valeur reçue est retenue ; quand elle revient dans
 * l'état de la page qui vient de l'appliquer, elle n'est pas renvoyée.
 */
const appliquants = new Map();
const recues = new Map();
let actif = false;

/** Posé par `Guidage` : hors d'une séance de guidage, rien ne part. */
export function definirGuidageActif(valeur) {
  actif = valeur;
}

/** Appelé par `Guidage` à la réception d'un `guide-etat`. */
export function recevoirEtat({ cle, valeur }) {
  const appliquer = appliquants.get(cle);
  if (!appliquer) return;
  recues.set(cle, JSON.stringify(valeur));
  appliquer(valeur);
}

/**
 * Une empreinte courte et STABLE d'un texte (djb2, en base 36) — pour nommer un
 * état d'après ce qu'il concerne (les lignes d'une grille) sans faire voyager
 * la liste entière dans la clé. Les deux écrans affichent les mêmes lignes : ils
 * calculent la même empreinte.
 */
export function empreinte(texte) {
  let h = 5381;
  for (let i = 0; i < texte.length; i += 1) h = ((h << 5) + h + texte.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const PAS_MS = 80;
const TAILLE_MAX = 12_000;

/**
 * @param {string} cle      nom de l'état, propre à la page (`emploi.selection`)
 * @param {*} valeur        la valeur SÉRIALISABLE à partager (chaînes, tableaux, objets plats)
 * @param {(valeur) => void} appliquer  pose une valeur reçue dans l'état de la page
 */
export function useEtatPartage(cle, valeur, appliquer) {
  const appliquerRef = useRef(appliquer);
  appliquerRef.current = appliquer;

  useEffect(() => {
    const rappel = (v) => appliquerRef.current(v);
    appliquants.set(cle, rappel);
    return () => {
      if (appliquants.get(cle) === rappel) appliquants.delete(cle);
      recues.delete(cle);
    };
  }, [cle]);

  const texte = JSON.stringify(valeur);
  useEffect(() => {
    if (!actif) return undefined;
    // La valeur qu'on vient de RECEVOIR : la renvoyer ferait rebondir l'état.
    if (recues.get(cle) === texte) return undefined;
    recues.delete(cle);
    // ⚠️ Le serveur coupe une socket au-delà de 16 Kio par message : une sélection
    // géante (toute la grille) n'est pas partagée plutôt que de couper le guidage.
    if (texte.length > TAILLE_MAX) return undefined;
    const minuteur = setTimeout(() => envoyerGuidage({ type: 'guide-etat', cle, valeur: JSON.parse(texte) }), PAS_MS);
    return () => clearTimeout(minuteur);
  }, [cle, texte]);
}
