import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { limiteurDemo } from '../../middleware/rateLimit.js';
import { poserCookies } from '../auth/tokens.js';
import { connecterDemo } from '../auth/auth.service.js';
import { ROLES_DEMO, creerBacASable } from './demo.service.js';

/**
 * « Essayer la démo » (2026-11-01) — depuis la page d'accueil, sans compte : crée le bac à
 * sable du visiteur (`demo.service`) et l'y connecte avec le rôle choisi. Limité par adresse :
 * chaque appel copie un établissement entier.
 */
const router = Router();

const APPAREIL_DEMO = { nom: 'Démo', navigateur: 'inconnu', os: 'inconnu' };

router.post(
  '/',
  limiteurDemo,
  validate({ body: z.object({ role: z.enum(ROLES_DEMO), appareil: z.any().optional() }) }),
  async (req, res, next) => {
    try {
      const compte = await creerBacASable({ role: req.body.role });
      const session = await connecterDemo(compte, req.body?.appareil ?? APPAREIL_DEMO, req.ip);
      poserCookies(res, session.accessToken, session.refreshToken);
      return res.status(201).json({ success: true, action: 'connecte', utilisateur: session.utilisateur });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
