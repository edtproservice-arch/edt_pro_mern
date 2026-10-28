import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from 'shared/constants';
import { creationDirecteurComplexeSchema } from 'shared/schemas';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { validate } from '../../middleware/validate.js';
import * as service from './complexe.service.js';

/**
 * Directeur de complexe (2026-10-27) — voir `complexe.service.js`.
 *
 *   /comptes…  le DIRECTEUR d'établissement gère les comptes de son complexe,
 *              dans le contexte de SON établissement (`resolveTenant`) ;
 *   /tableau   le DIRECTEUR DE COMPLEXE lit ses établissements autorisés.
 */
const router = Router();

const identifiantMongo = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Identifiant invalide'),
});

router.use(authenticate);

// ═══ Le tableau de bord du directeur de complexe ═══
// ⚠️ PAS DE `resolveTenant` : il porte sur TOUS ses établissements autorisés à la
// fois — et sur eux seuls, puisque ce sont les seuls de son `etablissementIds`.
router.get('/tableau', requireRole(ROLES.DIRECTEUR_COMPLEXE), async (req, res, next) => {
  try {
    res.json({ success: true, ...(await service.tableau(req.utilisateur)) });
  } catch (error) {
    next(error);
  }
});

// ═══ Étape 2 : formateurs, espaces, absences en chiffres — mêmes règles que le tableau ═══
const complexe = requireRole(ROLES.DIRECTEUR_COMPLEXE);
for (const [chemin, lire] of [
  ['/formateurs', service.formateurs],
  ['/espaces', service.espaces],
  ['/absences', service.absences],
]) {
  router.get(chemin, complexe, async (req, res, next) => {
    try {
      // `?semaine=N` : la semaine à lire pour les espaces (2026-10-27) — ignoré des autres vues.
      const semaine = Number.parseInt(req.query.semaine, 10);
      res.json({ success: true, ...(await lire(req.utilisateur, { semaine: semaine >= 1 && semaine <= 52 ? semaine : null })) });
    } catch (error) {
      next(error);
    }
  });
}

// ═══ La gestion des comptes, par le directeur d'établissement ═══
const directeur = [requireRole(ROLES.DIRECTEUR), resolveTenant];

router.get('/comptes', ...directeur, async (req, res, next) => {
  try {
    res.json({ success: true, comptes: await service.lister(req.etablissementId) });
  } catch (error) {
    next(error);
  }
});

router.post('/comptes', ...directeur, validate({ body: creationDirecteurComplexeSchema }), async (req, res, next) => {
  try {
    const compte = await service.creer(req.etablissementId, req.body, req.utilisateur, req.ip);
    res.status(201).json({ success: true, compte });
  } catch (error) {
    next(error);
  }
});

router.post('/comptes/:id/autoriser', ...directeur, validate({ params: identifiantMongo }), async (req, res, next) => {
  try {
    res.json({ success: true, compte: await service.autoriser(req.etablissementId, req.params.id, req.utilisateur, req.ip) });
  } catch (error) {
    next(error);
  }
});

router.post('/comptes/:id/retirer', ...directeur, validate({ params: identifiantMongo }), async (req, res, next) => {
  try {
    res.json({ success: true, compte: await service.retirer(req.etablissementId, req.params.id, req.utilisateur, req.ip) });
  } catch (error) {
    next(error);
  }
});

router.delete('/comptes/:id', ...directeur, validate({ params: identifiantMongo }), async (req, res, next) => {
  try {
    res.json({ success: true, ...(await service.supprimer(req.etablissementId, req.params.id, req.utilisateur, req.ip)) });
  } catch (error) {
    next(error);
  }
});

export default router;
