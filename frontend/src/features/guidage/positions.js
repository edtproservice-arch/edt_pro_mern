/**
 * Positions du guidage (2026-10-03).
 *
 * ⚠️ PAS EN PIXELS : l'administrateur et le directeur n'ont pas le même
 * écran. Le curseur s'accroche à l'élément survolé (ci-dessous), le
 * défilement voyage en fraction de ce qui peut défiler.
 */

import { noterDefilementRecu } from './echo';

/** La zone de contenu qui défile. */
export const zoneGuidage = () => document.querySelector('[data-zone-guidage]');

const borner = (v) => Math.min(1, Math.max(0, v));

/*
 * ═══ ⚠️ LE CURSEUR S'ACCROCHE À L'ÉLÉMENT SURVOLÉ (2026-10-04) ═══
 * (signalé par le porteur : « quand je guide un directeur sur un écran plus
 * petit que le mien, le curseur se décale ».) Une fraction de la zone entière
 * ne suffit pas : la colonne des formateurs garde sa largeur quand l'écran
 * rétrécit, les cases non — tout se décale d'autant plus qu'on va à droite.
 *
 * Le curseur est donc décrit par l'élément exact qu'il survole — son CHEMIN
 * depuis une racine commune aux deux écrans (rang de chaque enfant) — et sa
 * position DANS cet élément. Les deux écrans montrent la même page, avec les
 * mêmes données : le même chemin y mène à la même case, quelle que soit sa
 * largeur.
 */
const RACINES = [
  ['dialogue', '[role="dialog"],[role="alertdialog"]'],
  ['menu', '[role="menu"],[role="listbox"]'],
  // Le panneau de droite (rapport de conformité…) et l'en-tête vivent HORS de la
  // zone de contenu : sans racine à eux, le curseur y disparaissait (2026-10-04).
  ['panneau', '[data-panneau-droit]'],
  ['barre', '[data-sidebar="sidebar"]'],
  ['entete', '[data-guidage-entete]'],
  ['contenu', '[data-zone-guidage]'],
];

const PROFONDEUR_MAX = 60;

/** Point d'écran → `{ portee, chemin, x, y }`, ou `null` hors de toute racine. */
export function ancrer(clientX, clientY) {
  const cible = document.elementFromPoint(clientX, clientY);
  if (!cible) return null;
  for (const [portee, selecteur] of RACINES) {
    const racine = cible.closest(selecteur);
    if (!racine) continue;
    let element = cible;
    let chemin = [];
    while (element !== racine && element.parentElement) {
      chemin.unshift([...element.parentElement.children].indexOf(element));
      element = element.parentElement;
    }
    // Trop profond : on s'arrête à l'ancêtre au plus profond admis.
    chemin = chemin.slice(0, PROFONDEUR_MAX);
    let ancre = racine;
    for (const rang of chemin) ancre = ancre.children[rang];
    const cadre = ancre.getBoundingClientRect();
    return {
      portee,
      chemin,
      x: borner((clientX - cadre.left) / Math.max(1, cadre.width)),
      y: borner((clientY - cadre.top) / Math.max(1, cadre.height)),
    };
  }
  return null;
}

/** L'inverse, chez le directeur — `null` si le chemin ne mène nulle part. */
export function desancrer(position) {
  if (!position?.chemin) return null;
  const selecteur = RACINES.find(([portee]) => portee === position.portee)?.[1];
  const racines = selecteur ? document.querySelectorAll(selecteur) : [];
  // Un dialogue ou un menu : le dernier ouvert, celui du dessus.
  let element = position.portee === 'dialogue' || position.portee === 'menu' ? racines[racines.length - 1] : racines[0];
  for (const rang of position.chemin) {
    element = element?.children[rang];
    if (!element) return null;
  }
  if (!element) return null;
  const cadre = element.getBoundingClientRect();
  const left = cadre.left + position.x * cadre.width;
  const top = cadre.top + position.y * cadre.height;
  if (left < 0 || top < 0 || left > window.innerWidth || top > window.innerHeight) return null;
  return { left, top };
}

/** Défilement vertical de la zone, en fraction de ce qui peut défiler. */
export function fractionDefilement(zone) {
  const course = zone.scrollHeight - zone.clientHeight;
  return course > 0 ? borner(zone.scrollTop / course) : 0;
}

export function appliquerDefilement(zone, y) {
  if (!zone) return;
  noterDefilementRecu();
  zone.scrollTop = y * Math.max(0, zone.scrollHeight - zone.clientHeight);
}
