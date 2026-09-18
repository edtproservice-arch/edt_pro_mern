import mongoose from 'mongoose';
import {
  analyserRepartition,
  choisirFeuilleRepartition,
  dedoublonnerRepartition,
  lireLignesRepartition,
} from 'shared/domain';
import { Repartition } from '../../models/Repartition.js';
import { lireToutesLesFeuilles } from '../../lib/classeur.js';
import { badRequest, notFound } from '../../lib/httpError.js';

/**
 * Référentiel DRIF — écriture.
 * ← api/admin/upload_repartition.php (167 l.) +
 *   database/supprimer_filiere_repartition.php (86 l.)
 *
 * ═══ ⚠️ CE RÉFÉRENTIEL EST NATIONAL ═══
 * Une ligne modifiée ici s'applique aux 1 003 filières que voient TOUS les
 * établissements, pas à un seul. C'est pourquoi l'écriture est réservée à
 * l'administrateur (décision du porteur, 2026-09-02) — c'était déjà le choix de
 * l'existant, dont l'import était sous `session_check_admin` et dont la
 * suppression n'était même pas exposée sur le web.
 *
 * ⚠️ LA LECTURE, ELLE, RESTE OUVERTE aux directeurs et gestionnaires par
 * `repartitions.routes.js` : leur carte d'établissement ne peut pas se
 * construire sans ce catalogue.
 */

/** Filtre Mongo correspondant aux critères de l'écran. */
function critere({ secteur, niveau, creneau, filiere, metier, annee, recherche }) {
  const filtre = {};
  if (secteur) filtre.secteur = secteur;
  if (niveau) filtre.niveauFormation = niveau;
  if (creneau) filtre.creneau = creneau;
  if (filiere) filtre.codeFiliereDrif = filiere;
  /*
   * ⚠️ ÉGALITÉ EXACTE, PAS UNE RECHERCHE : la valeur vient de la liste que le
   * serveur a lui-même publiée. Un `regex` ferait qu'« Achat » rendrait aussi
   * « Achat/approvisionnement » — deux métiers distincts du référentiel.
   */
  if (metier) filtre.metier = metier;
  if (annee) filtre.anneeFormation = annee;

  if (recherche) {
    /*
     * ⚠️ LA RECHERCHE EST ÉCHAPPÉE : un intitulé DRIF contient des parenthèses
     * et des points — « Génie Mécanique (option E.M.) » — et une expression
     * régulière construite telle quelle serait invalide, ou pire, filtrerait
     * autre chose que ce qui a été tapé.
     */
    const motif = new RegExp(recherche.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filtre.$or = [
      { codeFiliereDrif: motif },
      { intituleFiliere: motif },
      { codeModule: motif },
      { module: motif },
      { metier: motif },
    ];
  }

  return filtre;
}

export async function lister(filtres) {
  const filtre = critere(filtres);
  const { page, parPage } = filtres;

  const [total, lignes] = await Promise.all([
    Repartition.countDocuments(filtre),
    Repartition.find(filtre)
      .sort({ secteur: 1, codeFiliereDrif: 1, anneeFormation: 1, codeModule: 1 })
      .skip((page - 1) * parPage)
      .limit(parPage),
  ]);

  return { total, page, parPage, pages: Math.ceil(total / parPage) || 1, lignes: lignes.map(presenter) };
}

/**
 * Les valeurs qui existent réellement, pour les listes déroulantes de l'écran.
 *
 * ⚠️ ON NE PROPOSE QUE CE QUI EXISTE, la règle des facettes du produit : offrir
 * un niveau que le référentiel ne porte pas donne une case qui ne rend jamais
 * rien, et fait douter du filtre plutôt que des données.
 *
 * ⚠️ ET LES FACETTES SE CALCULENT SUR TOUT LE RÉFÉRENTIEL, jamais sur la
 * sélection courante : sinon choisir un secteur ferait disparaître les autres,
 * et on ne pourrait plus revenir en arrière.
 */
export async function facettes() {
  const [secteurs, niveaux, creneaux, annees, total] = await Promise.all([
    Repartition.distinct('secteur', { secteur: { $ne: '' } }),
    Repartition.distinct('niveauFormation', { niveauFormation: { $ne: '' } }),
    Repartition.distinct('creneau', { creneau: { $ne: '' } }),
    Repartition.distinct('anneeFormation'),
    Repartition.estimatedDocumentCount(),
  ]);

  return {
    secteurs: secteurs.sort((a, b) => a.localeCompare(b, 'fr')),
    niveaux: niveaux.sort(),
    creneaux: creneaux.sort(),
    annees: annees.sort((a, b) => a - b),
    total,
  };
}

/**
 * Les métiers d'une sélection.
 * (demande du porteur, 2026-09-02 : filtrer aussi par métier.)
 *
 * ═══ ⚠️ SCOPÉ, CONTRAIREMENT AUX FACETTES ═══
 * Le référentiel en compte **364**, et ils sont longs. Les proposer tous quel
 * que soit le secteur choisi, c'est une liste où l'on ne trouve rien ; scopés,
 * un secteur en laisse une dizaine. C'est la même raison qui fait scoper les
 * filières — 1 003 entrées — et la différence avec `facettes()`, dont les
 * quatre listes sont courtes et doivent rester stables.
 *
 * ⚠️ ET IL NE SE SCOPE PAS SUR LUI-MÊME NI SUR LA FILIÈRE : deux listes qui se
 * réduisent mutuellement finissent par ne plus rien proposer, et l'on ne peut
 * plus revenir en arrière. Elles sont sœurs sous les mêmes parents.
 */
export async function metiers(filtres) {
  const listeMetiers = await Repartition.distinct('metier', {
    ...critere({ ...filtres, metier: undefined, filiere: undefined }),
    metier: { $ne: '' },
  });

  return listeMetiers.sort((a, b) => a.localeCompare(b, 'fr'));
}

/**
 * Les filières d'une sélection, avec leurs années et leur nombre de modules.
 *
 * C'est la vue dont on a besoin pour SUPPRIMER : « AE_TEST — année 1, 12
 * modules » dit exactement ce qui disparaîtra. ← les compteurs affichés par
 * `supprimer_filiere_repartition.php` avant d'appliquer.
 */
export async function filieres(filtres) {
  const lignes = await Repartition.aggregate([
    /*
     * ⚠️ NI L'ANNÉE, NI LA FILIÈRE, NI LE MÉTIER dans le critère :
     * — l'ANNÉE, parce que cette liste RAPPORTE la ventilation par année ;
     * — la FILIÈRE, parce qu'une liste réduite à la filière déjà choisie ne
     *   permettrait plus d'en changer ;
     * — le MÉTIER, parce que filière et métier sont deux listes SŒURS : se
     *   réduire mutuellement finit par ne plus rien proposer.
     */
    { $match: critere({ ...filtres, annee: undefined, filiere: undefined, metier: undefined }) },
    {
      $group: {
        _id: { code: '$codeFiliereDrif', annee: '$anneeFormation' },
        intitule: { $first: '$intituleFiliere' },
        secteur: { $first: '$secteur' },
        niveau: { $first: '$niveauFormation' },
        creneau: { $first: '$creneau' },
        modules: { $sum: 1 },
      },
    },
    { $sort: { intitule: 1, '_id.annee': 1 } },
  ]);

  /* Une filière, ses années : c'est l'unité que l'écran manipule. */
  const parCode = new Map();
  for (const ligne of lignes) {
    const code = ligne._id.code;
    if (!parCode.has(code)) {
      parCode.set(code, {
        code,
        intitule: ligne.intitule,
        secteur: ligne.secteur,
        niveau: ligne.niveau,
        creneau: ligne.creneau,
        annees: [],
        modules: 0,
      });
    }
    const filiere = parCode.get(code);
    filiere.annees.push({ annee: ligne._id.annee, modules: ligne.modules });
    filiere.modules += ligne.modules;
  }

  return [...parCode.values()];
}

export async function creer(donnees) {
  await refuserDoublon(donnees);
  const ligne = await Repartition.create(donnees);
  return presenter(ligne);
}

export async function modifier(id, donnees) {
  const ligne = await Repartition.findById(id);
  if (!ligne) throw notFound('Ligne de répartition introuvable');

  /*
   * ⚠️ L'IDENTITÉ PEUT CHANGER, ET C'EST ALORS UNE COLLISION POSSIBLE : corriger
   * le code d'un module peut le faire tomber sur un module déjà présent. La
   * base le refuserait par son index unique, mais avec une erreur brute
   * (`E11000 duplicate key`) que personne ne peut lire.
   */
  const futur = { ...ligne.toObject(), ...donnees };
  await refuserDoublon(futur, ligne.id);

  Object.assign(ligne, donnees);
  await ligne.save();
  return presenter(ligne);
}

async function refuserDoublon(donnees, sauf = null) {
  const existante = await Repartition.findOne({
    codeFiliereDrif: donnees.codeFiliereDrif,
    anneeFormation: donnees.anneeFormation,
    codeModule: donnees.codeModule,
    ...(sauf ? { _id: { $ne: sauf } } : {}),
  });

  if (existante) {
    throw badRequest(
      `Le module ${donnees.codeModule} existe déjà pour ${donnees.codeFiliereDrif} en année ${donnees.anneeFormation}.`,
      { code: 'MODULE_EN_DOUBLE' }
    );
  }
}

export async function supprimer(id) {
  const ligne = await Repartition.findByIdAndDelete(id);
  if (!ligne) throw notFound('Ligne de répartition introuvable');
  return { supprimees: 1, ligne: presenter(ligne) };
}

/**
 * Suppression d'une filière entière, ou d'une seule de ses années.
 * ← `supprimer_filiere_repartition.php`, qui n'existait qu'en ligne de commande.
 *
 * ⚠️ ELLE NE TOUCHE PAS AUX ÉTABLISSEMENTS : leurs cartes gardent leurs
 * affectations. La reconstruction croise la base avec ce référentiel et
 * RÉTABLIT un module affecté qui n'y figure plus (règle de la Phase 4) — la
 * filière ne disparaît donc pas de leur écran, mais elle cesse d'être
 * PROPOSABLE à un nouveau groupe. C'est ce qu'on veut d'une filière retirée du
 * catalogue national.
 */
export async function supprimerFiliere(code, annee) {
  const filtre = { codeFiliereDrif: code };
  if (annee) filtre.anneeFormation = annee;

  const concernees = await Repartition.countDocuments(filtre);
  if (concernees === 0) throw notFound('Aucune ligne ne correspond à cette filière');

  const { deletedCount } = await Repartition.deleteMany(filtre);
  const restantes = await Repartition.countDocuments({ codeFiliereDrif: code });

  return { supprimees: deletedCount, restantes };
}

/**
 * Import d'un classeur DRIF, en DEUX TEMPS.
 * ← les modes « analyse » et « completer » de `upload_repartition.php`.
 *
 * ═══ ⚠️ L'ANALYSE N'ÉCRIT RIEN ═══
 * Un fichier de 13 000 lignes appliqué au premier clic ne laisse aucune chance
 * de se raviser. L'écran annonce donc ce qui serait ajouté et ce qui serait
 * corrigé, et l'administrateur décide ensuite.
 *
 * ⚠️ AUCUNE SUPPRESSION, JAMAIS : un classeur partiel — un secteur, une
 * filière — ne doit pas pouvoir effacer les 13 359 lignes. C'est le risque que
 * l'existant avait explicitement retiré, et il reste retiré. Une filière se
 * retire par la suppression, à laquelle on dit ce qu'on fait.
 */
export async function importer(fichier, { mode, corrections }) {
  if (!fichier) throw badRequest('Aucun fichier reçu', { code: 'FICHIER_MANQUANT' });

  const feuilles = await lireToutesLesFeuilles(fichier.buffer, fichier.originalname);
  const choisie = choisirFeuilleRepartition(feuilles);

  if (!choisie) {
    throw badRequest(
      'Aucune feuille exploitable : il manque des colonnes obligatoires (Secteur, Code Filière DRIF, Code Module, MHP S1…).',
      { code: 'FEUILLE_INTROUVABLE' }
    );
  }

  const feuille = feuilles.find((f) => f.nom === choisie.nom);
  const { lignes, ignorees, colonnesAbsentes } = lireLignesRepartition(
    feuille.lignes,
    choisie.entetes,
    choisie.indexEntete
  );

  if (lignes.length === 0) {
    throw badRequest('Le classeur ne porte aucune ligne exploitable.', { code: 'CLASSEUR_VIDE' });
  }

  /*
   * ⚠️ ON NE CHARGE QUE LES FILIÈRES CONCERNÉES, pas les 13 359 lignes : un
   * classeur d'appoint porte quelques dizaines de lignes, et relire tout le
   * référentiel pour les comparer serait payer le prix fort à chaque analyse.
   */
  const codes = [...new Set(lignes.map((ligne) => ligne.codeFiliereDrif))];
  const [existantes, totalEnBase] = await Promise.all([
    /*
     * ⚠️ `.lean()` : un classeur complet ramène les 13 359 documents, et
     * l'hydratation Mongoose coûtait **3,0 s + 0,24 s de `toObject`** contre
     * **2,0 s** en objets bruts (mesuré sur la base réelle). On ne fait que
     * COMPARER ces lignes — aucun besoin d'un document Mongoose.
     */
    Repartition.find({ codeFiliereDrif: { $in: codes } }).lean(),
    Repartition.estimatedDocumentCount(),
  ]);

  const bilan = analyserRepartition(existantes, lignes);
  const uniques = dedoublonnerRepartition(lignes);

  /*
   * ═══ ⚠️ CE QU'UN REMPLACEMENT DÉTRUIRAIT ═══
   * Une ligne survit à un remplacement si le fichier la porte — ce sont
   * exactement les corrections et les identiques. Tout le reste du référentiel
   * disparaît.
   *
   * ⚠️ LE CALCUL EST EXACT SANS RELIRE LES 13 359 LIGNES : une ligne de la base
   * qui partage sa clé avec le fichier appartient forcément à une filière du
   * fichier, donc au lot déjà chargé.
   */
  const conservees = bilan.corrections.length + bilan.identiques;

  const resume = {
    totalEnBase,
    /* Ce que la base compterait APRÈS un remplacement : les lignes du fichier. */
    apresRemplacement: uniques.length,
    supprimeesSiRemplacement: Math.max(0, totalEnBase - conservees),
    feuille: choisie.nom,
    lues: lignes.length,
    ignorees,
    colonnesAbsentes,
    ajouts: bilan.ajouts.length,
    corrections: bilan.corrections.length,
    identiques: bilan.identiques,
    doublonsFichier: bilan.doublonsFichier,
    filieresAjoutees: bilan.filieresAjoutees,
    filieresCompletees: bilan.filieresCompletees,
    /* Un aperçu, pas la liste entière : douze corrections suffisent à juger. */
    apercuCorrections: bilan.corrections.slice(0, 12).map((c) => ({
      codeFiliereDrif: c.nouvelle.codeFiliereDrif,
      anneeFormation: c.nouvelle.anneeFormation,
      codeModule: c.nouvelle.codeModule,
      champs: c.champs.map((champ) => ({
        champ,
        avant: c.ancienne[champ],
        apres: c.nouvelle[champ],
      })),
    })),
  };

  if (mode === 'analyse') return { applique: false, ...resume };

  /*
   * ═══ ⚠️⚠️ LE REMPLACEMENT INTÉGRAL ═══ (demande explicite du porteur,
   * 2026-09-02 — il revient sur le choix « ajouter / corriger » du même jour, et
   * sur la réserve que j'avais posée.)
   *
   * Il VIDE le référentiel avant d'écrire le fichier : un classeur d'un seul
   * secteur laisserait donc quelques dizaines de lignes à la place de 13 359, et
   * toutes les cartes d'établissement perdraient les filières manquantes du
   * catalogue. C'est le risque que l'existant avait volontairement retiré.
   *
   * ⚠️ CE QUI LE REND TENABLE — deux choses, et elles ne sont pas négociables :
   *   1. l'analyse CHIFFRE ce qui disparaîtra, et l'écran le fait confirmer ;
   *   2. **la suppression et l'insertion vivent dans UNE transaction.** Sans
   *      elle, un échec entre les deux laisserait le référentiel VIDE — état
   *      bien pire que celui qu'on voulait remplacer, et dont aucune carte ne se
   *      relèverait.
   */
  if (mode === 'remplacer') {
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        await Repartition.deleteMany({}, { session });
        /* Dédoublonné : l'index unique refuserait une clé répétée, et l'échec
           arriverait APRÈS le vidage. */
        await Repartition.insertMany(uniques, { session, ordered: true });
      });
    } finally {
      await session.endSession();
    }

    return {
      applique: true,
      remplace: true,
      ...resume,
      supprimees: resume.supprimeesSiRemplacement,
      total: await Repartition.estimatedDocumentCount(),
    };
  }

  const operations = bilan.ajouts.map((ligne) => ({ insertOne: { document: ligne } }));

  if (corrections) {
    for (const correction of bilan.corrections) {
      operations.push({
        updateOne: {
          filter: {
            codeFiliereDrif: correction.nouvelle.codeFiliereDrif,
            anneeFormation: correction.nouvelle.anneeFormation,
            codeModule: correction.nouvelle.codeModule,
          },
          update: { $set: correction.nouvelle },
        },
      });
    }
  }

  if (operations.length > 0) {
    /*
     * ⚠️ `ordered: false` : une ligne refusée par l'index unique — une course
     * entre deux imports simultanés — ne doit pas arrêter les 12 000 suivantes.
     */
    await Repartition.bulkWrite(operations, { ordered: false });
  }

  return {
    applique: true,
    ...resume,
    /* Ce qui a RÉELLEMENT été écrit : sans `corrections`, elles restent comptées
       dans le résumé mais ne sont pas appliquées — le dire évite de croire à
       une mise à jour qui n'a pas eu lieu. */
    correctionsAppliquees: corrections ? bilan.corrections.length : 0,
    total: await Repartition.estimatedDocumentCount(),
  };
}

function presenter(ligne) {
  return {
    id: ligne.id,
    secteur: ligne.secteur,
    niveauFormation: ligne.niveauFormation,
    typeFormation: ligne.typeFormation,
    creneau: ligne.creneau,
    codeFiliereDrif: ligne.codeFiliereDrif,
    intituleFiliere: ligne.intituleFiliere,
    codeFiliereCarte: ligne.codeFiliereCarte,
    filiere: ligne.filiere,
    anneeFormation: ligne.anneeFormation,
    codeModule: ligne.codeModule,
    module: ligne.module,
    mhpS1: ligne.mhpS1,
    mhsynS1: ligne.mhsynS1,
    mhasynS1: ligne.mhasynS1,
    mhpS2: ligne.mhpS2,
    mhsynS2: ligne.mhsynS2,
    mhasynS2: ligne.mhasynS2,
    mhpTotale: ligne.mhpTotale,
    mhdTotale: ligne.mhdTotale,
    efmRegional: ligne.efmRegional,
    metier: ligne.metier,
  };
}
