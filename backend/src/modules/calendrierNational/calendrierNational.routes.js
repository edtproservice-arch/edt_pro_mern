import { Router } from 'express';
import {
  anneeCalendrierSchema,
  calendrierNationalSchema,
} from 'shared/schemas';
import { ROLES } from 'shared/constants';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import * as service from './calendrierNational.service.js';
import { joursFeriesNationaux } from '../calendrier/calendrier.service.js';

/**
 * Calendrier national — vacances du réseau et dates de rentrée.
 *
 * ═══ ⚠️ DEUX ROUTEURS, DEUX DROITS ═══
 * La LECTURE est ouverte à tout compte connecté : un directeur en a besoin, son
 * calendrier s'en alimente. L'ÉCRITURE est réservée à l'administrateur — une
 * correction faite par un établissement s'appliquerait aux dix autres.
 */
export const lecture = Router();

lecture.use(authenticate);

/*
 * ⚠️ LA PLUS SPÉCIFIQUE D'ABORD. Express retient la première route qui
 * correspond : déclarée après `/:annee`, celle-ci ne serait jamais atteinte —
 * le piège déjà consigné pour `/chronogrammes/par-formateur`.
 *
 * ⚠️ ET ELLE EST OUVERTE À TOUT COMPTE CONNECTÉ, comme le reste de ce routeur :
 * ce sont les fériés du pays, pas la donnée d'un établissement. C'est justement
 * ce que la route `/calendrier/jours-feries` ne pouvait pas servir — elle exige
 * un établissement, et un administrateur n'en a aucun.
 */
lecture.get(
  '/:annee/jours-feries',
  validate({ params: anneeCalendrierSchema }),
  async (req, res, next) => {
    try {
      res.json({
        success: true,
        anneeScolaire: req.params.annee,
        ...(await joursFeriesNationaux(req.params.annee)),
      });
    } catch (error) {
      next(error);
    }
  }
);

lecture.get('/:annee', validate({ params: anneeCalendrierSchema }), async (req, res, next) => {
  try {
    res.json({ success: true, ...service.presenter(await service.obtenir(req.params.annee)) });
  } catch (error) {
    next(error);
  }
});

export const ecriture = Router();

ecriture.use(authenticate, requireRole(ROLES.ADMIN));

ecriture.put(
  '/:annee',
  validate({ params: anneeCalendrierSchema, body: calendrierNationalSchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, ...(await service.enregistrer(req.params.annee, req.body)) });
    } catch (error) {
      next(error);
    }
  }
);

/* L'admin lit aussi : sa page affiche ce qu'il vient d'écrire. */
ecriture.get('/:annee', validate({ params: anneeCalendrierSchema }), async (req, res, next) => {
  try {
    res.json({ success: true, ...service.presenter(await service.obtenir(req.params.annee)) });
  } catch (error) {
    next(error);
  }
});
