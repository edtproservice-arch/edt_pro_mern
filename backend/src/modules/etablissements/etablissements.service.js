import { etapesConfigurationFaites, etapesConfigurationManquantes } from 'shared/domain';
import { Base } from '../../models/Base.js';
import { Etablissement } from '../../models/Etablissement.js';
import { conditionVersion, versionPerimee } from '../../lib/versionOptimiste.js';
import { refuserRetraitDEspacePartage } from '../espaces/espaces.service.js';

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

  // Un espace mutualisé ne se retire ni ne se renomme tant qu'il est partagé (2026-09-21).
  if (champ === 'espaces') {
    const courant = await Etablissement.findById(etablissementId).select('espacesMutualises').lean();
    if (courant) refuserRetraitDEspacePartage(courant, valeur);
  }

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

/**
 * Où en est la configuration initiale : ce qui est FAIT, lu dans les données.
 *
 * ⚠️ LA BASE DE L'ANNÉE DEMANDÉE, pas « la » base : un établissement qui configure
 * 2027-2028 n'a pas fait ses étapes parce que 2026-2027 est complète. Même règle que
 * partout ailleurs (une base par année). Voir `shared/domain/etablissement/configuration.js`.
 */
export async function progressionConfiguration(etablissement, anneeScolaire) {
  const base = await Base.findOne({ etablissementId: etablissement.id, anneeScolaire })
    .select('formateurs groupes')
    .lean();

  const etapes = etapesConfigurationFaites({
    nomAbrege: etablissement.nomAbrege,
    espaces: etablissement.espaces ?? [],
    baseExiste: Boolean(base),
    formateurs: base?.formateurs?.length ?? 0,
    groupes: base?.groupes?.length ?? 0,
  });

  return { etapes, manquantes: etapesConfigurationManquantes(etapes) };
}
