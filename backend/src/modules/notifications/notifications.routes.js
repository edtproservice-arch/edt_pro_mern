import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import * as push from './push.service.js';

/**
 * Les abonnements aux notifications push (2026-11-01) — voir `push.service.js`. Chaque appareil
 * s'abonne pour la personne CONNECTÉE, jamais pour une autre : l'identité vient du jeton.
 */
const router = Router();
router.use(authenticate);

/** La clé publique VAPID : sans elle, le navigateur ne peut pas s'abonner (`null` : non configuré). */
router.get('/cle-publique', (req, res) => {
  res.json({ success: true, cle: push.cleWebPublique() });
});

const abonnementWeb = z.object({
  endpoint: z.string().url().max(1000),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

router.post(
  '/abonnements',
  validate({
    body: z.discriminatedUnion('type', [
      z.object({ type: z.literal('web'), abonnement: abonnementWeb, appareil: z.string().max(200).optional() }),
      z.object({ type: z.literal('fcm'), jeton: z.string().min(20).max(500), appareil: z.string().max(200).optional() }),
    ]),
  }),
  async (req, res, next) => {
    try {
      await push.enregistrer(req.utilisateur.id, req.body);
      res.json({ success: true });
    } catch (erreur) {
      next(erreur);
    }
  }
);

router.delete(
  '/abonnements',
  validate({ body: z.object({ cle: z.string().min(1).max(1000) }) }),
  async (req, res, next) => {
    try {
      await push.retirer(req.utilisateur.id, req.body.cle);
      res.json({ success: true });
    } catch (erreur) {
      next(erreur);
    }
  }
);

export default router;
