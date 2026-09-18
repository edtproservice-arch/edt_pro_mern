import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { ROLES } from 'shared/constants';
import { lireFormateurs } from 'shared/domain';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { badRequest } from '../../lib/httpError.js';
import * as service from './base.service.js';
import * as carteService from './carte.service.js';
import * as contraintesService from './contraintes.service.js';
import { contraintesFormateurSchema } from 'shared/schemas';
import { construireClasseurBilan } from './bilan.service.js';
import { construireClasseurCarte } from './carteExport.service.js';
import { TAILLE_MAXIMALE, importer, lireClasseur } from './enoteImport.service.js';
import { annoncerModification } from '../tempsReel/annonces.js';
import { exigerDroitPage } from '../partages/exigerDroitPage.js';
import { logger } from '../../lib/logger.js';

/**
 * Base e-note et carte d'établissement (F3, F4).
 * ← api/data/upload_base_data.php, get_base_data.php
 */
const router = Router();

/*
 * ═══ PAR DROIT SUR LES PAGES, PLUS PAR RÔLE (Phase 5bis, étape d3) ═══
 * La base se LIT depuis cinq pages — Affectations, Formateurs, Stages et
 * Formations (la liste des groupes et des formateurs à choisir), Groupes FQ —
 * et s'ÉCRIT depuis deux : la carte (Affectations) et les corrections
 * (Formateurs). Un invité sur l'une d'elles doit donc pouvoir la lire.
 *
 * ⚠️ LE RÔLE RESTE FILTRÉ AVANT `resolveTenant` : un administrateur n'a pas
 * d'établissement, et un stagiaire n'est jamais invité — ils gardent leur 403.
 * L'import e-note, qui remplace la base d'un fichier, reste au DIRECTEUR.
 */
router.use(
  authenticate,
  requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE, ROLES.FORMATEUR),
  resolveTenant
);

const PAGES_LECTRICES = ['affectations', 'formateurs', 'stages', 'formations', 'groupesFq'];
const lire = exigerDroitPage(PAGES_LECTRICES, 'consulter');
const directeur = requireRole(ROLES.DIRECTEUR);

/*
 * Les pages qui affichent quelque chose de la base : une carte ou un import les
 * font toutes relire — la grille (affectations, noms), le chronogramme et
 * l'avancement (modules et masses), les listes de groupes et de formateurs.
 */
const PAGES_DE_LA_BASE = [
  ...PAGES_LECTRICES,
  'emploi',
  'chronogramme',
  'avancement',
  'efm',
];

/*
 * ═══ LA SALLE « AFFECTATIONS » REÇOIT LA BASE ELLE-MÊME (2026-09-13) ═══
 * Comme le chronogramme reçoit le planning d'un groupe : la carte d'un collègue
 * s'applique chez les autres SANS relecture. Relire, c'était attendre 250 ms de
 * regroupement puis un aller-retour de 64 Ko — la carte changeait chez les
 * autres plus d'une seconde après la saisie.
 *
 * ⚠️ À CETTE SEULE SALLE : c'est elle qui reconstruit sa carte à partir de ce
 * document. Les autres pages en tirent une liste ou un compte, et relisent ;
 * leur envoyer 64 Ko à chaque affectation n'apporterait rien.
 *
 * ⚠️ LA BASE EST RELUE PAR LE PRÉSENTATEUR DE `GET /base` : le client la pose
 * telle quelle dans le cache de cette route. Une forme à part divergerait au
 * premier champ ajouté — le piège du présentateur, déjà payé sept fois.
 *
 * ⚠️ APRÈS LA RÉPONSE, ET SANS JAMAIS FAIRE ÉCHOUER LA ROUTE : l'écriture a
 * réussi. Si la relecture échoue, l'annonce part nue et la page relit — le
 * comportement d'avant.
 */
function annoncerBase(req, action) {
  annoncerModification(
    req,
    PAGES_DE_LA_BASE.filter((page) => page !== 'affectations'),
    { action }
  );
  service
    .obtenir(req.etablissementId, req.anneeScolaire)
    .then((base) => annoncerModification(req, 'affectations', { action, base }))
    .catch((erreur) => {
      logger.warn({ err: erreur }, 'Base non jointe à l’annonce');
      annoncerModification(req, 'affectations', { action });
    });
}

/**
 * Le fichier reste EN MÉMOIRE, jamais écrit sur disque.
 *
 * Un import fait au plus quelques mégaoctets, et le contenu part directement en
 * base. Écrire un fichier temporaire n'apporterait qu'un répertoire à purger et
 * une fuite de données possible — `upload_base_data.php` s'appuyait sur le
 * répertoire de téléversement de PHP.
 */
const televersement = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAILLE_MAXIMALE, files: 1 },
  fileFilter: (req, fichier, suite) => {
    // Le type MIME envoyé par le navigateur n'est pas fiable : on se fie à
    // l'extension, et `lireClasseur` refusera de toute façon un contenu qui
    // n'est pas un classeur.
    if (!/\.xlsx?$/i.test(fichier.originalname)) {
      suite(badRequest('Format attendu : .xlsx ou .xls', { code: 'FORMAT_REFUSE' }));
      return;
    }
    suite(null, true);
  },
});

router.get('/', lire, async (req, res, next) => {
  try {
    const base = await service.obtenir(req.etablissementId, req.anneeScolaire);
    // `null` est un état attendu : l'établissement n'a rien importé encore.
    res.json({ success: true, base });
  } catch (error) {
    next(error);
  }
});

router.get('/resume', lire, async (req, res, next) => {
  try {
    res.json({ success: true, resume: await service.resumer(req.etablissementId, req.anneeScolaire) });
  } catch (error) {
    next(error);
  }
});

router.get('/imports', lire, async (req, res, next) => {
  try {
    const imports = await service.listerImports(req.etablissementId, req.anneeScolaire);
    res.json({ success: true, imports });
  } catch (error) {
    next(error);
  }
});

/** Import d'un fichier « AvancementProgramme » exporté depuis e-note. */
router.post('/import', directeur, televersement.single('fichier'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw badRequest('Aucun fichier reçu', { code: 'FICHIER_ABSENT' });
    }

    const resultat = await importer({
      etablissementId: req.etablissementId,
      anneeScolaire: req.anneeScolaire,
      nomFichier: req.file.originalname,
      tampon: req.file.buffer,
      utilisateurId: req.utilisateur.id,
      /*
       * ⚠️ CHAMP MULTIPART, DONC UNE CHAÎNE : `remplacer` arrive en « true » et
       * non en booléen. Le comparer directement ferait passer « false » pour
       * vrai — et un remplacement non demandé détruirait la base de la semaine.
       */
      remplacer: req.body?.remplacer === 'true',
    });

    res.status(201).json({ success: true, ...resultat });
    // La face e-note de l'« Avancement » lit ce fichier, et la base remplacée
    // change toutes les pages qui en affichent quelque chose.
    annoncerBase(req, 'import-enote');
  } catch (error) {
    next(error);
  }
});

/**
 * Analyse d'un classeur de formateurs — LECTURE SEULE, rien n'est écrit.
 * ← importFormateursExcel() dans assets/js/affectation-carte.js
 *
 * L'existant lisait le fichier dans le navigateur, ce qui imposait de
 * télécharger SheetJS (861 Ko). Ici c'est le serveur qui lit : il a déjà
 * `exceljs` pour l'import e-note, et la règle de lecture vit dans le domaine,
 * donc en un seul exemplaire.
 *
 * La liste revient au client, qui la fusionne avec sa carte en cours. Écrire
 * ici serait faux : la carte n'est enregistrée qu'au bouton « Enregistrer ».
 */
router.post(
  '/formateurs/analyse',
  exigerDroitPage('affectations', 'modifier'),
  televersement.single('fichier'),
  async (req, res, next) => {
    try {
      if (!req.file) throw badRequest('Aucun fichier reçu', { code: 'FICHIER_ABSENT' });

      // `entete` est réintégré : `lireClasseur` l'écarte pour l'import e-note,
      // alors qu'ici c'est justement lui qui nomme les colonnes.
      const { entete, lignes } = await lireClasseur(req.file.buffer, req.file.originalname);
      const toutes = entete.length > 0 ? [entete, ...lignes] : lignes;

      let resultat;
      try {
        resultat = lireFormateurs(toutes);
      } catch (erreur) {
        throw badRequest(erreur.message, { code: 'COLONNES_INTROUVABLES' });
      }

      res.json({
        success: true,
        formateurs: resultat.formateurs,
        lignesIgnorees: resultat.lignesIgnorees,
        // De quoi expliquer au directeur ce que le serveur a cru comprendre,
        // plutôt qu'un échec sans motif.
        colonnesReconnues: {
          matricule: resultat.colonnes.matricule !== -1,
          masseHoraire: resultat.colonnes.masseHoraire !== -1,
          email: resultat.colonnes.email !== -1,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

const moduleSchema = z
  .object({
    code: z.string().trim().max(60).default(''),
    nom: z.string().trim().max(255).default(''),
    mhpS1: z.coerce.number().min(0).max(2000).default(0),
    mhpS2: z.coerce.number().min(0).max(2000).default(0),
    mhsynS1: z.coerce.number().min(0).max(2000).default(0),
    mhsynS2: z.coerce.number().min(0).max(2000).default(0),
    mhasynS1: z.coerce.number().min(0).max(2000).default(0),
    mhasynS2: z.coerce.number().min(0).max(2000).default(0),
    estRegional: z.boolean().default(false),

    /*
     * Métier de la répartition DRIF — la colonne « Métier », que le client
     * reçoit de `/repartitions/modules` et transporte dans chaque module.
     *
     * ⚠️ Zod RETIRE les clés non déclarées, même sans `.strict()`. Tant que ce
     * champ manquait ici, il était supprimé avant d'atteindre le calcul : le
     * bilan groupait alors tout sous « Non renseigné », avec des totaux justes
     * mais une seule ligne — indétectable en regardant les seuls totaux.
     */
    metier: z.string().trim().max(150).default(''),
    // Un module désactivé par l'établissement ne produit aucune ligne e-note :
    // il n'est ni dispensé, ni suivi en avancement.
    actif: z.boolean().default(true),
    formateurPresentiel: z.string().trim().max(150).default(''),
    formateurSynchrone: z.string().trim().max(150).default(''),
    groupeFusion: z.string().trim().max(150).default(''),

    // Masse de la répartition DRIF et marqueur d'ajustement : le client les
    // porte pour pouvoir rétablir la valeur d'origine. Le serveur ne s'en sert
    // pas, mais les refuser (le schéma est `strict`) ferait échouer la carte
    // d'un groupe alterné.
    reference: z
      .object({ mhpS1: z.coerce.number().min(0).max(2000), mhpS2: z.coerce.number().min(0).max(2000) })
      .strict()
      .optional(),
    masseAjustee: z.boolean().optional(),
  })
  // Un module sans code NI nom ne peut être ni affecté ni suivi : il
  // produirait une ligne fantôme dans la base.
  .refine((module) => module.code !== '' || module.nom !== '', {
    message: 'Un module doit porter un code ou un intitulé',
    path: ['code'],
  });

const carteSchema = z.object({
  /*
   * La version de la base que l'écran a lue (étape d3). Facultative : sans elle,
   * la carte remplace la base sans condition — voir `lib/versionOptimiste.js`.
   */
  version: z.number().int().min(0).optional(),

  formateurs: z
    .array(
      z
        .object({
          nom: z.string().trim().min(1).max(150),
          matricule: z.string().trim().max(20).default(''),
          masseHoraire: z.coerce.number().int().min(0).max(2000).optional(),

          /*
           * L'import Excel des formateurs reconnaît une colonne « Email » et la
           * rend dans chaque formateur (`lireFormateurs`). L'objet est
           * `strict()` : omettre ce champ ici faisait rejeter la carte ENTIÈRE
           * avec « Unrecognized key(s): 'email' » — donc l'enregistrement ET
           * l'export échouaient dès que les formateurs venaient d'un fichier,
           * qui est le chemin normal.
           */
          email: z.string().trim().max(150).default(''),
        })
        .strict()
    )
    .max(500)
    .default([]),

  groupes: z
    .array(
      z
        .object({
          nom: z.string().trim().min(1).max(100),
          codeFiliere: z.string().trim().max(80).default(''),
          intituleFiliere: z.string().trim().max(255).default(''),
          anneeFormation: z.coerce.number().int().min(1).max(5).default(1),
          niveau: z.string().trim().max(30).default(''),
          secteur: z.string().trim().max(150).default(''),
          typeFormation: z.string().trim().max(80).default(''),
          creneau: z.string().trim().max(10).default(''),
          mode: z.string().trim().max(40).default('Résidentiel'),
          modules: z.array(moduleSchema).max(80),
        })
        .strict()
    )
    .min(1, 'Générez au moins un groupe avant d’enregistrer')
    .max(300),
});

/**
 * Enregistrement de la carte construite à la main.
 * ← api/profile/save_affectations.php
 *
 * Elle passe par le même parseur que l'import : les deux chemins produisent la
 * même base (cf. carte.service.js).
 */
router.post(
  '/carte',
  exigerDroitPage('affectations', 'modifier'),
  validate({ body: carteSchema }),
  async (req, res, next) => {
    try {
      const { version, ...carte } = req.body;
      const resultat = await carteService.enregistrerCarte({
        etablissementId: req.etablissementId,
        anneeScolaire: req.anneeScolaire,
        carte,
        version,
      });
      res.status(201).json({ success: true, ...resultat });
      annoncerBase(req, 'enregistrer-carte');
    } catch (error) {
      next(error);
    }
  }
);

const correctionsSchema = z.object({
  formateurs: z
    .array(
      z
        .object({
          nomComplet: z.string().trim().min(1),
          // Le matricule PEUT être vidé : certains formateurs n'en ont pas dans
          // le fichier e-note, et forcer une valeur inventée serait pire.
          matricule: z.string().trim().max(20).optional(),
          email: z.union([z.string().trim().email(), z.literal('')]).optional(),
          masseHoraire: z.coerce.number().int().min(0).max(2000).optional(),
        })
        .strict()
    )
    .min(1)
    .max(500),
});

/** Corrections des fiches formateurs (adresse, matricule, masse horaire), en lot. */
/**
 * Export Excel du bilan offre / demande.
 * ← exportBilanExcel() de affectation-carte.js
 *
 * La carte voyage dans le corps de la requête parce qu'elle n'est pas encore
 * enregistrée : on exporte ce qui est à l'écran. Rien n'est écrit en base.
 */
function repondreClasseur(res, { tampon, nomFichier, resume }) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  // `filename*` porte les accents ; `filename` reste là pour les clients anciens.
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(nomFichier)}`
  );
  // Le client lit ce résumé pour son message de confirmation : il ne peut pas
  // compter les lignes d'un binaire.
  res.setHeader('X-Resume-Bilan', JSON.stringify(resume));
  res.setHeader('Access-Control-Expose-Headers', 'X-Resume-Bilan, Content-Disposition');

  res.send(tampon);
}

// Les exports n'écrivent rien : consulter la carte suffit.
router.post('/bilan/export', exigerDroitPage('affectations', 'consulter'), validate({ body: carteSchema }), async (req, res, next) => {
  try {
    repondreClasseur(
      res,
      await construireClasseurBilan({ carte: req.body, anneeScolaire: req.anneeScolaire })
    );
  } catch (error) {
    next(error);
  }
});

/**
 * Export COMPLET de la carte — 8 feuilles.
 * ← exportCarteExcel()
 *
 * La première feuille, « AvancementProgramme », porte la carte au format
 * e-note : le fichier produit est directement réimportable.
 */
router.post('/carte/export', exigerDroitPage('affectations', 'consulter'), validate({ body: carteSchema }), async (req, res, next) => {
  try {
    repondreClasseur(
      res,
      await construireClasseurCarte({
        carte: req.body,
        anneeScolaire: req.anneeScolaire,
        etablissementId: req.etablissementId,
      })
    );
  } catch (error) {
    next(error);
  }
});

router.patch('/formateurs', exigerDroitPage('formateurs', 'modifier'), validate({ body: correctionsSchema }), async (req, res, next) => {
  try {
    const resultat = await service.corrigerFormateurs(
      req.etablissementId,
      req.anneeScolaire,
      req.body.formateurs
    );
    res.json({ success: true, ...resultat });
    annoncerBase(req, 'corriger-formateurs');
  } catch (error) {
    next(error);
  }
});

/*
 * ═══ DISPONIBILITÉ ET SALLES ATTRIBUÉES (2026-09-17) ═══
 * ← le panneau « Formateurs » de profile.html (profil-contraintes.js)
 *
 * L'emploi du temps les lit aussi : il signale un créneau à éviter et
 * pré-remplit la salle. Ses salles sont donc prévenues à chaque écriture.
 */
router.get('/formateurs/contraintes', exigerDroitPage(['formateurs', 'emploi'], 'consulter'), async (req, res, next) => {
  try {
    res.json({
      success: true,
      contraintes: await contraintesService.lister(req.etablissementId, req.anneeScolaire),
    });
  } catch (error) {
    next(error);
  }
});

router.patch(
  '/formateurs/contraintes',
  exigerDroitPage('formateurs', 'modifier'),
  validate({ body: contraintesFormateurSchema }),
  async (req, res, next) => {
    try {
      const contraintes = await contraintesService.definir(
        req.etablissementId,
        req.anneeScolaire,
        req.body
      );
      res.json({ success: true, contraintes });
      annoncerModification(req, ['formateurs', 'emploi'], { action: 'contraintes-formateur' });
    } catch (error) {
      next(error);
    }
  }
);

const masseHoraireSchema = z.object({
  matricule: z.string().trim().min(1),
  masseHoraire: z.coerce.number().int().min(0).max(2000),
});

/** Correction de la masse horaire statutaire d'un formateur. */
router.patch(
  '/formateurs/masse-horaire',
  exigerDroitPage(['formateurs', 'affectations'], 'modifier'),
  validate({ body: masseHoraireSchema }),
  async (req, res, next) => {
  try {
    const resultat = await service.definirMasseHoraire(
      req.etablissementId,
      req.anneeScolaire,
      req.body.matricule,
      req.body.masseHoraire
    );
    res.json({ success: true, ...resultat });
    // ⚠️ ELLE N'ANNONÇAIT RIEN (trouvé le 2026-09-13) : la version de la base
    // avançait, et la carte ouverte d'un collègue ne l'apprenait qu'au refus.
    annoncerBase(req, 'masse-horaire');
  } catch (error) {
    next(error);
  }
});

export default router;
