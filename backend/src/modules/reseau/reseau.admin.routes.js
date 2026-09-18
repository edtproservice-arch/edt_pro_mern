import { Router } from 'express';
import { z } from 'zod';
import {
  etablissementOfpptSchema,
  filtreReseauSchema,
  modificationEtablissementOfpptSchema,
  renommageComplexeSchema,
  suppressionComplexeSchema,
} from 'shared/schemas';
import { ROLES } from 'shared/constants';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import * as service from './reseau.service.js';

/**
 * Réseau OFPPT — ÉCRITURE, réservée à l'administrateur.
 *
 * ═══ ⚠️ UN ROUTEUR SÉPARÉ DE LA LECTURE ═══
 * `reseau.routes.js` ne porte AUCUN garde : l'inscription s'y sert sans être
 * connectée. Mélanger les deux aurait demandé d'ouvrir puis de refermer route
 * par route — une règle d'accès qui se lit à deux endroits est une règle qu'on
 * finit par enfreindre. C'est déjà le partage retenu pour la répartition DRIF.
 */
const router = Router();

router.use(authenticate, requireRole(ROLES.ADMIN));

const identifiantMongo = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Identifiant invalide'),
});

router.get('/resume', async (req, res, next) => {
  try {
    res.json({ success: true, ...(await service.resume()) });
  } catch (error) {
    next(error);
  }
});

/*
 * ⚠️ `/complexes` SE DÉCLARE AVANT `/:id` : Express retient la première route
 * qui correspond, et placée après elle serait captée par l'identifiant — qui la
 * refuserait pour cause de format. Le piège est déjà consigné pour
 * `/chronogrammes/par-formateur`.
 */
router.get('/complexes', validate({ query: filtreReseauSchema }), async (req, res, next) => {
  try {
    res.json({ success: true, complexes: await service.complexes(req.validatedQuery.region) });
  } catch (error) {
    next(error);
  }
});

router.patch(
  '/complexes',
  validate({ body: renommageComplexeSchema }),
  async (req, res, next) => {
    try {
      const { region, ancien, nouveau } = req.body;
      res.json({ success: true, ...(await service.renommerComplexe(region, ancien, nouveau)) });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/complexes',
  validate({ query: suppressionComplexeSchema }),
  async (req, res, next) => {
    try {
      const { region, complexe } = req.validatedQuery;
      res.json({ success: true, ...(await service.supprimerComplexe(region, complexe)) });
    } catch (error) {
      next(error);
    }
  }
);

router.get('/', validate({ query: filtreReseauSchema }), async (req, res, next) => {
  try {
    res.json({ success: true, ...(await service.lister(req.validatedQuery)) });
  } catch (error) {
    next(error);
  }
});

router.post('/', validate({ body: etablissementOfpptSchema }), async (req, res, next) => {
  try {
    res.status(201).json({ success: true, etablissement: await service.creer(req.body) });
  } catch (error) {
    next(error);
  }
});

router.patch(
  '/:id',
  validate({ params: identifiantMongo, body: modificationEtablissementOfpptSchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, etablissement: await service.modifier(req.params.id, req.body) });
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

export default router;
