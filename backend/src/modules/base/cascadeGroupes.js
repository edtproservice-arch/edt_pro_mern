/**
 * Ce qu'entraîne le retrait d'un groupe de la carte (2026-09-22).
 *
 * ═══ ⚠️ POURQUOI CE FICHIER EXISTE ═══
 * MongoDB n'a pas de `FOREIGN KEY ... ON DELETE CASCADE`. Le plan (§5) posait
 * donc dès le départ une **obligation** : « suppressions en cascade explicites
 * dans les services ». Elle n'avait jamais été écrite pour les groupes, et la
 * carte est remplacée EN BLOC à chaque enregistrement (`findOneAndDelete` puis
 * `create`) : retirer un groupe le faisait disparaître de `Base` en laissant
 * neuf collections pointer sur un nom qui n'existe plus.
 *
 * Mesuré le 2026-09-22 : sept chronogrammes orphelins sur un établissement
 * réel, dont un de 957,5 h — et le générateur les signalait sans pouvoir dire
 * s'il fallait les supprimer ou compléter la carte.
 *
 * ═══ ⚠️⚠️ CE QUI N'EST *PAS* SUPPRIMÉ, ET C'EST LE CŒUR DE LA DÉCISION ═══
 * Un groupe est une ligne de configuration ; un stagiaire est une PERSONNE, et
 * son historique disciplinaire est un document opposable. On **détache** donc
 * le stagiaire de son groupe, on ne le supprime jamais — décision du porteur du
 * 2026-09-22. Les absences suivent la même règle : `AbsenceStagiaire`
 * dénormalise `nomComplet` précisément « pour que la note reste lisible si le
 * stagiaire quitte le groupe » (son propre commentaire de schéma). Les effacer
 * contredirait l'intention du modèle.
 */

import { separerFusion } from 'shared/domain';

import { AbsenceStagiaire } from '../../models/AbsenceStagiaire.js';
import { Chronogramme } from '../../models/Chronogramme.js';
import { Etablissement } from '../../models/Etablissement.js';
import { Seance } from '../../models/Seance.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { UnplacedSession } from '../../models/UnplacedSession.js';

/** Les noms propres d'une carte : `base.groupes` ET ceux cités par une affectation. */
export function nomsDeLaCarte({ groupes = [], affectations = [] } = {}) {
  const noms = new Set();
  /*
   * ⚠️ LES DEUX SOURCES, PAS UNE SEULE. Un groupe déclaré dont aucun module
   *    n'est encore attribué n'apparaît dans AUCUNE affectation — le compter
   *    absent le ferait « retirer », avec sa planification. C'est le défaut
   *    corrigé le 2026-09-22 dans `taches.js`, et il ne doit pas renaître ici.
   */
  for (const groupe of groupes) {
    for (const nom of separerFusion(groupe)) noms.add(nom.trim().toUpperCase());
  }
  for (const affectation of affectations) {
    for (const nom of separerFusion(affectation?.groupe)) noms.add(nom.trim().toUpperCase());
  }
  noms.delete('');
  return noms;
}

/**
 * Les groupes que le nouvel enregistrement fait disparaître.
 *
 * ⚠️ PURE, ET SÉPARÉE DE L'ÉCRITURE : c'est elle qui décide ce qui sera
 *    détruit. La tester demande deux tableaux, pas une base de données.
 *
 * ⚠️ ON REND LE NOM TEL QU'IL ÉTAIT ÉCRIT, pas sa version majuscule : il
 *    servira à interroger des collections où il est stocké tel quel.
 */
export function groupesRetires(precedente, nouvelle) {
  const restants = nomsDeLaCarte(nouvelle);
  const retires = new Map();

  for (const groupe of precedente?.groupes ?? []) {
    for (const nom of separerFusion(groupe)) {
      const cle = nom.trim().toUpperCase();
      if (cle !== '' && !restants.has(cle) && !retires.has(cle)) retires.set(cle, nom.trim());
    }
  }
  for (const affectation of precedente?.affectations ?? []) {
    for (const nom of separerFusion(affectation?.groupe)) {
      const cle = nom.trim().toUpperCase();
      if (cle !== '' && !restants.has(cle) && !retires.has(cle)) retires.set(cle, nom.trim());
    }
  }

  return [...retires.values()];
}

/**
 * Ce que chaque groupe retiré emporterait — sans rien écrire.
 *
 * ⚠️ C'EST CE QUI PERMET DE DEMANDER AVANT DE DÉTRUIRE. Un refus qui dirait
 *    seulement « des références existent » ferait confirmer à l'aveugle ; ces
 *    chiffres-là (955 h de chronogramme, 62 séances, 9 stagiaires) sont ce sur
 *    quoi le directeur décide réellement.
 */
export async function compterReferences(etablissementId, anneeScolaire, noms, session) {
  if (noms.length === 0) return [];

  const etablissement = await Etablissement.findById(etablissementId)
    .select('stages groupesFq')
    .session(session ?? null)
    .lean();

  const details = [];

  for (const nom of noms) {
    const ou = { etablissementId, anneeScolaire, groupe: nom };

    const chronogramme = await Chronogramme.findOne({ etablissementId, anneeScolaire, groupe: nom })
      .session(session ?? null)
      .lean();

    let heuresPlanifiees = 0;
    for (const cellules of Object.values(chronogramme?.planning ?? {})) {
      for (const cellule of cellules ?? []) heuresPlanifiees += Number(cellule?.heures) || 0;
    }

    details.push({
      groupe: nom,
      chronogramme: chronogramme ? 1 : 0,
      heuresPlanifiees,
      seances: await Seance.countDocuments(ou).session(session ?? null),
      nonPlacees: await UnplacedSession.countDocuments({ etablissementId, groupe: nom }).session(
        session ?? null
      ),
      /* ⚠️ Détachés, jamais supprimés — voir l'en-tête. */
      stagiairesADetacher: await Stagiaire.countDocuments({
        etablissementId,
        anneeScolaire,
        groupes: nom,
      }).session(session ?? null),
      /* ⚠️ CONSERVÉES : historique d'une personne. Comptées pour information. */
      absencesConservees: await AbsenceStagiaire.countDocuments(ou).session(session ?? null),
      stages: (etablissement?.stages ?? []).filter((stage) => stage.groupe === nom).length,
      liensFq: (etablissement?.groupesFq ?? []).filter(
        (lien) => lien.groupeFq === nom || lien.groupeConstituant === nom
      ).length,
    });
  }

  return details;
}

/** Une référence qui serait DÉTRUITE (les absences, conservées, n'en sont pas une). */
export function pese(detail) {
  return (
    detail.chronogramme +
    detail.seances +
    detail.nonPlacees +
    detail.stagiairesADetacher +
    detail.stages +
    detail.liensFq
  );
}

/**
 * Exécute la cascade. **À appeler dans la transaction de l'enregistrement.**
 *
 * ⚠️ DANS LA MÊME TRANSACTION QUE LE REMPLACEMENT DE LA CARTE, sans quoi un
 *    échec au milieu laisserait une carte neuve et des séances à moitié
 *    effacées — un état que personne n'a demandé et que rien ne rattrape.
 */
export async function cascader(etablissementId, anneeScolaire, noms, session) {
  if (noms.length === 0) return { seances: 0, chronogrammes: 0, nonPlacees: 0, stagiaires: 0 };

  const ou = { etablissementId, anneeScolaire, groupe: { $in: noms } };

  const chronogrammes = await Chronogramme.deleteMany(ou, { session });
  const seances = await Seance.deleteMany(ou, { session });
  const nonPlacees = await UnplacedSession.deleteMany(
    { etablissementId, groupe: { $in: noms } },
    { session }
  );

  /*
   * ⚠️ `$pull` ET NON `deleteMany` : le stagiaire reste, il perd seulement ce
   *    groupe. Un stagiaire inscrit dans DEUX groupes conserve l'autre — une
   *    suppression l'aurait effacé des deux.
   */
  const stagiaires = await Stagiaire.updateMany(
    { etablissementId, anneeScolaire, groupes: { $in: noms } },
    { $pull: { groupes: { $in: noms } } },
    { session }
  );

  await Etablissement.updateOne(
    { _id: etablissementId },
    {
      $pull: {
        stages: { groupe: { $in: noms } },
        groupesFq: {
          $or: [{ groupeFq: { $in: noms } }, { groupeConstituant: { $in: noms } }],
        },
      },
    },
    { session }
  );

  return {
    chronogrammes: chronogrammes.deletedCount ?? 0,
    seances: seances.deletedCount ?? 0,
    nonPlacees: nonPlacees.deletedCount ?? 0,
    stagiaires: stagiaires.modifiedCount ?? 0,
  };
}
