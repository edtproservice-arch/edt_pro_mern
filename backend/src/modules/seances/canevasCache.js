import { readFile, stat } from 'node:fs/promises';

/**
 * Le contenu binaire d'un canevas Word, gardé en mémoire entre deux exports —
 * un fichier de quelques dizaines de Ko relu à chaque export coûterait un
 * aller-retour disque pour rien.
 * ← extrait de `exportGlobalDocx.js` (2026-09-24) pour servir aussi
 *   l'émargement, sur SON propre canevas.
 *
 * ⚠️ RELU DÈS QUE LE FICHIER CHANGE (2026-09-30, logo remplacé dans les
 * canevas : l'export continuait de rendre l'ANCIEN). Lu une seule fois par
 * processus, un canevas modifié restait invisible jusqu'au redémarrage — et
 * `node --watch` ne redémarre pas pour un `.docx`. La date de modification,
 * un simple `stat`, suffit à savoir s'il faut relire.
 */
const cache = new Map();

export async function chargerCanevasTampon(chemin) {
  const { mtimeMs } = await stat(chemin);
  const entree = cache.get(chemin);
  if (entree?.mtimeMs === mtimeMs) return entree.tampon;

  const tampon = await readFile(chemin);
  cache.set(chemin, { mtimeMs, tampon });
  return tampon;
}
