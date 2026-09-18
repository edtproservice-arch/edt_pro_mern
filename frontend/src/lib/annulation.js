import { useSyncExternalStore } from 'react';

/**
 * Annulation du dernier enregistrement, par page.
 * ← « Défaire » du menu de la barre d'outils
 *
 * ═══ POURQUOI UN REGISTRE HORS DE REACT ═══
 * Le menu « Défaire » vit dans l'EN-TÊTE, la donnée dans la PAGE. Les deux n'ont
 * pas de parent commun proche — l'en-tête est monté par la coquille, autour
 * d'un `Outlet`. La page dépose donc ici de quoi revenir en arrière, et
 * l'en-tête s'y abonne.
 *
 * ═══ CE QUE « DÉFAIRE » DÉFAIT EXACTEMENT ═══
 * Le dernier ENREGISTREMENT, pas la dernière frappe. Les écrans de réglages
 * s'écrivent seuls après une pause de saisie : c'est cette écriture qui est
 * l'événement, et c'est elle qu'on veut pouvoir reprendre. Annuler frappe à
 * frappe demanderait un historique de saisie, que rien ne tient.
 *
 * ⚠️ RIEN N'EST PERSISTÉ. Un rechargement vide l'historique — c'est voulu : la
 * page relit alors sa donnée du serveur, et une pile survivante proposerait de
 * restaurer un état qui n'a plus de rapport avec ce qui est affiché.
 *
 * ⚠️ L'ÉTAT RESTAURÉ EST RÉÉCRIT. `restaurer` repose la valeur dans l'état de la
 * page ; l'enregistrement automatique la renvoie au serveur comme n'importe
 * quelle modification. Défaire n'est donc pas une lecture : c'est une écriture
 * de plus, et elle s'annule à son tour.
 */
const registre = new Map();
const abonnes = new Set();

function prevenir() {
  for (const abonne of abonnes) abonne();
}

function entree(chemin) {
  if (!registre.has(chemin)) registre.set(chemin, { pile: [], restaurer: null });
  return registre.get(chemin);
}

/**
 * La page se déclare capable d'annuler.
 * @param {string} chemin
 * @param {(valeur: unknown) => void} restaurer  repose la valeur dans l'état
 */
export function declarerAnnulable(chemin, restaurer) {
  entree(chemin).restaurer = restaurer;
  prevenir();
}

/** La page quitte l'écran : sa pile n'a plus de sens. */
export function oublierAnnulation(chemin) {
  registre.delete(chemin);
  prevenir();
}

/**
 * Empile l'état d'AVANT un enregistrement.
 *
 * ⚠️ Une copie profonde par JSON, et non la référence : les pages travaillent
 * sur des tableaux qu'elles mutent parfois en place. Empiler la référence
 * reviendrait à empiler l'état futur, et « Défaire » ne défairait rien.
 */
export function empilerAvantEnregistrement(chemin, valeur) {
  if (valeur === undefined) return;

  const courante = entree(chemin);
  // 20 pas suffisent largement pour un écran de réglages, et bornent la mémoire.
  courante.pile = [...courante.pile.slice(-19), structuredClone(valeur)];
  prevenir();
}

export function peutAnnuler(chemin) {
  const courante = registre.get(chemin);
  return Boolean(courante?.restaurer) && (courante?.pile.length ?? 0) > 0;
}

/** @returns {boolean} vrai si quelque chose a réellement été annulé. */
export function annuler(chemin) {
  const courante = registre.get(chemin);
  if (!courante?.restaurer || courante.pile.length === 0) return false;

  const precedente = courante.pile.at(-1);
  courante.pile = courante.pile.slice(0, -1);
  prevenir();

  courante.restaurer(precedente);
  return true;
}

function sAbonner(rappel) {
  abonnes.add(rappel);
  return () => abonnes.delete(rappel);
}

/** Abonnement React : le menu s'active et se désactive tout seul. */
export function usePeutAnnuler(chemin) {
  return useSyncExternalStore(
    sAbonner,
    () => peutAnnuler(chemin),
    () => false
  );
}
