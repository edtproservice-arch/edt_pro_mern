import mongoose from 'mongoose';
import { construireBase, semaineDansAnnee } from 'shared/domain';
import { Base } from '../../models/Base.js';
import { EnoteImport } from '../../models/EnoteImport.js';
import { badRequest, conflict } from '../../lib/httpError.js';
import { lirePremiereFeuille } from '../../lib/classeur.js';

/**
 * Lecture d'un fichier e-note et construction de la base.
 *
 * ← api/data/upload_base_data.php (405 l.) + includes/parse_base_rows.php
 *
 * La règle métier n'est PAS ici : elle vit dans `shared/domain`
 * (`construireBase`), caractérisée sur les 24 imports réels. Ce service ne fait
 * que trois choses — lire le classeur, appeler le domaine, écrire en base.
 * C'est la règle de couches du §10.1.
 */

/** Au-delà, c'est que ce n'est pas une base e-note. Le plus gros observé fait ~1 Mo. */
export const TAILLE_MAXIMALE = 10 * 1024 * 1024;

/**
 * Extrait les lignes d'un classeur.
 *
 * Les DEUX formats sont acceptés — .xlsx et l'ancien .xls binaire d'Excel 97 —
 * comme le faisait l'interface d'origine. Le choix du lecteur revient à
 * `lib/classeur` : `exceljs` pour l'OOXML, SheetJS pour le BIFF.
 *
 * @returns {{entete: string[], lignes: Array<Array<string>>}}
 */
export async function lireClasseur(tampon, nomFichier = '') {
  // Le format — .xlsx ou l'ancien .xls binaire — est arbitré par `lib/classeur`.
  const { lignes: toutes } = await lirePremiereFeuille(tampon, nomFichier);

  if (toutes.length === 0) {
    throw badRequest('Le fichier ne contient aucune feuille exploitable', { code: 'FICHIER_VIDE' });
  }

  // La première ligne est l'en-tête dès qu'elle porte un intitulé reconnu.
  // Certains exports e-note n'en ont pas : les index de colonnes prennent alors
  // le relais, et la première ligne est une donnée comme les autres.
  const ressembleAEntete =
    toutes.length > 0 &&
    toutes[0].some((cellule) => /Groupe|Code Filière|Formateur Affecté/i.test(cellule));

  const entete = ressembleAEntete ? toutes[0] : [];
  const lignes = ressembleAEntete ? toutes.slice(1) : toutes;

  // Le seuil porte sur les LIGNES DE DONNÉES, pas sur le total : sinon un
  // fichier sans en-tête d'une seule ligne était rejeté à tort.
  if (lignes.length === 0) {
    throw badRequest('Le fichier ne contient aucune donnée', { code: 'FICHIER_VIDE' });
  }

  return { entete, lignes };
}

/**
 * Importe un fichier e-note pour un établissement et une année.
 *
 * L'écriture touche DEUX collections — la base et la trace de l'import — donc
 * elle est transactionnelle. Une base enregistrée sans sa trace, ou l'inverse,
 * laisserait l'établissement dans un état qu'aucun écran ne sait expliquer.
 */
/**
 * L'import DÉJÀ ENREGISTRÉ pour la semaine scolaire d'une date, s'il existe.
 *
 * ═══ ⚠️ ON COMPARE DES NUMÉROS DE SEMAINE, PAS DES DATES ═══
 * Deux dépôts d'une même semaine n'ont ni le même jour ni forcément le même
 * lundi — un fichier préparé AVANT la rentrée relève de la S1 tout comme celui
 * déposé le mercredi suivant. Seul le numéro rendu par `semaineDansAnnee` les
 * réunit, et c'est lui que la frise chronologique affiche.
 *
 * ⚠️ ET DANS L'ANNÉE DE LA BASE, jamais dans celle de la date : un export
 * déposé le 19 août 2026 alimente l'année 2026-2027, pas celle qui s'achève.
 *
 * Le filtrage se fait en mémoire : une année compte quelques dizaines d'imports
 * au plus, et la règle de semaine scolaire — S1 = semaine du 1er septembre, sans
 * remise à zéro au 1er janvier — ne s'exprime dans aucune requête Mongo.
 */
async function importDeLaSemaine(etablissementId, anneeScolaire, date, session) {
  const semaine = semaineDansAnnee(anneeScolaire, date).numero;

  const deja = await EnoteImport.find({ etablissementId, anneeScolaire })
    .select('nomFichier importeLe')
    .session(session ?? null)
    .lean();

  return (
    deja.find(
      (trace) =>
        trace.importeLe && semaineDansAnnee(anneeScolaire, new Date(trace.importeLe)).numero === semaine
    ) ?? null
  );
}

export async function importer({
  etablissementId,
  anneeScolaire,
  nomFichier,
  tampon,
  utilisateurId,
  remplacer = false,
}) {
  // Le nom du fichier voyage jusqu'ici : c'est lui qui dit le format.
  const { entete, lignes } = await lireClasseur(tampon, nomFichier);

  // Les masses horaires déjà saisies font foi : un import ne doit pas les
  // écraser par une valeur déduite. ← parse_base_rows.php:186-195
  const existante = await Base.findOne({ etablissementId, anneeScolaire });
  const massesConnues = new Map();

  for (const formateur of existante?.formateurs ?? []) {
    const matricule = String(formateur.matricule ?? '').trim().toUpperCase();
    if (matricule !== '') massesConnues.set(matricule, formateur.masseHoraire);
    massesConnues.set(formateur.nomComplet, formateur.masseHoraire);
  }

  const structure = construireBase(lignes, { entete, massesConnues });

  if (structure.formateurs.length === 0 && structure.groupes.length === 0) {
    throw badRequest(
      "Aucun formateur ni groupe trouvé. Vérifiez qu'il s'agit bien d'un export « AvancementProgramme ».",
      { code: 'FICHIER_NON_RECONNU' }
    );
  }

  /*
   * ═══ ⚠️⚠️ UNE SEULE BASE E-NOTE PAR SEMAINE ═══ (règle du porteur,
   * 2026-09-01 : « le directeur peut insérer une seule base e-note chaque
   * semaine, il ne peut pas en insérer deux par semaine ».)
   *
   * C'est ce qui donne son sens à la frise : un point par semaine, un état
   * déclaré par semaine. Deux dépôts le même lundi rendraient la chronologie
   * ambiguë — laquelle des deux fait foi « à la S3 » ?
   *
   * ⚠️ MAIS ON N'ENFERME PAS L'ÉTABLISSEMENT POUR AUTANT. Refuser sèchement
   * bloquerait une semaine entière sur un mauvais fichier — et c'est justement
   * dans les minutes qui suivent un import qu'on s'aperçoit de l'erreur. Le
   * second dépôt est donc refusé PAR DÉFAUT, avec de quoi le dire (nom et date
   * du fichier en place), et l'appelant peut REMPLACER explicitement. Après
   * remplacement il n'y a toujours qu'une base pour la semaine : la règle tient.
   */
  const maintenant = new Date();
  const dejaCetteSemaine = await importDeLaSemaine(etablissementId, anneeScolaire, maintenant);

  if (dejaCetteSemaine && !remplacer) {
    throw conflict(
      'Une base e-note a déjà été importée cette semaine. Une seule est admise par semaine.',
      {
        code: 'IMPORT_HEBDOMADAIRE',
        details: {
          nomFichier: dejaCetteSemaine.nomFichier,
          importeLe: dejaCetteSemaine.importeLe,
          semaine: semaineDansAnnee(anneeScolaire, maintenant).numero,
        },
      }
    );
  }

  const session = await mongoose.startSession();

  try {
    let base;
    let importEnregistre;

    await session.withTransaction(async () => {
      base = await Base.findOneAndUpdate(
        { etablissementId, anneeScolaire },
        {
          $set: {
            formateurs: structure.formateursDetails,
            groupes: structure.groupes,
            fusionGroupes: structure.fusionGroupes,
            affectations: structure.affectations,
            groupeModes: structure.groupeModes,
            origine: 'enote',
          },
          // L'import remplace la base : une carte ouverte avant est périmée (étape d3).
          $inc: { version: 1 },
        },
        { upsert: true, new: true, session }
      );

      /*
       * ⚠️ DANS LA TRANSACTION, ET AVANT LA CRÉATION : hors transaction, un
       * échec de l'écriture suivante laisserait la semaine SANS aucune base —
       * pire que celle qu'on voulait corriger.
       */
      if (dejaCetteSemaine) {
        await EnoteImport.deleteOne({ _id: dejaCetteSemaine._id }, { session });
      }

      [importEnregistre] = await EnoteImport.create(
        [
          {
            etablissementId,
            anneeScolaire,
            nomFichier,
            entete,
            lignes,
            importePar: utilisateurId,
          },
        ],
        { session }
      );
    });

    return {
      baseId: base.id,
      importId: importEnregistre.id,
      /* Ce qui a été REMPLACÉ, pour que l'écran le dise : une suppression muette
         laisserait croire que les deux fichiers cohabitent. */
      remplace: dejaCetteSemaine
        ? { nomFichier: dejaCetteSemaine.nomFichier, importeLe: dejaCetteSemaine.importeLe }
        : null,
      lignesLues: lignes.length,
      effectifs: {
        formateurs: structure.formateurs.length,
        groupes: structure.groupes.length,
        fusionGroupes: structure.fusionGroupes.length,
        affectations: structure.affectations.length,
      },
      /** À faire vérifier par l'établissement : masse horaire déduite, pas saisie. */
      nouveauxFormateurs: structure.nouveauxFormateurs,
      /** Ceux-là seront identifiés par leur nom, moins stable qu'un matricule. */
      formateursSansMatricule: structure.formateursSansMatricule,
    };
  } finally {
    await session.endSession();
  }
}
