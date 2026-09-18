import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { meteoDeLEtablissement } from './meteo.service.js';

/**
 * La météo de l'établissement — l'emblème de la salutation, sur l'accueil.
 *
 * ⚠️ NI `requireRole` NI ANNÉE SCOLAIRE : tous les rôles voient l'accueil, et le
 * temps qu'il fait ne dépend d'aucune année. `resolveTenant` n'est là que pour
 * savoir DE QUEL établissement il s'agit.
 */
const router = Router();

router.use(authenticate, resolveTenant);

router.get('/', async (req, res, next) => {
  try {
    /*
     * ⚠️ `null` EST UN ÉTAT ATTENDU, pas une erreur : lieu non reconnu, appel en
     * échec, réponse inexploitable. Répondre 502 ferait apparaître une erreur
     * dans l'écran pour un agrément dont l'absence ne se voit même pas.
     */
    res.json({ meteo: await meteoDeLEtablissement(req.etablissementId) });
  } catch (erreur) {
    next(erreur);
  }
});

export default router;
