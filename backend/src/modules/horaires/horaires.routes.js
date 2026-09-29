import { Router } from 'express';
import { horairesSeancesSchema } from 'shared/schemas';
import { ROLES } from 'shared/constants';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import * as service from './horaires.service.js';

/**
 * Les horaires des séances.
 *
 * ═══ ⚠️ DEUX ROUTEURS, DEUX DROITS ═══ La LECTURE est ouverte à tout compte connecté (chacun
 * en a besoin pour afficher ses cours) ; l'ÉCRITURE est réservée à l'administrateur.
 */
export const lecture = Router();

lecture.use(authenticate);

lecture.get('/', async (req, res, next) => {
  try {
    res.json({ success: true, ...(await service.obtenir()) });
  } catch (error) {
    next(error);
  }
});

export const ecriture = Router();

ecriture.use(authenticate, requireRole(ROLES.ADMIN));

ecriture.put('/', validate({ body: horairesSeancesSchema }), async (req, res, next) => {
  try {
    res.json({ success: true, ...(await service.enregistrer(req.body)) });
  } catch (error) {
    next(error);
  }
});
