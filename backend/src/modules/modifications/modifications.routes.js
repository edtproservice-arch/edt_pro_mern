import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from 'shared/constants';
import { PAGES_COLLABORATIVES } from 'shared/domain';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { validate } from '../../middleware/validate.js';
import { exigerDroitPage } from '../partages/exigerDroitPage.js';
import * as service from './modifications.service.js';

/**
 * « Modifié il y a 3 min » — la date de la barre du haut (2026-09-13).
 *
 * ⚠️ À QUI PEUT CONSULTER LA PAGE, ET À LUI SEUL : la date et le nom de
 * l'auteur disent qu'on travaille sur une page — ce n'est pas à montrer à qui
 * ne la voit pas. La garde est donc celle de la page elle-même.
 */
const router = Router();

router.use(
  authenticate,
  requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE, ROLES.FORMATEUR),
  resolveTenant
);

const pageSchema = z.object({ page: z.enum(PAGES_COLLABORATIVES) });

/*
 * ⚠️ LE GESTIONNAIRE OUVRE « ABSENCES » PAR SON RÔLE (F9, 2026-09-14) — pour les
 * absences des stagiaires, sans droit sur la page elle-même. Sans cette
 * exception, la date de la barre du haut lui répondait 403 à chaque ouverture.
 */
const ACCES_PAR_ROLE = { absences: [ROLES.GESTIONNAIRE] };

router.get(
  '/:page',
  validate({ params: pageSchema }),
  (req, res, next) =>
    ACCES_PAR_ROLE[req.params.page]?.includes(req.utilisateur.role)
      ? next()
      : exigerDroitPage(req.params.page, 'consulter')(req, res, next),
  async (req, res, next) => {
    try {
      const modification = await service.derniere(req.etablissementId, req.anneeScolaire, req.params.page);
      res.json({ success: true, modification });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
