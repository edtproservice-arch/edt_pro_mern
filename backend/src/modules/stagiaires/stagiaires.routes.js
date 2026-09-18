import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { ROLES } from 'shared/constants';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { badRequest } from '../../lib/httpError.js';
import { exigerDroitPage } from '../partages/exigerDroitPage.js';
import { annoncerModification } from '../tempsReel/annonces.js';
import * as service from './stagiaires.service.js';

/**
 * Stagiaires de l'établissement — import Konosys et consultation (F11).
 * ← api/students/upload.php + get.php, appelés depuis canvas.html
 *
 * La chaîne `authenticate → requireRole → resolveTenant` est posée UNE FOIS
 * pour tout le module : c'est ce que les 96 endpoints PHP refaisaient chacun à
 * leur façon (§4.1 du plan).
 */
const router = Router();

/** 10 Mo : un export Konosys de 2 000 stagiaires pèse quelques centaines de Ko. */
const TAILLE_MAXIMALE = 10 * 1024 * 1024;

const televersement = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAILLE_MAXIMALE, files: 1 },
  fileFilter: (req, fichier, suite) => {
    /*
     * Le type MIME du navigateur n'est pas fiable : on se fie à l'extension.
     * Les DEUX formats sont acceptés — c'est `lib/classeur` qui choisit le
     * lecteur — et `lireClasseur` refusera de toute façon un contenu qui n'est
     * pas un classeur, quelle que soit l'extension annoncée.
     */
    if (!/\.xlsx?$/i.test(fichier.originalname)) {
      suite(badRequest('Format attendu : .xlsx ou .xls', { code: 'FORMAT_REFUSE' }));
      return;
    }
    suite(null, true);
  },
});

/*
 * ═══ DOCUMENTS SE PARTAGE EN LECTURE (Phase 5bis, étape d4) ═══
 * Le gestionnaire le consulte par son RÔLE (`parRole` du registre), un
 * formateur s'il est invité. L'IMPORT Konosys reste au DIRECTEUR : il remplace
 * tous les stagiaires ET supprime les comptes des absents du fichier — la règle
 * déjà tenue pour l'import e-note et le classeur du chronogramme.
 */
router.use(
  authenticate,
  requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE, ROLES.FORMATEUR),
  resolveTenant
);

const lire = exigerDroitPage('documents', 'consulter');

const filtresSchema = z.object({
  niveau: z.string().trim().max(60).optional(),
  annee: z.string().trim().max(60).optional(),
  filiere: z.string().trim().max(120).optional(),
  groupe: z.string().trim().max(60).optional(),
  recherche: z.string().trim().max(120).optional(),
});

router.get('/', lire, validate({ query: filtresSchema }), async (req, res, next) => {
  try {
    const stagiaires = await service.lister(req.etablissementId, req.anneeScolaire, req.validatedQuery);
    res.json({ success: true, stagiaires });
  } catch (error) {
    next(error);
  }
});

/** Effectifs par filière et par groupe — ce que les cartes affichent. */
router.get('/statistiques', lire, async (req, res, next) => {
  try {
    res.json({
      success: true,
      ...(await service.statistiques(req.etablissementId, req.anneeScolaire)),
    });
  } catch (error) {
    next(error);
  }
});

/** Valeurs des listes déroulantes en cascade. ← populateLevelFilter de canvas.html */
router.get('/filtres', lire, validate({ query: filtresSchema }), async (req, res, next) => {
  try {
    res.json({
      success: true,
      ...(await service.filtres(req.etablissementId, req.anneeScolaire, req.validatedQuery)),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Import Konosys — REMPLACE la base de l'année scolaire active (et elle seule).
 * ← upload.php
 *
 * Réservé au DIRECTEUR : l'opération supprime des comptes, ce n'est pas une
 * consultation.
 */
router.post(
  '/import',
  requireRole(ROLES.DIRECTEUR),
  televersement.single('fichier'),
  async (req, res, next) => {
    try {
      if (!req.file) throw badRequest('Aucun fichier reçu', { code: 'FICHIER_MANQUANT' });

      const lignes = await service.lireClasseur(req.file.buffer, req.file.originalname);
      const bilan = await service.importer(req.etablissementId, req.anneeScolaire, lignes);

      res.json({ success: true, ...bilan });
      // L'import remplace les stagiaires ET supprime des comptes : les deux pages relisent.
      annoncerModification(req, ['documents', 'sessions'], { action: 'import-konosys' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
