import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { exigerDroitPage } from '../partages/exigerDroitPage.js';
import * as service from './formateursMutualises.service.js';

/**
 * Formateurs mutualisés — ceux qui sont affectés dans plusieurs établissements.
 * (demande du porteur, 2026-09-21.) Lecture seule : rien ne se déclare, tout se déduit des bases.
 *
 * ⚠️ PAR LE DROIT SUR LA PAGE « FORMATEURS » : un invité qui peut consulter la page voit aussi
 * avec qui ses formateurs sont partagés.
 */
const router = Router();

router.use(authenticate, resolveTenant);

router.get('/', exigerDroitPage('formateurs', 'consulter'), async (req, res, next) => {
  try {
    res.json({
      success: true,
      formateurs: await service.formateursMutualises(req.etablissement, req.anneeScolaire),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
