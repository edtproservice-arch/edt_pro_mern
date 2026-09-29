import { readFile } from 'node:fs/promises';

/**
 * Le contenu binaire d'un canevas Word, lu une seule fois par processus
 * serveur puis gardé en mémoire — un fichier de quelques dizaines de Ko
 * relu à chaque export coûterait un aller-retour disque pour rien.
 * ← extrait de `exportGlobalDocx.js` (2026-09-24) pour servir aussi
 *   l'émargement, sur SON propre canevas.
 */
const cache = new Map();

export async function chargerCanevasTampon(chemin) {
  if (!cache.has(chemin)) cache.set(chemin, await readFile(chemin));
  return cache.get(chemin);
}
