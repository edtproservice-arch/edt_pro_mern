import { Etablissement } from '../../models/Etablissement.js';
import { conditionVersion, versionPerimee } from '../../lib/versionOptimiste.js';

/**
 * Écritures des listes d'un établissement (Phase 5bis, étape d3).
 *
 * Elles vivaient dans les routes (`req.etablissement.save()`), ce qui rendait
 * impossible d'y poser la version optimiste : un `save()` réécrit le document
 * lu par `resolveTenant`, sans rien comparer.
 */

/**
 * Remplace UNE liste (`espaces`, `stages`, `formations`, `groupesFq`).
 *
 * @param {number | undefined} version  celle que l'écran a lue ; absente, l'écriture
 *   passe sans condition (assistant de configuration)
 * @returns {Promise<{ valeur: unknown[], version: number }>}
 */
export async function remplacerListe(etablissementId, champ, valeur, version) {
  const chemin = `versions.${champ}`;

  const etablissement = await Etablissement.findOneAndUpdate(
    { _id: etablissementId, ...conditionVersion(chemin, version) },
    { $set: { [champ]: valeur }, $inc: { [chemin]: 1 } },
    { new: true, runValidators: true }
  );

  // L'établissement existe — `resolveTenant` vient de le charger : ne rien
  // trouver ne peut vouloir dire que le compteur a bougé.
  if (!etablissement) throw versionPerimee();

  return { valeur: etablissement[champ], version: etablissement.versions?.[champ] ?? 0 };
}
