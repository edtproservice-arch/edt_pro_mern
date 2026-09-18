import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  filtreRepartitionSchema,
  importRepartitionSchema,
  ligneRepartitionSchema,
  modificationRepartitionSchema,
  suppressionFiliereSchema,
} from 'shared/schemas';
import { ROLES } from 'shared/constants';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { badRequest } from '../../lib/httpError.js';
import * as service from './repartitions.admin.service.js';

/**
 * Référentiel DRIF — écriture, réservée à l'administrateur.
 * ← api/admin/upload_repartition.php + database/supprimer_filiere_repartition.php
 *
 * ═══ ⚠️ UN ROUTEUR SÉPARÉ DE `repartitions.routes.js`, PAS UN AJOUT DEDANS ═══
 * Celui-ci monte `requireRole(DIRECTEUR, GESTIONNAIRE)` pour toute la cascade de
 * la carte — l'administrateur n'y a même pas accès. Y greffer l'écriture aurait
 * demandé d'élargir ce garde à l'admin puis de le rétrécir route par route :
 * une règle d'accès qui se lit à deux endroits est une règle qu'on finit par
 * enfreindre. Ici, un seul `requireRole(ADMIN)` couvre tout le fichier.
 */
const router = Router();

router.use(authenticate, requireRole(ROLES.ADMIN));

const identifiantMongo = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Identifiant invalide'),
});

const codeFiliere = z.object({ code: z.string().trim().min(1).max(80) });

/** Un classeur DRIF complet pèse quelques mégaoctets. */
const TAILLE_MAXIMALE = 20 * 1024 * 1024;

/**
 * Le fichier reste EN MÉMOIRE, jamais écrit sur disque — même choix que l'import
 * e-note : un fichier temporaire n'apporte qu'un répertoire à purger et une
 * fuite possible.
 */
const televersement = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAILLE_MAXIMALE, files: 1 },
  fileFilter: (req, fichier, suite) => {
    // Le type MIME du navigateur ne vaut rien : on se fie à l'extension, et le
    // lecteur refusera de toute façon un contenu qui n'est pas un classeur.
    if (!/\.xlsx?$/i.test(fichier.originalname)) {
      suite(badRequest('Format attendu : .xlsx ou .xls', { code: 'FORMAT_REFUSE' }));
      return;
    }
    suite(null, true);
  },
});

router.get('/facettes', async (req, res, next) => {
  try {
    res.json({ success: true, ...(await service.facettes()) });
  } catch (error) {
    next(error);
  }
});

/*
 * ⚠️ `/filieres` SE DÉCLARE AVANT `/:id` : Express retient la première route qui
 * correspond, et placée après elle serait captée par l'identifiant — qui la
 * refuserait pour cause de format. Le piège est déjà consigné pour
 * `/chronogrammes/par-formateur`.
 */
router.get('/filieres', validate({ query: filtreRepartitionSchema }), async (req, res, next) => {
  try {
    res.json({ success: true, filieres: await service.filieres(req.validatedQuery) });
  } catch (error) {
    next(error);
  }
});

/*
 * Les métiers de la sélection — 364 dans le référentiel, d'où une liste
 * SCOPÉE et cherchable plutôt qu'une facette servie en bloc.
 */
router.get('/metiers', validate({ query: filtreRepartitionSchema }), async (req, res, next) => {
  try {
    res.json({ success: true, metiers: await service.metiers(req.validatedQuery) });
  } catch (error) {
    next(error);
  }
});

router.get('/', validate({ query: filtreRepartitionSchema }), async (req, res, next) => {
  try {
    res.json({ success: true, ...(await service.lister(req.validatedQuery)) });
  } catch (error) {
    next(error);
  }
});

router.post('/', validate({ body: ligneRepartitionSchema }), async (req, res, next) => {
  try {
    res.status(201).json({ success: true, ligne: await service.creer(req.body) });
  } catch (error) {
    next(error);
  }
});

router.patch(
  '/:id',
  validate({ params: identifiantMongo, body: modificationRepartitionSchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, ligne: await service.modifier(req.params.id, req.body) });
    } catch (error) {
      next(error);
    }
  }
);

router.delete('/:id', validate({ params: identifiantMongo }), async (req, res, next) => {
  try {
    res.json({ success: true, ...(await service.supprimer(req.params.id)) });
  } catch (error) {
    next(error);
  }
});

/**
 * Suppression d'une filière entière, ou d'une seule de ses années.
 * ← `supprimer_filiere_repartition.php <CODE> [--annee=N] --apply`
 *
 * ⚠️ PAS DE SIMULATION CÔTÉ SERVEUR : l'écran connaît déjà le compte, il l'a
 * chargé pour l'afficher. Le script en ligne de commande simulait parce qu'il
 * n'avait aucun écran ; ici la confirmation CHIFFRE ce qui disparaît avant
 * d'appeler cette route.
 */
router.delete(
  '/filieres/:code',
  validate({ params: codeFiliere, query: suppressionFiliereSchema }),
  async (req, res, next) => {
    try {
      const resultat = await service.supprimerFiliere(
        req.params.code,
        req.validatedQuery.annee
      );
      res.json({ success: true, ...resultat });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/import',
  televersement.single('fichier'),
  validate({ body: importRepartitionSchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, ...(await service.importer(req.file, req.body)) });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
