/**
 * Recopie des GESTES du guidage (2026-10-04, demande du porteur : « chaque
 * action que je fais s'affiche chez le directeur » — basculer Avancement en
 * e-note, changer de vue, ouvrir la barre latérale…).
 *
 * ═══ ON RECOPIE LE GESTE, PAS L'ÉCRAN ═══
 * Le clic de l'administrateur est décrit — QUEL élément, retrouvable sur un
 * autre écran — puis rejoué chez le directeur, sur SA page. Ni pixels, ni
 * identifiants React : les deux écrans n'ont pas la même largeur, et seul ce
 * que l'utilisateur voit (rôle, libellé, rang) est commun aux deux.
 *
 * ═══ ⚠️ UN CLIC QUI ÉCRIT N'EST JAMAIS REJOUÉ ═══
 * « Publier », « Supprimer », un export : rejoués, ils écriraient DEUX fois.
 * L'émetteur ne décrit donc un clic qu'APRÈS avoir vérifié qu'il n'a lancé
 * aucune requête d'écriture (`useGuidageEmetteur`). Le résultat d'une écriture
 * arrive chez le directeur par le temps réel, comme pour tout collègue.
 *
 * ═══ ⚠️ UN ÉTAT, PAS UNE BASCULE ═══
 * Pour un interrupteur, un onglet, un volet qui s'ouvre, on transmet l'état
 * VOULU (« coché ») et le directeur ne clique que si le sien diffère. Rejouer
 * « basculer » sur un écran déjà dans le bon état l'aurait remis à l'envers.
 */

/** Ce qui se clique et se retrouve. Un lien (`a[href]`) n'en est pas : la navigation suit déjà l'adresse. */
const CLIQUABLES = [
  'button',
  '[role="button"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitem"]',
  '[aria-expanded]',
  '[aria-pressed]',
  'summary',
  'input[type="checkbox"]',
  'input[type="radio"]',
].join(',');

/** Les champs dont la saisie se recopie. Jamais un mot de passe. */
const CHAMPS = 'input:not([type]),input[type="text"],input[type="search"],input[type="number"],input[type="date"],input[type="week"],textarea,select';

const IGNORER = '[data-guidage-ignorer]';

/** La portée où compter les rangs : ce qui diffère entre deux coquilles n'y entre pas. */
const PORTEES = {
  dialogue: '[role="dialog"],[role="alertdialog"]',
  menu: '[role="menu"],[role="listbox"]',
  panneau: '[data-panneau-droit]',
  barre: '[data-sidebar="sidebar"]',
  contenu: '[data-zone-guidage]',
};

function porteeDe(element) {
  for (const [nom, selecteur] of Object.entries(PORTEES)) {
    const racine = element.closest(selecteur);
    if (racine) return { nom, racine };
  }
  return { nom: 'document', racine: document.body };
}

/** La racine d'une portée chez le directeur — la DERNIÈRE ouverte pour un dialogue ou un menu. */
function racineDe(nom) {
  if (nom === 'document') return document.body;
  const toutes = document.querySelectorAll(PORTEES[nom]);
  return toutes[toutes.length - 1] ?? null;
}

/*
 * ═══ TOUT CE QUE L'APPLICATION ÉCOUTE (2026-10-04, demande du porteur : « fais
 * pareil pour toutes les pages ») ═══ Une case de tableau, une carte, une ligne,
 * un bâton de graphique se cliquent sans être des boutons : aucun rôle ne les
 * désigne. React, lui, le sait — il range les gestionnaires d'un nœud dans une
 * propriété `__reactProps$…`. Un élément qui y porte un `onClick` (ou un
 * appui, un relâchement, un double clic) est cliquable, et se retrouve chez
 * l'autre parmi ses semblables : même balise, même texte, même rang.
 */
const GESTIONNAIRES = ['onClick', 'onMouseDown', 'onPointerDown', 'onPointerUp', 'onDoubleClick'];

const PREFIXE_PROPS = '__reactProps' + '$';

function aGestionnaire(element) {
  const cle = Object.keys(element).find((k) => k.startsWith(PREFIXE_PROPS));
  const props = cle ? element[cle] : null;
  return Boolean(props) && GESTIONNAIRES.some((nom) => typeof props[nom] === 'function');
}

const generique = (element) => !element.matches(CLIQUABLES) && aGestionnaire(element);

const genreDe = (element) =>
  element.getAttribute('data-sidebar') === 'trigger'
    ? 'barre'
    : generique(element)
      ? `react:${element.tagName.toLowerCase()}`
      : element.getAttribute('role') || element.tagName.toLowerCase();

const texteDe = (element) =>
  (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

const etiquetteChamp = (element) =>
  (element.getAttribute('aria-label') || element.getAttribute('name') || element.getAttribute('placeholder') || '').slice(0, 120);

/** Les éléments d'une portée qui portent la même signature, dans l'ordre du document. */
function semblables(racine, selecteur, genre, texte, lireTexte) {
  // Un élément « écouté » se cherche parmi les nœuds de SA balise, pas parmi les boutons.
  const parmi = genre.startsWith('react:') ? genre.slice(6) : selecteur;
  return [...racine.querySelectorAll(parmi)].filter(
    (e) => !e.closest(IGNORER) && genreDe(e) === genre && lireTexte(e) === texte && porteeDe(e).racine === racine
  );
}

/*
 * ═══ UNE ZONE D'ÉDITION (`data-guidage-edition`, 2026-10-04) ═══
 * Une page qui s'enregistre SEULE après chaque retouche (la carte des
 * Affectations) ne peut pas voir ses retouches rejouées : les deux écrans
 * enregistreraient la même modification, et le second se ferait refuser pour
 * version périmée. Dans une telle zone, seuls les gestes d'AFFICHAGE passent —
 * un onglet, un volet qui se déplie. Ce qui modifie arrive chez l'autre par
 * l'annonce temps réel, une fois enregistré.
 */
const EDITION = '[data-guidage-edition]';

/*
 * ⚠️ OUVRIR une liste, un menu ou une fenêtre est un geste d'affichage — c'est
 * ce qu'on CHOISIT dedans qui modifie, et cela reste bloqué
 * (`ouvertDepuisEdition`). L'autre voit la liste s'ouvrir, puis se refermer.
 */
const estAffichage = (element) =>
  Boolean(element.closest('[data-guidage-affichage]')) ||
  element.getAttribute('role') === 'tab' ||
  element.tagName === 'SUMMARY' ||
  element.hasAttribute('aria-expanded') ||
  element.hasAttribute('aria-haspopup');

/** Le plus proche ancêtre « écouté » par React — sans sortir de la zone de contenu. */
function ecouteDe(cible) {
  for (let element = cible; element && element !== document.body; element = element.parentElement) {
    if (element.hasAttribute('data-zone-guidage') || element.hasAttribute('data-panneau-droit')) return null;
    // Un élément dont l'écoute passe déjà par un état partagé (la case de l'emploi du temps).
    if (element.hasAttribute('data-guidage-sans-ecoute')) return null;
    if (aGestionnaire(element)) return element;
  }
  return null;
}

/** L'élément cliquable visé par un clic, ou `null` (un lien, une zone vide, un élément ignoré). */
export function cliquableDe(cible) {
  if (!(cible instanceof Element)) return null;
  const bouton = cible.closest(CLIQUABLES);
  const ecoute = ecouteDe(cible);
  // Le plus PRÉCIS des deux : une case écoutée dans une ligne-bouton, ou l'inverse.
  const element = bouton && ecoute ? (bouton.contains(ecoute) ? ecoute : bouton) : bouton ?? ecoute;
  if (!element || element.closest(IGNORER) || element.closest('a[href]')) return null;
  if (element.matches('input[type="password"]')) return null;
  if (element.closest(EDITION) && !estAffichage(element)) return null;
  // Une liste, un menu ou une fenêtre OUVERTS DEPUIS une zone d'édition sont montés
  // ailleurs (portail) : c'est leur déclencheur qui dit d'où ils viennent.
  if (ouvertDepuisEdition(element)) return null;
  return element;
}

function ouvertDepuisEdition(element) {
  const flottant = element.closest('[role="listbox"],[role="menu"],[role="dialog"],[role="alertdialog"]');
  if (!flottant?.id) return false;
  return Boolean(document.querySelector(`[aria-controls="${CSS.escape(flottant.id)}"]`)?.closest(EDITION));
}

export function champDe(cible) {
  if (!(cible instanceof Element) || !cible.matches(CHAMPS) || cible.closest(IGNORER)) return null;
  // La saisie d'une zone d'édition est une modification : jamais rejouée.
  if (cible.closest(EDITION) || ouvertDepuisEdition(cible)) return null;
  return cible;
}

/** Décrit un élément pour le retrouver sur un autre écran. */
export function decrire(element, { champ = false } = {}) {
  const { nom, racine } = porteeDe(element);
  const genre = genreDe(element);
  const lire = champ ? etiquetteChamp : texteDe;
  const texte = lire(element);
  const rang = semblables(racine, champ ? CHAMPS : CLIQUABLES, genre, texte, lire).indexOf(element);
  return { portee: nom, genre, texte, rang: Math.max(0, rang) };
}

/**
 * Le déclencheur d'une option ou d'un élément de menu — le bouton qui a ouvert
 * la liste (`aria-controls`). Chez le directeur, si la liste n'est pas ouverte
 * quand l'option arrive, on l'ouvre d'abord par lui.
 */
export function declencheurDe(element) {
  if (!element.matches('[role="option"],[role^="menuitem"]')) return null;
  const liste = element.closest('[role="listbox"],[role="menu"]');
  if (!liste?.id) return null;
  const declencheur = document.querySelector(`[aria-controls="${CSS.escape(liste.id)}"]`);
  return declencheur && !declencheur.closest(IGNORER) ? decrire(declencheur) : null;
}

export function retrouver(signature, { champ = false } = {}) {
  const racine = racineDe(signature.portee);
  if (!racine) return null;
  const liste = semblables(racine, champ ? CHAMPS : CLIQUABLES, signature.genre, signature.texte, champ ? etiquetteChamp : texteDe);
  return liste[signature.rang] ?? null;
}

/** L'état visible d'un élément à bascule, ou `null` pour un simple bouton. */
export function etatDe(element) {
  if (element.getAttribute('data-sidebar') === 'trigger') return etatBarre();
  for (const attribut of ['aria-checked', 'aria-selected', 'aria-pressed', 'aria-expanded']) {
    const valeur = element.getAttribute(attribut);
    if (valeur !== null) return valeur;
  }
  if (element.matches('input[type="checkbox"],input[type="radio"]')) return String(element.checked);
  if (element.tagName === 'SUMMARY') return String(Boolean(element.parentElement?.open));
  return null;
}

export function etatBarre() {
  return document.querySelector('.peer[data-state][data-side]')?.getAttribute('data-state') ?? null;
}

/** Fenêtres superposées ouvertes : dialogues, menus, listes. */
export const fenetresOuvertes = () =>
  document.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]').length;

/**
 * Rejoue un clic COMPLET : les composants Radix n'écoutent pas tous le même
 * événement (un onglet s'active au `mousedown`, un menu au `pointerdown`, un
 * interrupteur au `click`).
 */
export function cliquer(element, { modifs = '', double = false } = {}) {
  const cadre = element.getBoundingClientRect();
  const options = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons: 1,
    clientX: cadre.left + cadre.width / 2,
    clientY: cadre.top + cadre.height / 2,
    view: window,
    // Les touches tenues par l'autre : Ctrl+clic AJOUTE à une sélection, il ne la remplace pas.
    ctrlKey: modifs.includes('c'),
    shiftKey: modifs.includes('s'),
    altKey: modifs.includes('a'),
    metaKey: modifs.includes('m'),
  };
  if (double) {
    // Un double clic, c'est deux clics PUIS `dblclick` — certains écrans n'écoutent que lui.
    element.dispatchEvent(new MouseEvent('dblclick', { ...options, buttons: 0, detail: 2 }));
    return;
  }
  const Pointeur = window.PointerEvent ?? MouseEvent;
  /*
   * ⚠️ UNE OPTION DE SELECT : Radix écoute, à l'ouverture, le PREMIER
   * `pointerup` du document et l'annule — c'est le relâchement du clic qui a
   * ouvert la liste, qui ne doit rien choisir. Chez le directeur, l'ouverture
   * rejouée n'a pas eu ce relâchement : sans ce leurre, c'est le choix de
   * l'option qui serait annulé.
   */
  if (element.getAttribute('role') === 'option') {
    document.dispatchEvent(new Pointeur('pointerup', { bubbles: true, pointerType: 'mouse', isPrimary: true }));
  }
  const accepte = element.dispatchEvent(new Pointeur('pointerdown', { ...options, pointerType: 'mouse', isPrimary: true }));
  /*
   * ═══ ⚠️ UN APPUI ANNULÉ S'ARRÊTE LÀ (2026-10-04, signalé par le porteur : « la
   * liste du Select ne s'ouvre pas chez le directeur ») ═══ Un Select ou un menu
   * Radix s'ouvre à l'appui et l'ANNULE (`preventDefault`). Sur un vrai écran,
   * rien ne suit sur le déclencheur : la page vient d'être rendue insensible au
   * pointeur. Rejouer quand même le `click` lui rendait le focus — Radix y lit
   * « le focus a quitté la liste » et la refermait aussitôt.
   */
  if (!accepte) return;
  element.dispatchEvent(new MouseEvent('mousedown', options));
  element.dispatchEvent(new Pointeur('pointerup', { ...options, buttons: 0, pointerType: 'mouse', isPrimary: true }));
  element.dispatchEvent(new MouseEvent('mouseup', { ...options, buttons: 0 }));
  element.dispatchEvent(new MouseEvent('click', { ...options, buttons: 0 }));
}

/** Pose une valeur comme le ferait la frappe : React n'entend que l'événement `input`. */
export function saisir(element, valeur) {
  const prototype = Object.getPrototypeOf(element);
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(element, valeur);
  else element.value = valeur;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Rejoue un raccourci clavier de l'autre (2026-10-04) — là où l'écran écoute : la fenêtre. */
export function presser({ key, code, modifs = '' }) {
  const cible = document.activeElement ?? document.body;
  cible.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      code,
      bubbles: true,
      cancelable: true,
      ctrlKey: modifs.includes('c'),
      shiftKey: modifs.includes('s'),
      altKey: modifs.includes('a'),
      metaKey: modifs.includes('m'),
    })
  );
}

export function echap() {
  const cible = document.activeElement ?? document.body;
  cible.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
}
