import mongoose from 'mongoose';
import {
  carteVersLignesEnote,
  construireBase,
  emailDeduit,
  modulesInactifs,
  nomsGroupesDeLaCarte,
} from 'shared/domain';
import { Base } from '../../models/Base.js';
import { EnoteImport } from '../../models/EnoteImport.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { badRequest } from '../../lib/httpError.js';
import { conditionVersion, versionPerimee } from '../../lib/versionOptimiste.js';

/**
 * Enregistrement d'une carte d'établissement construite à la main (F3, F13).
 * ← api/profile/save_affectations.php (partie serveur)
 *
 * ═══ LE POINT ESSENTIEL ═══
 * La carte est convertie en lignes au format e-note, puis passée au MÊME
 * parseur que l'import Excel. Enregistrer la carte, ou l'exporter puis la
 * réimporter, produit donc rigoureusement la même base. C'est ce que faisait
 * `save_affectations.php`, et c'est ce qui empêche les deux chemins de diverger
 * — le défaut structurel que cette migration corrige (plan §4.2).
 */

/**
 * Code de fusion : CRC32 du libellé, comme le `crc32()` de PHP.
 * ← fusionCode() dans affectation-carte.js
 *
 * Le même libellé doit donner le même code des deux côtés, sinon deux groupes
 * fusionnés cessent de se reconnaître d'un enregistrement à l'autre.
 */
function codeFusion(libelle) {
  const octets = new TextEncoder().encode(String(libelle ?? ''));
  let crc = -1;

  for (const octet of octets) {
    crc ^= octet;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ -1) >>> 0;
}

/**
 * Complète les deux colonnes que le client ne peut pas connaître.
 * ← save_affectations.php:62-75
 *
 * J (9)  « Effectif Groupe » — nombre de stagiaires inscrits dans le groupe
 * N (13) « Code Fusion »     — identifiant partagé par les lignes d'une fusion
 */
export async function effectifsParGroupe(etablissementId, anneeScolaire) {
  return new Map(
    (
      await Stagiaire.aggregate([
        /*
         * ⚠️ LA BASE KONOSYS DE LA MÊME ANNÉE QUE LA CARTE (2026-09-14) : il y en
         * a désormais une par année, et sans cette borne un stagiaire présent
         * dans deux bases compterait deux fois dans l'effectif de son groupe.
         */
        {
          $match: {
            etablissementId: new mongoose.Types.ObjectId(etablissementId),
            anneeScolaire: Number(anneeScolaire),
          },
        },
        /*
         * ⚠️ `$unwind` sur `groupes` : un stagiaire compte dans CHACUN de ses
         * groupes. Avec l'ancien champ unique `codeDiplome`, ses inscriptions
         * FQ n'étaient comptées nulle part et l'effectif de ces groupes était
         * sous-évalué — or c'est la colonne J « Effectif Groupe » du format
         * e-note, relue à l'import.
         */
        { $unwind: '$groupes' },
        { $group: { _id: { $toUpper: '$groupes' }, total: { $sum: 1 } } },
      ])
    ).map((ligne) => [ligne._id, ligne.total])
  );
}

export async function completerColonnesServeur(
  lignes,
  etablissementId,
  anneeScolaire,
  effectifsConnus
) {
  const effectifs = effectifsConnus ?? (await effectifsParGroupe(etablissementId, anneeScolaire));

  for (const ligne of lignes) {
    const groupe = String(ligne[8] ?? '')
      .trim()
      .toUpperCase();
    ligne[9] = effectifs.get(groupe) ?? 0;

    const fusion = String(ligne[12] ?? '').trim();
    ligne[13] = fusion === '' ? 0 : codeFusion(fusion);
  }

  return lignes;
}

/**
 * Enregistre la carte comme base de l'année.
 *
 * ⚠️ REMPLACEMENT, pas fusion : la carte affichée fait foi. C'est le
 * comportement de `save_affectations.php`, et l'écran l'annonce
 * (« L'enregistrement remplace la base de l'année scolaire sélectionnée »).
 */
export async function enregistrerCarte({ etablissementId, anneeScolaire, carte, version }) {
  const lignes = carteVersLignesEnote(carte, anneeScolaire);

  /*
   * ⚠️ LE GARDE PORTE SUR LES GROUPES, PAS SUR LES LIGNES. Il refusait toute
   * carte ne produisant aucune ligne — or un groupe dont tous les modules sont
   * DÉSACTIVÉS n'en produit aucune, et c'est un état parfaitement légitime.
   * L'enregistrement était alors rejeté en 400, sans que rien à l'écran ne
   * l'explique : le commutateur paraissait sans effet.
   *
   * Ce que le garde voulait dire — « vous n'avez pas encore généré vos
   * groupes » — se lit sur les GROUPES.
   */
  if ((carte?.groupes ?? []).length === 0) {
    throw badRequest("Aucun groupe à enregistrer : générez-les d'abord.", { code: 'CARTE_VIDE' });
  }

  await completerColonnesServeur(lignes, etablissementId, anneeScolaire);

  // Les masses horaires déjà corrigées par l'établissement survivent, comme à
  // l'import. Un directeur qui ajoute une filière ne doit pas voir repartir à
  // zéro les masses qu'il avait ajustées.
  const existante = await Base.findOne({ etablissementId, anneeScolaire });
  const massesConnues = new Map();

  /*
   * Adresses réelles, mêmes règles que les masses : la base précédente d'abord,
   * l'écran ensuite. Sans cette table, `construireBase()` régénère à chaque
   * enregistrement une adresse déduite « prenom.nom@ofppt.ma » et l'adresse
   * importée par l'établissement est perdue en silence.
   */
  const emailsConnus = new Map();

  for (const formateur of existante?.formateurs ?? []) {
    const matricule = String(formateur.matricule ?? '')
      .trim()
      .toUpperCase();
    if (matricule !== '') massesConnues.set(matricule, formateur.masseHoraire);
    massesConnues.set(formateur.nomComplet, formateur.masseHoraire);

    // Seules les adresses SAISIES sont reprises : réinjecter une adresse
    // déduite la figerait, et un matricule corrigé ne la ferait plus évoluer.
    const deduite = emailDeduit(formateur.nomComplet, formateur.matricule);
    if (formateur.email && formateur.email !== deduite) {
      if (matricule !== '') emailsConnus.set(matricule, formateur.email);
      emailsConnus.set(formateur.nomComplet, formateur.email);
    }
  }

  // Les masses saisies dans l'écran priment sur celles de la base précédente :
  // c'est le geste que le directeur vient de faire.
  for (const formateur of carte.formateurs ?? []) {
    if (formateur?.masseHoraire === undefined || formateur.masseHoraire === null) continue;
    const matricule = String(formateur.matricule ?? '')
      .trim()
      .toUpperCase();
    if (matricule !== '') massesConnues.set(matricule, Number(formateur.masseHoraire));
    massesConnues.set(
      String(formateur.nom ?? '')
        .trim()
        .toUpperCase(),
      Number(formateur.masseHoraire)
    );
  }

  // Adresses saisies à l'écran : elles priment sur celles de la base, pour la
  // même raison que les masses — c'est le geste que le directeur vient de faire.
  for (const formateur of carte.formateurs ?? []) {
    const adresse = String(formateur?.email ?? '').trim();
    if (adresse === '') continue;

    const matricule = String(formateur.matricule ?? '')
      .trim()
      .toUpperCase();
    if (matricule !== '') emailsConnus.set(matricule, adresse);
    emailsConnus.set(
      String(formateur.nom ?? '')
        .trim()
        .toUpperCase(),
      adresse
    );
  }

  /*
   * ⚠️ LES NOMS DE LA CARTE SONT IMPOSÉS AU PARSEUR (2026-09-11). Sa règle
   * d'import ne suffixe que les noms en collision, là où la carte désambiguïse
   * une filière entière : « GE103 (GC) » redevenait « GE103 », et la réunion
   * des deux listes ci-dessous faisait revenir l'ancien nom en groupe fantôme.
   */
  const structure = construireBase(lignes, {
    massesConnues,
    emailsConnus,
    nomsGroupes: nomsGroupesDeLaCarte(carte),
  });

  /*
   * ⚠️⚠️ LA CARTE FAIT FOI SUR LA LISTE DES GROUPES, PAS LES LIGNES.
   *
   * `construireBase` déduit `groupes` des lignes e-note produites. Or un module
   * DÉSACTIVÉ n'en produit aucune : un groupe dont tous les modules sont
   * désactivés — ou pas encore affectés — sortait donc SANS AUCUNE LIGNE, et
   * disparaissait purement et simplement de la base.
   *
   * Constaté sur les données réelles : désactiver l'unique module d'un groupe
   * l'a EFFACÉ, avec son affectation, sans un message. Et comme la carte se
   * recharge depuis la base, le second enregistrement automatique repartait d'une
   * carte déjà amputée — la perte devenait définitive au bout de deux secondes.
   *
   * Les groupes de la carte sont donc réunis à ceux des lignes. Les noms sont
   * les mêmes des deux côtés — suffixe compris — parce que `nomsGroupes` les
   * IMPOSE au parseur. ⚠️ Cette phrase était fausse avant le 2026-09-11 : le
   * parseur refaisait sa propre désambiguïsation, et chaque écart devenait ici
   * un groupe fantôme.
   */
  const groupesDeLaCarte = (carte?.groupes ?? [])
    .map((groupe) => String(groupe?.nom ?? '').trim())
    .filter(Boolean);

  const groupes = [...new Set([...structure.groupes, ...groupesDeLaCarte])];

  /*
   * ═══ LA BASE PRÉCÉDENTE EST SUPPRIMÉE, PAS ÉCRASÉE CHAMP PAR CHAMP ═══
   * Suppression puis création dans la MÊME transaction : un échec au milieu
   * laisserait sinon l'établissement sans base du tout, ce qui est pire que
   * l'ancienne.
   *
   * ⚠️ Les traces d'import e-note (`EnoteImport`) sont CONSERVÉES — décision du
   * 2026-08-16. Une première version les supprimait, au motif qu'elles
   * documentaient une base disparue ; mais elles forment l'HISTORIQUE des
   * fichiers reçus, et depuis que la carte s'enregistre automatiquement, les
   * effacer signifierait perdre cet historique à la première pause de saisie.
   */
  // Combien d'imports l'établissement conserve : l'écran le dit, pour qu'on
  // sache que l'historique survit à l'enregistrement.
  const tracesConservees = await EnoteImport.countDocuments({ etablissementId, anneeScolaire });

  const session = await mongoose.startSession();
  let base;

  try {
    await session.withTransaction(async () => {
      /*
       * ═══ LA VERSION EST DANS LE FILTRE DE LA SUPPRESSION (étape d3) ═══
       * Ne supprimer que la base que l'écran a LUE : si un collègue l'a déjà
       * remplacée, rien ne correspond, et l'enregistrement est refusé en 409
       * au lieu d'écraser son travail. Sans version (appelant antérieur), la
       * suppression reste inconditionnelle.
       */
      const precedente = await Base.findOneAndDelete(
        { etablissementId, anneeScolaire, ...conditionVersion('version', version) },
        { session }
      );

      if (!precedente && version !== undefined && version !== null) {
        // Rien supprimé : il n'y avait rien (version 0 attendue, c'est bon), ou
        // la base a changé sous nos pieds.
        if (version > 0 || (await Base.exists({ etablissementId, anneeScolaire }).session(session))) {
          throw versionPerimee();
        }
      }

      const [creee] = await Base.create(
        [
          {
            etablissementId,
            anneeScolaire,
            formateurs: structure.formateursDetails,
            groupes,
            fusionGroupes: structure.fusionGroupes,
            affectations: structure.affectations,
            groupeModes: structure.groupeModes,
            // Le compteur survit au remplacement : celui de la base supprimée, plus un.
            version: (precedente?.version ?? 0) + 1,
            // ⚠️ Rangé à part des lignes : un module désactivé n'en produit
            // aucune, et la répartition DRIF le ferait revenir actif.
            modulesInactifs: modulesInactifs(carte),
            // ⚠️ Même raison : la filière se déduisait des affectations, et un
            // groupe qui n'en a aucune perdait son identité.
            groupeFilieres: Object.fromEntries(
              (carte?.groupes ?? [])
                .filter((groupe) => String(groupe?.codeFiliere ?? '').trim() !== '')
                .map((groupe) => [groupe.nom, String(groupe.codeFiliere).trim()])
            ),
            origine: 'carte',
          },
        ],
        { session }
      );

      base = creee;
    });
  } finally {
    await session.endSession();
  }

  return {
    baseId: base.id,
    version: base.version,
    lignesProduites: lignes.length,
    // Ce qui a été retiré, et ce qui reste : une suppression muette laisse
    // croire que l'ancienne base est toujours là.
    supprime: { base: Boolean(existante) },
    tracesImportConservees: tracesConservees,
    effectifs: {
      formateurs: structure.formateurs.length,
      groupes: groupes.length,
      fusionGroupes: structure.fusionGroupes.length,
      affectations: structure.affectations.length,
    },
    nouveauxFormateurs: structure.nouveauxFormateurs,
    formateursSansMatricule: structure.formateursSansMatricule,
  };
}
