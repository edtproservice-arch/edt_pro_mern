import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from 'shared/constants';
import { actionPropositionSchema, propositionSchema } from 'shared/schemas';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { annoncerModification } from '../tempsReel/annonces.js';
import * as formateur from './propositions.service.js';
import * as directeur from './application.service.js';

/**
 * Propositions d'emploi du temps (F10, Phase 9 b).
 * ← api/messaging/apply_proposition.php, get_proposals_conflicts.php, et la
 *   grille de proposition de inbox.html
 *
 * ⚠️ CONTRAIREMENT À LA MESSAGERIE, CE ROUTEUR RÉSOUT L'ÉTABLISSEMENT : une
 * proposition écrit dans les séances d'UN établissement et d'UNE année.
 *
 * ⚠️ LE FORMATEUR PROPOSE, LE DIRECTEUR SEUL APPLIQUE (décision du 2026-09-23).
 * Un invité « peut modifier » de l'emploi du temps n'applique pas : il modifie
 * déjà la grille directement, et la proposition est adressée au directeur.
 */
const router = Router();

router.use(authenticate, requireRole(ROLES.FORMATEUR, ROLES.DIRECTEUR), resolveTenant);

const formateurSeul = requireRole(ROLES.FORMATEUR);
const directeurSeul = requireRole(ROLES.DIRECTEUR);

/** Pages qui relisent quand une proposition écrit dans les séances. */
const PAGES_DES_SEANCES = ['emploi', 'absences', 'avancement', 'efm'];

const identifiant = z.object({ id: z.string().trim().length(24) });

/** Ce qu'il faut pour composer : semaine, emploi actuel, cases réservées, options. */
router.get('/nouvelle', formateurSeul, async (req, res, next) => {
  try {
    const donnees = await formateur.preparer(req.etablissementId, req.anneeScolaire, req.utilisateur);
    res.json({ success: true, ...donnees });
  } catch (error) {
    next(error);
  }
});

/** Envoie la proposition de la semaine suivante au directeur. */
router.post('/', formateurSeul, validate({ body: propositionSchema }), async (req, res, next) => {
  try {
    const resultat = await formateur.soumettre(req.etablissementId, req.anneeScolaire, req.utilisateur, req.body);
    res.status(201).json({ success: true, ...resultat });
  } catch (error) {
    next(error);
  }
});

/*
 * Les trois gestes du directeur. `annoncerModification` fait relire les grilles
 * ouvertes : une proposition appliquée ou retirée change la semaine sous leurs yeux.
 */
const geste = (action, { ecrit }) => [
  directeurSeul,
  // Corps facultatif : sans `jour`, le geste vise toute la semaine.
  validate({ params: identifiant, body: actionPropositionSchema.default({}) }),
  async (req, res, next) => {
    try {
      const resultat = await action(req.etablissementId, req.utilisateur.id, req.params.id, req.body);
      res.json({ success: true, ...resultat });
      if (ecrit) {
        annoncerModification(req, PAGES_DES_SEANCES, { action: 'proposition', semaine: resultat.semaine });
      }
    } catch (error) {
      next(error);
    }
  },
];

router.post('/:id/appliquer', ...geste(directeur.appliquer, { ecrit: true }));
router.post('/:id/retirer', ...geste(directeur.retirer, { ecrit: true }));
router.post('/:id/refuser', ...geste(directeur.refuser, { ecrit: false }));

export default router;
