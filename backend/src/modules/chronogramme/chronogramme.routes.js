import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { ROLES } from 'shared/constants';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { badRequest } from '../../lib/httpError.js';
import * as service from './chronogramme.service.js';
import { exigerDroitPage } from '../partages/exigerDroitPage.js';
import { annoncerModification } from '../tempsReel/annonces.js';

/**
 * Chronogramme : planning annuel prévisionnel, par groupe (F7).
 * ← api/profile/get_chronogramme_data.php, save_chronogramme.php,
 *   get_chrono_status.php
 */
const router = Router();

/*
 * ═══ LE DROIT SUR LA PAGE DÉCIDE, PLUS LE RÔLE (Phase 5bis, étape d2) ═══
 *   - lire, exporter      → `consulter`
 *   - enregistrer         → `modifier` (un invité « peut modifier »)
 *   - importer un classeur → le DIRECTEUR seul : comme l'import d'une semaine
 *     d'emploi du temps, il réécrit plusieurs groupes d'un coup.
 *
 * ⚠️ Le gestionnaire perd l'accès par son seul RÔLE, que l'écran ne lui ouvrait
 * pas depuis le 2026-09-03 ; il le retrouve s'il est invité.
 */
router.use(
  authenticate,
  requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE, ROLES.FORMATEUR),
  resolveTenant
);

const lire = exigerDroitPage('chronogramme', 'consulter');
const modifier = exigerDroitPage('chronogramme', 'modifier');

/** Le planning change l'avancement (le « planifié ») : les deux salles relisent. */
const PAGES_DU_CHRONOGRAMME = ['chronogramme', 'avancement'];

const nomGroupe = z.object({
  // Les noms de groupe portent des espaces et des parenthèses — « ACADA101 (FQ) ».
  groupe: z.string().trim().min(1).max(60),
});

/**
 * Planning envoyé par l'écran.
 *
 * ⚠️ Les clés de semaine sont validées comme des ENTIERS de 1 à 45 : sans cette
 * borne, une clé fantaisiste entrerait en base et produirait une colonne que la
 * grille ne sait pas afficher — une donnée invisible, donc jamais corrigée.
 */
const planningSchema = z.object({
  // La version du planning que l'écran a lue (étape d3) — voir `lib/versionOptimiste.js`.
  version: z.number().int().min(0).optional(),
  planning: z.record(
    z.string().trim().min(1).max(60),
    z.record(
      z.string().regex(/^([1-9]|[1-3][0-9]|4[0-5])$/, 'Semaine hors des 45 de l’année'),
      z.object({
        heures: z.coerce.number().min(0).max(20),
        type: z.enum(['P', 'S']),
      })
    )
  ),
});

/**
 * Le fichier reste EN MÉMOIRE — jamais sur disque.
 *
 * Un classeur de chronogramme pèse quelques centaines de kilo-octets et son
 * contenu part directement en base. Écrire un fichier temporaire n'apporterait
 * qu'un répertoire à purger et une fuite de données possible.
 */
const televersement = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, fichier, suite) => {
    // Le type MIME du navigateur n'est pas fiable : on se fie à l'extension, et
    // la lecture refusera de toute façon un contenu qui n'est pas un classeur.
    if (!/\.xlsx?$/i.test(fichier.originalname)) {
      suite(badRequest('Format attendu : .xlsx ou .xls', { code: 'FORMAT_REFUSE' }));
      return;
    }
    suite(null, true);
  },
});

const exportSchema = z.object({
  mode: z.enum(['groupe', 'formateur']).default('groupe'),
  // Au moins un sujet : un classeur vide n'a rien à dire, et le produire
  // laisserait croire que l'export a fonctionné.
  sujets: z.array(z.string().trim().min(1).max(120)).min(1).max(60),
});

/**
 * Classeur d'export — un onglet par sujet.
 *
 * En POST et non en GET : la liste des sujets peut compter soixante noms avec
 * espaces et parenthèses, et une URL les tronquerait sans le dire.
 */
router.post('/export', lire, validate({ body: exportSchema }), async (req, res, next) => {
  try {
    const classeur = await service.exporter(req.etablissementId, req.anneeScolaire, req.body);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="chronogramme-${req.body.mode}-${req.anneeScolaire}.xlsx"`
    );
    res.send(classeur);
  } catch (error) {
    next(error);
  }
});

/**
 * Relecture d'un classeur.
 *
 * ⚠️ Réservé au DIRECTEUR, comme l'enregistrement : un import touche plusieurs
 * groupes d'un coup.
 */
router.post(
  '/import',
  requireRole(ROLES.DIRECTEUR),
  televersement.single('fichier'),
  async (req, res, next) => {
    try {
      if (!req.file) throw badRequest('Aucun fichier reçu', { code: 'FICHIER_ABSENT' });

      const bilan = await service.importer(
        req.etablissementId,
        req.anneeScolaire,
        req.file.buffer,
        req.file.originalname
      );

      res.json({ success: true, ...bilan });
      annoncerModification(req, PAGES_DU_CHRONOGRAMME, { action: 'importer' });
    } catch (error) {
      next(error);
    }
  }
);

/** Groupes de l'année et état de leur chronogramme. */
router.get('/', lire, async (req, res, next) => {
  try {
    const groupes = await service.listerGroupes(req.etablissementId, req.anneeScolaire);
    res.json({ success: true, groupes, anneeScolaire: req.anneeScolaire });
  } catch (error) {
    next(error);
  }
});

/*
 * ⚠️ LES DEUX ROUTES « par-formateur » SE DÉCLARENT AVANT `/:groupe`.
 * Express retient la PREMIÈRE route qui correspond : placées après, elles
 * seraient captées par `/:groupe`, qui chercherait alors un groupe nommé
 * « par-formateur » et répondrait 404 sur une route pourtant écrite.
 */

/**
 * Charge hebdomadaire de TOUS les formateurs et de TOUS les groupes.
 *
 * ⚠️ Déclarée AVANT `/:groupe`, comme « par-formateur » : sinon elle serait
 * captée par lui, qui chercherait un groupe nommé « charge ».
 */
router.get('/charge', lire, async (req, res, next) => {
  try {
    const bilan = await service.charge(req.etablissementId, req.anneeScolaire);
    res.json({ success: true, ...bilan });
  } catch (error) {
    next(error);
  }
});

/** Formateurs de l'année, pour le sélecteur du mode formateur. */
router.get('/par-formateur', lire, async (req, res, next) => {
  try {
    const formateurs = await service.listerFormateurs(req.etablissementId, req.anneeScolaire);
    res.json({ success: true, formateurs, anneeScolaire: req.anneeScolaire });
  } catch (error) {
    next(error);
  }
});

/** Grille d'un formateur : ses modules dans TOUS les groupes où il intervient. */
router.get(
  '/par-formateur/:formateur',
  lire,
  validate({ params: z.object({ formateur: z.string().trim().min(1).max(120) }) }),
  async (req, res, next) => {
    try {
      const grille = await service.obtenirParFormateur(
        req.etablissementId,
        req.anneeScolaire,
        req.params.formateur
      );
      res.json({ success: true, ...grille });
    } catch (error) {
      next(error);
    }
  }
);

/** Grille complète d'un groupe : modules, semaines et planning. */
router.get('/:groupe', lire, validate({ params: nomGroupe }), async (req, res, next) => {
  try {
    const grille = await service.obtenir(
      req.etablissementId,
      req.anneeScolaire,
      req.params.groupe
    );
    res.json({ success: true, ...grille });
  } catch (error) {
    next(error);
  }
});

/**
 * Enregistrement — remplacement intégral du planning du groupe.
 *
 * Au DIRECTEUR et aux invités « peut modifier » (étape d2) : le chronogramme
 * sert de référence au « planifié » de l'avancement, et la génération d'emploi
 * du temps le lit — d'où un droit explicite, jamais le seul rôle.
 */
router.put(
  '/:groupe',
  modifier,
  validate({ params: nomGroupe, body: planningSchema }),
  async (req, res, next) => {
    try {
      const bilan = await service.enregistrer(
        req.etablissementId,
        req.anneeScolaire,
        req.params.groupe,
        req.body.planning,
        req.body.version
      );
      res.json({ success: true, ...bilan });
      /*
       * ═══ LE PLANNING VOYAGE AVEC L'ANNONCE (2026-09-13) ═══ Les collègues
       * sur la page l'appliquent tel quel, avec sa version, au lieu de relire
       * le groupe : la cellule change chez eux à l'instant, sans aller-retour.
       * Un planning de groupe pèse ~2 Ko. L'avancement, lui, n'en a que faire :
       * son annonce reste nue.
       */
      annoncerModification(req, 'chronogramme', {
        action: 'enregistrer',
        groupe: req.params.groupe,
        planning: bilan.planning,
        version: bilan.version,
      });
      annoncerModification(req, 'avancement', { action: 'enregistrer', groupe: req.params.groupe });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
