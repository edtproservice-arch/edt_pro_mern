import mongoose from 'mongoose';
import {
  carteVersLignesEnote,
  construireBase,
  emailDeduit,
  modulesInactifs,
  sallesParAffectation,
  nomsGroupesDeLaCarte,
  resoudreHomonymes,
} from 'shared/domain';
import { Base } from '../../models/Base.js';
import { EnoteImport } from '../../models/EnoteImport.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { badRequest, HttpError } from '../../lib/httpError.js';
import {
  cascader,
  compterReferences,
  groupesRetires,
  pese,
} from './cascadeGroupes.js';
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
 * Clé d'une affectation, insensible à l'ordre — utilisée pour comparer deux
 * versions des affectations d'un enregistrement à l'autre.
 */
function cleAffectation(affectation) {
  return `${affectation.groupe}|${affectation.module}|${affectation.type}`;
}

/**
 * Un formateur invité en partage ne peut que RÉCLAMER une case encore vide,
 * ou se retirer d'une case qu'il a lui-même prise — jamais toucher celle d'un
 * collègue, ni créer ou retirer un groupe (2026-09-27, demande du porteur).
 *
 * ⚠️ CE N'EST PAS L'ÉCRAN QUI LE GARANTIT — LUI DÉJÀ LE FAIT (`GrilleAffectations`,
 * `VueFormateurs`) — MAIS CETTE FONCTION : un appel direct de la route, sans
 * passer par l'écran, doit être refusé exactement pareil. C'est la même
 * exigence que `exigerDroitPage` un cran plus haut — l'écran évite l'erreur,
 * le serveur l'empêche.
 *
 * ⚠️ COMPARAISON SUR `affectations[].formateur`, qui porte déjà le matricule
 * quand il existe (`identifiant()` de `parseBase.js`) — la MÊME clé que
 * `req.utilisateur.identifiant` du compte connecté. Pas besoin de retrouver
 * son nom dans la carte : le matricule suffit, des deux côtés.
 *
 * @param {object|null} existante   Le document `Base` avant cet enregistrement.
 * @param {string[]} groupes        Les groupes de la carte qui va s'enregistrer.
 * @param {object[]} affectations   Les affectations qui vont s'enregistrer.
 * @param {string} identifiantFormateur  Le matricule du compte restreint — voir
 *   le garde-fou ci-dessous quand il ne désigne personne dans la carte.
 */
function verifierEcritureRestreinte({ existante, groupes, affectations, identifiantFormateur }) {
  const soi = String(identifiantFormateur ?? '').trim();

  const refuser = () => {
    throw new HttpError(
      403,
      soi === ''
        ? "Ce compte formateur n'a pas de matricule reconnu dans la carte : aucune affectation n'est modifiable depuis ce partage."
        : "Ce partage ne permet de choisir que les modules encore sans formateur — pas de modifier une affectation déjà faite.",
      { code: 'AFFECTATION_RESTREINTE' }
    );
  };

  const avant = new Map((existante?.affectations ?? []).map((a) => [cleAffectation(a), a.formateur]));
  const apres = new Map(affectations.map((a) => [cleAffectation(a), a.formateur]));

  /*
   * ⚠️ REJOUER LA MÊME CARTE RESTE PERMIS MÊME SANS MATRICULE RÉSOLU : rien n'y
   * change, donc rien à autoriser. C'est le cas d'une resoumission après un 409
   * de version périmée (l'écran reprend la version en place et réenregistre) —
   * un compte de test sans matricule, ou un formateur dont le compte n'a pas
   * encore été relié, ne doit pas y trébucher. Le `soi` vide ne bloque que les
   * cases qui changent réellement, ci-dessous.
   */
  for (const cle of new Set([...avant.keys(), ...apres.keys()])) {
    const valeurAvant = avant.get(cle);
    const valeurApres = apres.get(cle);
    if (valeurAvant === valeurApres) continue;
    // Réclamer une case encore vide, ou se retirer d'une case qu'on tenait : permis.
    if (soi !== '' && valeurAvant === undefined && valeurApres === soi) continue;
    if (soi !== '' && valeurAvant === soi && valeurApres === undefined) continue;
    refuser();
  }

  const groupesAvant = new Set(existante?.groupes ?? []);
  const groupesApres = new Set(groupes);
  const memeEnsemble =
    groupesAvant.size === groupesApres.size && [...groupesAvant].every((g) => groupesApres.has(g));
  if (!memeEnsemble) refuser();
}

/**
 * Enregistre la carte comme base de l'année.
 *
 * ⚠️ REMPLACEMENT, pas fusion : la carte affichée fait foi. C'est le
 * comportement de `save_affectations.php`, et l'écran l'annonce
 * (« L'enregistrement remplace la base de l'année scolaire sélectionnée »).
 */
export async function enregistrerCarte({
  etablissementId,
  anneeScolaire,
  carte,
  version,
  /*
   * ⚠️ FAUX PAR DÉFAUT, ET C'EST TOUT LE GARDE-FOU (2026-09-22). Retirer
   *    un groupe n'est pas un geste : c'est un ÉCART entre deux versions de
   *    la carte, et la carte est remplacée à chaque enregistrement comme à
   *    chaque import e-note. Une cascade automatique voudrait dire qu'une
   *    feuille Excel manquante efface une année de travail sans que
   *    personne ait cliqué sur « supprimer ». On refuse donc, on chiffre,
   *    et on attend un oui explicite.
   */
  confirmerSuppressions = false,
  /*
   * ═══ FORMATEUR INVITÉ, RESTREINT À SES CASES VIDES (2026-09-27, demande du
   * porteur) ═══ Le matricule (`req.utilisateur.identifiant`) du compte
   * connecté, SEULEMENT s'il s'agit d'un formateur invité en partage —
   * `undefined`/`null` pour le directeur, un gestionnaire, ou l'administrateur
   * en collaboration : accès plein, inchangé. Posé par la route, jamais déduit
   * ici — c'est `exigerDroitPage` et le rôle du compte qui en décident.
   */
  identifiantFormateurRestreint = null,
}) {
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
   * ═══ UN FORMATEUR SANS MODULE RESTE UN FORMATEUR (2026-09-19) ═══
   * `construireBase` ne connaît un formateur que par les lignes qui le nomment : celui
   * qu'aucun module n'emploie n'en a aucune, et sortait de la base à
   * l'enregistrement. Depuis que l'ajout se fait depuis la page Formateurs, c'est
   * un formateur tout juste ajouté — pas encore affecté — que la première
   * modification de la carte aurait effacé.
   *
   * La carte fait foi sur la liste : ceux qu'elle porte et que les lignes ne disent
   * pas sont ajoutés, puis les noms uniques recalculés sur l'ensemble.
   */
  const presents = new Set(structure.formateursDetails.map((formateur) => formateur.nomComplet));
  const sansModule = [];

  for (const formateur of carte.formateurs ?? []) {
    const nomComplet = String(formateur?.nom ?? '')
      .trim()
      .toUpperCase();
    if (nomComplet === '' || presents.has(nomComplet)) continue;
    presents.add(nomComplet);

    const matricule = String(formateur.matricule ?? '').trim();
    const cleMatricule = matricule.toUpperCase();

    sansModule.push({
      nomComplet,
      matricule,
      nomUnique: '',
      email:
        (cleMatricule !== '' ? emailsConnus.get(cleMatricule) : '') ||
        emailsConnus.get(nomComplet) ||
        emailDeduit(nomComplet, matricule),
      masseHoraire:
        (cleMatricule !== '' ? massesConnues.get(cleMatricule) : undefined) ??
        massesConnues.get(nomComplet) ??
        0,
    });
  }

  if (sansModule.length > 0) {
    const tous = [...structure.formateursDetails, ...sansModule];
    const resolus = resoudreHomonymes(
      tous.map(({ nomComplet, matricule }) => ({ nomComplet, matricule }))
    );

    structure.formateursDetails = tous
      .map((formateur, index) => ({ ...formateur, nomUnique: resolus[index].nomUnique }))
      .sort((a, b) => (a.nomComplet < b.nomComplet ? -1 : a.nomComplet > b.nomComplet ? 1 : 0));
  }

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
  /** Ce que le retrait de groupes a emporté — vide s'il n'y en avait pas. */
  let cascade = null;

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

      /*
       * ⚠️ SUR `precedente`, PAS SUR `existante` LU PLUS HAUT : c'est le document
       * que CETTE transaction vient de supprimer, sous condition de version — le
       * même que celui d'où repart le calcul de la cascade juste en dessous. Un
       * conflit de version doit se voir d'ABORD (409, ci-dessus) : une carte
       * refusée pour être périmée ne dit rien de ce qu'un formateur a le droit
       * d'y changer.
       */
      if (identifiantFormateurRestreint) {
        verifierEcritureRestreinte({
          existante: precedente,
          groupes,
          affectations: structure.affectations,
          identifiantFormateur: identifiantFormateurRestreint,
        });
      }

      /*
       * ═══ ⚠️ LA CASCADE, DANS LA TRANSACTION QUI REMPLACE LA CARTE ═══
       * (2026-09-22) Ici, `precedente` est la carte telle qu'elle était : c'est
       * le seul instant où l'on peut voir ce que le nouvel enregistrement fait
       * disparaître. En dehors de cette transaction, un échec laisserait une
       * carte neuve et des séances à moitié effacées.
       */
      const retires = groupesRetires(precedente, {
        groupes,
        affectations: structure.affectations,
      });

      if (retires.length > 0) {
        const references = await compterReferences(
          etablissementId,
          anneeScolaire,
          retires,
          session
        );
        const porteuses = references.filter((detail) => pese(detail) > 0);

        if (porteuses.length > 0 && !confirmerSuppressions) {
          /*
           * ⚠️ 409 ET NON 400 : ce n'est pas une requête mal formée, c'est un
           *    CONFLIT avec l'état existant — le même code que la version
           *    périmée, et l'écran sait déjà le distinguer d'une erreur de
           *    saisie. Le détail voyage dans `details` : sans les chiffres, le
           *    directeur confirmerait à l'aveugle.
           */
          throw new HttpError(409, 'Des groupes retirés sont encore utilisés', {
            code: 'GROUPES_ENCORE_UTILISES',
            details: porteuses,
          });
        }

        cascade = await cascader(etablissementId, anneeScolaire, retires, session);
        cascade.groupes = retires;
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
            /*
             * ⚠️ RANGÉ À PART DES LIGNES, comme `modulesInactifs` : le format
             *    e-note n'a aucune colonne de salle — vérifié aussi dans
             *    l'ancien EDT Pro, qui n'attribue des salles qu'au FORMATEUR.
             *    Sans cela, elles ne survivraient pas à l'aller-retour.
             */
            sallesAffectations: sallesParAffectation(carte),
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
    /*
     * ⚠️ RENDU À L'ÉCRAN, PAS SEULEMENT FAIT. Une cascade muette laisse
     *    croire qu'un simple enregistrement a eu lieu, alors qu'une
     *    planification entière vient de disparaître.
     */
    cascade,
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
