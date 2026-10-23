import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from 'shared/constants';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { validate } from '../../middleware/validate.js';
import * as service from './demandesDocuments.service.js';

/**
 * Les demandes de documents des stagiaires, côté ADMINISTRATION (2026-10-23) —
 * le bloc « Demandes de documents » de l'accueil du gestionnaire. Le stagiaire,
 * lui, demande par `/consultation/demandes`.
 */
const router = Router();
router.use(authenticate, requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE), resolveTenant);

router.get('/', async (req, res, next) => {
  try {
    res.json({ success: true, demandes: await service.demandesATraiter(req.etablissementId) });
  } catch (error) {
    next(error);
  }
});

router.patch(
  '/:id',
  validate({
    params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }),
    body: z.object({
      action: z.enum(['accepter', 'rejeter', 'prete', 'remise']),
      motif: z.string().trim().max(300).default(''),
    }),
  }),
  async (req, res, next) => {
    try {
      const demande = await service.traiter(req.etablissementId, req.params.id, req.body, {
        id: req.utilisateur.id,
        nomComplet: req.utilisateur.nomComplet,
      });
      res.json({ success: true, demande });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
