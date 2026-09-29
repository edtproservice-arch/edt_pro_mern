import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { validate } from '../../middleware/validate.js';
import { exigerDroitPage } from '../partages/exigerDroitPage.js';
import { annoncerModification } from '../tempsReel/annonces.js';
import * as service from './espaces.service.js';

/**
 * Espaces mutualisés — partager une salle avec un autre établissement.
 * (demande du porteur, 2026-09-21.)
 *
 * ⚠️ LA LECTURE COMME L'ÉCRITURE PASSENT PAR LE DROIT SUR LA PAGE « ESPACES » : c'est la même
 * page, et un invité « peut consulter » voit les partages sans pouvoir les changer.
 */
const router = Router();

router.use(authenticate, resolveTenant);

/** Ce que je prête, et ce qu'on me prête. */
router.get('/', exigerDroitPage('espaces', 'consulter'), async (req, res, next) => {
  try {
    res.json({ success: true, ...(await service.etat(req.etablissement)) });
  } catch (error) {
    next(error);
  }
});

/** Les établissements avec lesquels on peut partager (le complexe, ou une recherche). */
router.get(
  '/annuaire',
  exigerDroitPage('espaces', 'modifier'),
  validate({ query: z.object({ recherche: z.string().trim().max(80).optional() }) }),
  async (req, res, next) => {
    try {
      res.json({
        success: true,
        etablissements: await service.annuaire(req.etablissement, req.utilisateur, req.validatedQuery?.recherche),
      });
    } catch (error) {
      next(error);
    }
  }
);

const partageSchema = z.object({
  espace: z.string().trim().min(1).max(60),
  // Vide : on arrête de partager cet espace.
  etablissementIds: z.array(z.string().regex(/^[a-f\d]{24}$/i, 'Identifiant invalide')).max(50),
});

router.put(
  '/',
  exigerDroitPage('espaces', 'modifier'),
  validate({ body: partageSchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, ...(await service.partager(req.etablissement, req.body)) });
      annoncerModification(req, ['espaces', 'emploi'], { action: 'mutualiser' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
