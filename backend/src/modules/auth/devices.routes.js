import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { lireRefreshToken } from './tokens.js';
import * as service from './auth.service.js';

/**
 * Appareils connectés — consultation et révocation.
 * ← api/profile/sessions.php, revoke_session.php, revoke_all_sessions.php
 */
const router = Router();

const identifiantMongo = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Identifiant invalide'),
});

router.get('/', authenticate, async (req, res, next) => {
  try {
    const appareils = await service.listerAppareils(req.utilisateur.id, lireRefreshToken(req));
    res.json({ success: true, appareils });
  } catch (error) {
    next(error);
  }
});

/**
 * Ferme toutes les autres sessions.
 * ← api/profile/revoke_all_sessions.php
 *
 * Déclarée avant `/:id` : dès qu'un chemin paramétré voisine un chemin fixe,
 * l'ordre de déclaration est ce qui décide.
 */
router.delete('/', authenticate, async (req, res, next) => {
  try {
    const resultat = await service.revoquerAutresAppareils(
      req.utilisateur.id,
      lireRefreshToken(req)
    );
    res.json({ success: true, ...resultat });
  } catch (error) {
    next(error);
  }
});

router.delete(
  '/:id',
  authenticate,
  validate({ params: identifiantMongo }),
  async (req, res, next) => {
    try {
      await service.revoquerAppareil(req.utilisateur.id, req.params.id);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
