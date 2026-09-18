import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from 'shared/constants';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { validate } from '../../middleware/validate.js';
import * as service from './absences.service.js';
import * as rattrapage from './rattrapage.service.js';
import { JOURS, SEANCES } from 'shared/constants';
import { exigerDroitPage } from '../partages/exigerDroitPage.js';
import { annoncerModification } from '../tempsReel/annonces.js';

/**
 * Absences de formateurs et rattrapages (F8).
 * ← api/data/get_absences.php · update_rattrapage.php · save_observation.php
 */
const router = Router();

/*
 * ═══ LE DROIT SUR LA PAGE DÉCIDE, PLUS LE RÔLE (Phase 5bis, étape d2) ═══
 * Un formateur INVITÉ lit le registre et saisit observations et rattrapages ;
 * le gestionnaire aussi, s'il est invité — il n'y a plus d'accès par son seul
 * rôle, que l'écran ne lui ouvrait d'ailleurs pas depuis le 2026-09-03.
 *
 * `requireRole` reste AVANT `resolveTenant` : un administrateur reçoit un 403,
 * pas un 400 « établissement absent ».
 */
router.use(
  authenticate,
  requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE, ROLES.FORMATEUR),
  resolveTenant
);

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ')
  .nullable();

router.get(
  '/',
  exigerDroitPage('absences', 'consulter'),
  validate({
    query: z.object({
      // ⚠️ `rattrapees` arrive en CHAÎNE : une comparaison à `true` serait
      // toujours fausse, et le filtre n'aurait aucun effet visible.
      rattrapees: z.enum(['oui', 'non']).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const filtre =
        req.query.rattrapees === undefined ? {} : { rattrapees: req.query.rattrapees === 'oui' };

      res.json({
        absences: await service.lister(req.etablissementId, req.anneeScolaire, filtre),
      });
    } catch (erreur) {
      next(erreur);
    }
  }
);

router.patch(
  '/:id',
  exigerDroitPage('absences', 'modifier'),
  validate({
    params: z.object({ id: z.string().trim().length(24) }),
    body: z
      .object({
        observation: z.string().trim().max(2000).optional(),
        // La chaîne vide vaut annulation, comme dans `update_rattrapage.php`.
        dateRattrapage: dateSchema.optional(),
      })
      .refine(
        (valeurs) => valeurs.observation !== undefined || valeurs.dateRattrapage !== undefined,
        'Rien à modifier'
      ),
  }),
  async (req, res, next) => {
    try {
      res.json(
        await service.modifier(req.etablissementId, req.anneeScolaire, req.params.id, req.body)
      );
      /*
       * ⚠️ UNE DATE DE RATTRAPAGE ÉCRIT AUSSI DANS LE CHRONOGRAMME (report des
       * heures), donc dans l'avancement qui s'y rapporte : ces deux salles
       * relisent. Une simple observation ne concerne que le registre.
       */
      annoncerModification(
        req,
        req.body.dateRattrapage === undefined ? 'absences' : ['absences', 'chronogramme', 'avancement'],
        { action: 'absence' }
      );
    } catch (erreur) {
      next(erreur);
    }
  }
);

/*
 * ═══ PLACER UN RATTRAPAGE DANS LA GRILLE (2026-09-14) ═══
 * ⚠️ DEUX DROITS, PAS UN. Le geste écrit dans le registre des absences ET dans
 * l'emploi du temps : un invité qui ne peut modifier que l'un des deux ne doit
 * pas pouvoir écrire dans l'autre par ce détour. Les deux gardes s'enchaînent.
 *
 * ⚠️ LE CORPS NE PORTE QUE LE CRÉNEAU ET LA SALLE : groupe, module et formateur
 * sont relus dans l'absence par le service.
 */
const DROITS_RATTRAPAGE = [
  exigerDroitPage('absences', 'modifier'),
  exigerDroitPage('emploi', 'modifier'),
];

/*
 * Le rattrapage touche la grille, le registre, le chronogramme (report des
 * heures) et donc l'avancement : toutes ces salles relisent.
 */
const PAGES_DU_RATTRAPAGE = ['absences', 'emploi', 'chronogramme', 'avancement'];

router.post(
  '/:id/rattrapage',
  ...DROITS_RATTRAPAGE,
  validate({
    params: z.object({ id: z.string().trim().length(24) }),
    body: z
      .object({
        semaine: z.string().trim().min(1).max(20),
        jour: z.enum(JOURS),
        seance: z.enum(SEANCES),
        salle: z.string().trim().min(1).max(60),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      res.json(await rattrapage.placer(req.etablissementId, req.anneeScolaire, req.params.id, req.body));
      annoncerModification(req, PAGES_DU_RATTRAPAGE, { action: 'rattrapage' });
    } catch (erreur) {
      next(erreur);
    }
  }
);

router.delete(
  '/:id/rattrapage',
  ...DROITS_RATTRAPAGE,
  validate({ params: z.object({ id: z.string().trim().length(24) }) }),
  async (req, res, next) => {
    try {
      res.json(await rattrapage.annuler(req.etablissementId, req.anneeScolaire, req.params.id));
      annoncerModification(req, PAGES_DU_RATTRAPAGE, { action: 'rattrapage' });
    } catch (erreur) {
      next(erreur);
    }
  }
);

export default router;
