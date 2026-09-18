import mongoose from 'mongoose';
import { lireStagiaires } from 'shared/domain';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';
import { Stagiaire } from '../../models/Stagiaire.js';
import { User } from '../../models/User.js';
import { badRequest } from '../../lib/httpError.js';
import { lirePremiereFeuille } from '../../lib/classeur.js';

/**
 * Import Konosys et consultation des stagiaires.
 * ← api/students/upload.php + api/students/get.php
 *
 * ═══ LE FICHIER EST LU PAR LE SERVEUR ═══
 * `canvas.html:1138-1152` lisait l'Excel dans le navigateur avec SheetJS
 * (861 Ko depuis un CDN) et POSTait le JSON obtenu : le serveur insérait donc
 * ce que le navigateur voulait bien lui envoyer, sans jamais voir le fichier.
 * Ici la lecture se fait côté SERVEUR, par `lib/classeur` : .xlsx avec
 * `exceljs`, .xls avec SheetJS. La CSP stricte prévue en Phase 11 reste donc
 * applicable, aucun script n'étant chargé depuis un CDN.
 */

/**
 * Le fichier est gardé EN MÉMOIRE, jamais écrit sur disque — comme l'e-note.
 *
 * Les deux formats sont acceptés, .xlsx et l'ancien .xls binaire : c'est
 * `lib/classeur` qui choisit le lecteur.
 *
 * Les lignes sont rendues en OBJETS indexés par intitulé de colonne — la forme
 * que `sheet_to_json` produisait dans le navigateur, et que le domaine attend.
 */
export async function lireClasseur(tampon, nomFichier = '') {
  const { lignes: brutes } = await lirePremiereFeuille(tampon, nomFichier);

  const [entetes = [], ...donnees] = brutes;
  if (entetes.length === 0) {
    throw badRequest('Le classeur ne contient aucune feuille exploitable', {
      code: 'CLASSEUR_VIDE',
    });
  }

  const intitules = entetes.map((entete) => String(entete ?? '').trim());

  return donnees
    .map((ligne) => {
      const objet = {};
      intitules.forEach((intitule, index) => {
        if (intitule === '') return;
        objet[intitule] = ligne[index] ?? '';
      });
      return objet;
    })
    .filter((objet) => Object.values(objet).some((valeur) => String(valeur).trim() !== ''));
}

/**
 * Remplace la base Konosys de l'ANNÉE par celle du fichier.
 * ← upload.php:31-143
 *
 * ═══ UNE BASE PAR ANNÉE SCOLAIRE ═══ (décision du porteur, 2026-09-14)
 * Chaque établissement garde UNE base par année : la dernière importée. Un
 * nouvel import de la même année l'ÉCRASE ; celui d'une autre année n'y touche
 * pas. L'existant faisait `DELETE FROM stagiaires WHERE etablissement_id = ?` —
 * tout l'établissement, toutes années confondues : préparer la rentrée en
 * important la base de l'année suivante effaçait celle de l'année en cours.
 *
 * ⚠️ REMPLACEMENT INTÉGRAL de cette année, et non fusion : le fichier Konosys
 * fait autorité — un stagiaire qui n'y est plus a quitté l'établissement.
 *
 * Le tout dans UNE transaction : un échec au milieu laisserait sinon l'année
 * sans aucun stagiaire, ce qui est pire que l'état d'avant.
 */
export async function importer(etablissementId, anneeScolaire, lignesFichier) {
  const { stagiaires, ignorees } = lireStagiaires(lignesFichier);

  if (stagiaires.length === 0) {
    throw badRequest(
      'Aucun stagiaire trouvé. Vérifiez que le fichier porte une colonne « MatriculeEtudiant ».',
      { code: 'AUCUN_STAGIAIRE' }
    );
  }

  const session = await mongoose.startSession();
  let remplaces = 0;
  let comptes;

  try {
    // ⚠️ Tout est réaffecté DANS le rappel : `withTransaction` le rejoue en cas
    // de conflit transitoire, et un bilan resté d'un essai avorté mentirait.
    await session.withTransaction(async () => {
      const plusRecente = await anneePlusRecente(etablissementId, anneeScolaire, session);

      ({ deletedCount: remplaces } = await Stagiaire.deleteMany(
        { etablissementId, anneeScolaire },
        { session }
      ));

      await Stagiaire.insertMany(
        stagiaires.map((stagiaire) => ({ ...stagiaire, etablissementId, anneeScolaire })),
        { session, ordered: false }
      );

      /*
       * ⚠️ LES COMPTES NE SUIVENT QUE LA BASE LA PLUS RÉCENTE (décision du
       * porteur, 2026-09-14). Un compte n'a pas d'année : c'est la dernière base
       * qui dit qui est encore là. Réimporter une année PASSÉE — pour corriger
       * un effectif ou reprendre un document — ne doit supprimer personne : ceux
       * qui en sont absents sont peut-être inscrits l'année suivante.
       */
      comptes = plusRecente
        ? { synchronises: false, anneePlusRecente: plusRecente }
        : await synchroniserComptes(etablissementId, stagiaires, session);
    });
  } finally {
    await session.endSession();
  }

  return {
    anneeScolaire,
    importes: stagiaires.length,
    // Ce que l'import a écrasé : la base précédente de CETTE année.
    remplaces,
    lignesIgnorees: ignorees,
    comptes,
  };
}

/** L'année d'une base PLUS RÉCENTE que celle-ci, ou `null`. */
async function anneePlusRecente(etablissementId, anneeScolaire, session = null) {
  const plusRecent = await Stagiaire.findOne({
    etablissementId,
    anneeScolaire: { $gt: anneeScolaire },
  })
    .sort({ anneeScolaire: -1 })
    .select('anneeScolaire')
    .session(session)
    .lean();

  return plusRecent?.anneeScolaire ?? null;
}

/**
 * Aligne les comptes stagiaires sur la base qui vient d'être importée.
 * ← upload.php:145-205
 *
 * ⚠️ LA SUPPRESSION DES COMPTES ABSENTS EST CONSERVÉE — décision du porteur du
 * 2026-08-19, après que le risque a été exposé : un fichier Konosys partiel
 * (une seule filière exportée par erreur) supprime les comptes de tous les
 * autres. La réponse porte donc le NOMBRE de comptes supprimés, et l'écran le
 * met en avant : l'existant le faisait sans rien dire.
 *
 * ⚠️ CE QUI N'EST PAS REPRIS : la création de comptes. `upload.php:189-191`
 * réutilisait le hachage de mot de passe d'un compte stagiaire existant pris au
 * hasard, et ne créait RIEN quand il n'y en avait aucun — le premier import
 * d'un établissement neuf produisait donc zéro compte, silencieusement. La
 * création se fait depuis la page « Sessions », où le directeur choisit le mot
 * de passe et voit ce qui a été créé.
 */
async function synchroniserComptes(etablissementId, stagiaires, session) {
  const presents = new Set(stagiaires.map((stagiaire) => stagiaire.matricule));

  const comptes = await User.find({ etablissementIds: etablissementId, role: ROLES.STAGIAIRE })
    .select('identifiant nomComplet email')
    .session(session);

  const absents = comptes.filter((compte) => !presents.has(compte.identifiant));

  if (absents.length > 0) {
    await User.deleteMany({ _id: { $in: absents.map((compte) => compte._id) } }, { session });
  }

  // Le nom peut avoir changé entre deux exports ; le compte doit suivre, sinon
  // les listes d'émargement portent l'ancien.
  const parMatricule = new Map(stagiaires.map((stagiaire) => [stagiaire.matricule, stagiaire]));
  let misAJour = 0;

  for (const compte of comptes) {
    const stagiaire = parMatricule.get(compte.identifiant);
    if (!stagiaire) continue;

    const nomComplet = `${stagiaire.nom} ${stagiaire.prenom}`.trim();
    if (nomComplet === '' || nomComplet === compte.nomComplet) continue;

    await User.updateOne({ _id: compte._id }, { $set: { nomComplet } }, { session });
    misAJour += 1;
  }

  return {
    synchronises: true,
    supprimes: absents.length,
    misAJour,
    // De quoi dire « 12 comptes créés sur 995 stagiaires » dans l'écran.
    conserves: comptes.length - absents.length,
    sansCompte: stagiaires.length - (comptes.length - absents.length),
  };
}

/*
 * ═══ TOUTES LES LECTURES SONT BORNÉES À L'ANNÉE AFFICHÉE ═══ Elles ne
 * l'étaient pas quand il n'existait qu'une base par établissement : les borner
 * alors aurait vidé la liste à chaque bascule d'année. Depuis qu'il y a une
 * base par année, NE PAS la borner mêlerait les inscrits de deux rentrées — un
 * stagiaire de 2e année compterait deux fois dans les effectifs.
 */

/** Stagiaires de l'année, filtrables. ← get.php + les cascades de canvas.html */
export async function lister(
  etablissementId,
  anneeScolaire,
  { niveau, annee, filiere, groupe, recherche } = {}
) {
  const filtre = { etablissementId, anneeScolaire };

  if (niveau) filtre.niveau = niveau;
  if (annee) filtre.annee = annee;
  if (filiere) filtre.filiere = filiere;
  if (groupe) filtre.groupes = groupe;

  if (recherche) {
    const motif = new RegExp(recherche.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filtre.$or = [{ nom: motif }, { prenom: motif }, { matricule: motif }];
  }

  const stagiaires = await Stagiaire.find(filtre).sort({ nom: 1, prenom: 1 }).limit(3000);

  return stagiaires.map(presenter);
}

/**
 * Valeurs disponibles pour les filtres en cascade.
 * ← populateLevelFilter / populateSelectWithOptions de canvas.html
 *
 * Calculées par le SERVEUR : l'existant chargeait tous les stagiaires dans le
 * navigateur pour en extraire les listes déroulantes.
 */
export async function filtres(etablissementId, anneeScolaire, { niveau, annee, filiere } = {}) {
  const base = { etablissementId, anneeScolaire };
  const auNiveau = niveau ? { ...base, niveau } : base;
  const aLAnnee = annee ? { ...auNiveau, annee } : auNiveau;
  const aLaFiliere = filiere ? { ...aLAnnee, filiere } : aLAnnee;

  const [niveaux, annees, filieres, groupes, total] = await Promise.all([
    Stagiaire.distinct('niveau', base),
    Stagiaire.distinct('annee', auNiveau),
    Stagiaire.distinct('filiere', aLAnnee),
    Stagiaire.distinct('groupes', aLaFiliere),
    Stagiaire.countDocuments(base),
  ]);

  const propres = (valeurs) => valeurs.filter((v) => String(v ?? '').trim() !== '').sort();

  return {
    niveaux: propres(niveaux),
    annees: propres(annees),
    filieres: propres(filieres),
    groupes: propres(groupes),
    total,
  };
}

/**
 * Effectifs, par filière puis par groupe.
 *
 * ⚠️ LE TOTAL N'EST PAS LA SOMME DES GROUPES. Un stagiaire inscrit dans un
 * tronc diplômant ET un module FQ appartient à deux groupes : il compte dans
 * chacun, mais c'est UNE personne. Le total vient donc d'un `countDocuments`
 * séparé, jamais d'une addition — sinon l'écran annonce plus de stagiaires que
 * l'établissement n'en a, et le chiffre est contesté.
 *
 * ⚠️ La filière retenue est celle du groupe DIPLÔMANT : les inscriptions FQ
 * apparaissent donc sous la filière réelle du stagiaire, ce qui est ce qu'on
 * veut sur un document imprimé.
 */
export async function statistiques(etablissementId, anneeScolaire) {
  const [total, parGroupe, derniere, annees] = await Promise.all([
    Stagiaire.countDocuments({ etablissementId, anneeScolaire }),
    Stagiaire.aggregate([
      {
        // ⚠️ `aggregate` ne convertit pas les types, contrairement à `find` :
        // l'identifiant en chaîne et l'année en texte ne correspondraient à rien.
        $match: {
          etablissementId: new mongoose.Types.ObjectId(etablissementId),
          anneeScolaire: Number(anneeScolaire),
        },
      },
      { $unwind: '$groupes' },
      {
        $group: {
          _id: { filiere: '$filiere', groupe: '$groupes' },
          total: { $sum: 1 },
        },
      },
      { $sort: { '_id.filiere': 1, '_id.groupe': 1 } },
    ]),
    // La date d'import : tous les documents d'une base naissent ensemble.
    Stagiaire.findOne({ etablissementId, anneeScolaire }).sort({ createdAt: -1 }).select('createdAt').lean(),
    Stagiaire.distinct('anneeScolaire', { etablissementId }),
  ]);

  const parFiliere = new Map();

  for (const ligne of parGroupe) {
    const nom = String(ligne._id.filiere ?? '').trim() || 'Filière non renseignée';
    if (!parFiliere.has(nom)) parFiliere.set(nom, { nom, groupes: [] });
    parFiliere.get(nom).groupes.push({ nom: ligne._id.groupe, total: ligne.total });
  }

  const filieres = [...parFiliere.values()].map((filiere) => ({
    ...filiere,
    // Somme des inscriptions de la filière — à lire comme telle, pas comme un
    // effectif de personnes.
    inscriptions: filiere.groupes.reduce((somme, groupe) => somme + groupe.total, 0),
  }));

  const plusRecente = annees.filter((annee) => annee > anneeScolaire).sort((a, b) => b - a)[0];

  return {
    total,
    filieres,
    nombreFilieres: filieres.length,
    nombreGroupes: parGroupe.length,
    // De quoi dire, avant l'import, CE qui sera remplacé et SI des comptes
    // seront touchés — la confirmation ne doit rien annoncer de faux.
    anneeScolaire,
    importeLe: derniere?.createdAt ?? null,
    anneePlusRecente: plusRecente ?? null,
  };
}

function presenter(stagiaire) {
  return {
    id: stagiaire.id,
    matricule: stagiaire.matricule,
    nom: stagiaire.nom,
    prenom: stagiaire.prenom,
    nomArabe: stagiaire.nomArabe,
    prenomArabe: stagiaire.prenomArabe,
    email: stagiaire.email,
    cin: stagiaire.cin,
    dateNaissance: stagiaire.dateNaissance,
    groupes: stagiaire.groupes,
    groupePrincipal: stagiaire.groupePrincipal,
    niveau: stagiaire.niveau,
    annee: stagiaire.annee,
    filiere: stagiaire.filiere,
    site: stagiaire.site,
  };
}

export { STATUTS_COMPTE };
