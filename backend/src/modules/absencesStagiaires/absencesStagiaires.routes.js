import { Router } from 'express';
import { z } from 'zod';
import { ROLES, SEANCES } from 'shared/constants';
import { appelStagiairesSchema, indisciplineSchema, justificationAbsenceSchema } from 'shared/schemas';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { validate } from '../../middleware/validate.js';
import { annoncerModification } from '../tempsReel/annonces.js';
import * as appelService from './absencesStagiaires.service.js';
import * as discipline from './discipline.service.js';

/**
 * Absences, retards et indisciplines des stagiaires — la note de discipline (F9).
 *
 * ═══ QUI FAIT QUOI (décision du porteur, 2026-09-14) ═══
 *   - l'APPEL (lire, marquer) : directeur, gestionnaire, et chaque FORMATEUR
 *     pour ses propres séances — le service le restreint ;
 *   - la JUSTIFICATION, les NOTES et les INDISCIPLINES : directeur et
 *     gestionnaire (le surveillant général). La grille réserve les sanctions au
 *     SG, au directeur et au Conseil de discipline : un formateur signale,
 *     il ne sanctionne pas.
 *
 * ⚠️ PAR RÔLE, PAS PAR DROIT DE PAGE : la page « Absences » ne se partage plus
 * (2026-09-14), et le gestionnaire n'y a accès QUE pour ses stagiaires — pas pour
 * le registre des formateurs, qui reste gardé par `exigerDroitPage('absences')`.
 */
const router = Router();

router.use(
  authenticate,
  requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE, ROLES.FORMATEUR),
  resolveTenant
);

const ENCADREMENT = requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE);

const acteur = (req) => ({
  id: req.utilisateur._id,
  role: req.utilisateur.role,
  identifiant: String(req.utilisateur.identifiant ?? '').trim(),
});

const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const identifiant = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/, 'Identifiant invalide') });

/** Toute écriture de cette page date et prévient la salle « absences ». */
const annoncer = (req, action) => annoncerModification(req, 'absences', { action });

const route = (gestionnaire) => async (req, res, next) => {
  try {
    await gestionnaire(req, res);
  } catch (erreur) {
    next(erreur);
  }
};

router.get(
  '/groupes',
  ENCADREMENT,
  route(async (req, res) => {
    res.json({ groupes: await discipline.groupes(req.etablissementId, req.anneeScolaire) });
  })
);

router.get(
  '/seances',
  validate({ query: z.object({ date: jour, groupe: z.string().trim().max(200).optional() }) }),
  route(async (req, res) => {
    res.json(
      await appelService.seancesDuJour(req.etablissementId, req.anneeScolaire, req.query, acteur(req))
    );
  })
);

router.get(
  '/appel',
  validate({
    query: z.object({
      date: jour,
      seance: z.enum(SEANCES),
      periode: z.enum(['jour', 'soir']).default('jour'),
      groupe: z.string().trim().min(1).max(200),
    }),
  }),
  route(async (req, res) => {
    res.json(await appelService.appel(req.etablissementId, req.anneeScolaire, req.query, acteur(req)));
  })
);

router.put(
  '/appel',
  validate({ body: appelStagiairesSchema }),
  route(async (req, res) => {
    res.json(
      await appelService.enregistrerAppel(req.etablissementId, req.anneeScolaire, req.body, acteur(req))
    );
    annoncer(req, 'appel');
  })
);

router.get(
  '/notes',
  ENCADREMENT,
  validate({ query: z.object({ groupe: z.string().trim().min(1).max(200) }) }),
  route(async (req, res) => {
    res.json(await discipline.notes(req.etablissementId, req.anneeScolaire, req.query.groupe));
  })
);

router.get(
  '/stagiaires/:matricule',
  ENCADREMENT,
  validate({ params: z.object({ matricule: z.string().trim().min(1).max(50) }) }),
  route(async (req, res) => {
    res.json(await discipline.fiche(req.etablissementId, req.anneeScolaire, req.params.matricule));
  })
);

router.post(
  '/indisciplines',
  ENCADREMENT,
  validate({ body: indisciplineSchema }),
  route(async (req, res) => {
    res
      .status(201)
      .json(
        await discipline.ajouterIndiscipline(req.etablissementId, req.anneeScolaire, req.body, req.utilisateur._id)
      );
    annoncer(req, 'indiscipline');
  })
);

router.delete(
  '/indisciplines/:id',
  ENCADREMENT,
  validate({ params: identifiant }),
  route(async (req, res) => {
    await discipline.supprimerIndiscipline(req.etablissementId, req.anneeScolaire, req.params.id);
    res.json({ success: true });
    annoncer(req, 'indiscipline');
  })
);

router.get(
  '/',
  validate({
    query: z.object({
      groupe: z.string().trim().max(200).optional(),
      matricule: z.string().trim().max(50).optional(),
    }),
  }),
  route(async (req, res) => {
    res.json(await appelService.lister(req.etablissementId, req.anneeScolaire, req.query, acteur(req)));
  })
);

router.patch(
  '/:id',
  ENCADREMENT,
  validate({ params: identifiant, body: justificationAbsenceSchema }),
  route(async (req, res) => {
    res.json(await appelService.justifier(req.etablissementId, req.anneeScolaire, req.params.id, req.body));
    annoncer(req, 'justification');
  })
);

router.delete(
  '/:id',
  ENCADREMENT,
  validate({ params: identifiant }),
  route(async (req, res) => {
    await appelService.supprimer(req.etablissementId, req.anneeScolaire, req.params.id);
    res.json({ success: true });
    annoncer(req, 'absence');
  })
);

export default router;
