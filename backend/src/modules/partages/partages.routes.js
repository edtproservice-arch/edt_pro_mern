import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from 'shared/constants';
import {
  accesGeneralSchema,
  droitMembreSchema,
  invitationSchema,
  pagePartageSchema,
  pagesMembreSchema,
} from 'shared/schemas';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import * as service from './partages.service.js';

/**
 * Partage des pages collaboratives — la boîte « Partager » de Notion
 * (Phase 5bis, étape c).
 *
 * ⚠️ `requireRole` AVANT `resolveTenant`, comme partout : un administrateur,
 * qui n'appartient à aucun établissement, doit recevoir un 403 — pas un 400
 * « établissement absent » qui laisserait croire à une donnée manquante.
 */
const router = Router();

router.use(
  authenticate,
  requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE, ROLES.FORMATEUR),
  resolveTenant
);

/**
 * Les pages partagées avec moi — pour le menu. Ouverte à tous les rôles de
 * l'établissement : chacun a le droit de savoir ce qu'on lui a partagé.
 *
 * ⚠️ DÉCLARÉE AVANT `/:page` : Express retient la première route qui
 * correspond, et `/:page` capterait « moi » pour chercher une page ainsi nommée.
 */
router.get('/moi', async (req, res, next) => {
  try {
    const pages = await service.pagesPartageesAvec(req.utilisateur, req.etablissementId, req.anneeScolaire);
    res.json({ success: true, pages });
  } catch (error) {
    next(error);
  }
});

/**
 * Répondre à une invitation, depuis le message qui la porte.
 *
 * ⚠️ OUVERTE À L'INVITÉ, PAS AU DIRECTEUR : c'est lui qui accepte. Le service
 * vérifie qu'il est bien le DESTINATAIRE du message.
 *
 * ⚠️ DÉCLARÉE AVANT `/:page` : trois segments, comme `/:page/membres/:id`, mais
 * le deuxième (« … /accepter ») ne peut pas être confondu avec « membres ».
 */
router.post(
  '/invitations/:messageId/:reponse',
  validate({
    params: z.object({
      messageId: z.string().trim().length(24),
      reponse: z.enum(['accepter', 'refuser']),
    }),
  }),
  async (req, res, next) => {
    try {
      const resultat = await service.repondreInvitation(
        req.utilisateur,
        req.params.messageId,
        req.params.reponse
      );
      res.json({ success: true, ...resultat });
    } catch (error) {
      next(error);
    }
  }
);

/* ═══ Le reste est au DIRECTEUR SEUL : il est le seul à partager. ═══ */
const directeur = requireRole(ROLES.DIRECTEUR);
const utilisateurParams = z.object({ utilisateurId: z.string().trim().length(24) });
const membreParams = pagePartageSchema.merge(utilisateurParams);

/*
 * ═══ LES PAGES D'UN INVITÉ, TOUTES À LA FOIS (2026-09-13) ═══ — « Gérer ses
 * pages » depuis sa ligne de la boîte « Partager ».
 *
 * ⚠️ DÉCLARÉES AVANT `/:page` : deux segments, comme aucune route de page, mais
 * placées après, un futur `/:page/:quelqueChose` capterait « membres ».
 */
router.get('/membres/:utilisateurId', directeur, validate({ params: utilisateurParams }), async (req, res, next) => {
  try {
    res.json({
      success: true,
      ...(await service.pagesDuMembre(req.etablissementId, req.anneeScolaire, req.params.utilisateurId)),
    });
  } catch (error) {
    next(error);
  }
});

router.put(
  '/membres/:utilisateurId',
  directeur,
  validate({ params: utilisateurParams, body: pagesMembreSchema }),
  async (req, res, next) => {
    try {
      res.json({
        success: true,
        ...(await service.reglerPagesMembre(
          req.etablissementId,
          req.anneeScolaire,
          req.utilisateur,
          req.params.utilisateurId,
          req.body.droits
        )),
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get('/:page', directeur, validate({ params: pagePartageSchema }), async (req, res, next) => {
  try {
    res.json({
      success: true,
      partage: await service.presenter(req.etablissementId, req.anneeScolaire, req.params.page),
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/:page/membres',
  directeur,
  validate({ params: pagePartageSchema, body: invitationSchema }),
  async (req, res, next) => {
    try {
      const partage = await service.inviter(
        req.etablissementId,
        req.anneeScolaire,
        req.params.page,
        req.utilisateur,
        req.body
      );
      res.json({ success: true, partage });
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/:page/membres/:utilisateurId',
  directeur,
  validate({ params: membreParams, body: droitMembreSchema }),
  async (req, res, next) => {
    try {
      const partage = await service.changerDroit(
        req.etablissementId,
        req.anneeScolaire,
        req.params.page,
        req.utilisateur,
        req.params.utilisateurId,
        req.body.droit
      );
      res.json({ success: true, partage });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/:page/membres/:utilisateurId',
  directeur,
  validate({ params: membreParams }),
  async (req, res, next) => {
    try {
      const partage = await service.retirer(
        req.etablissementId,
        req.anneeScolaire,
        req.params.page,
        req.utilisateur,
        req.params.utilisateurId
      );
      res.json({ success: true, partage });
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/:page/general',
  directeur,
  validate({ params: pagePartageSchema, body: accesGeneralSchema }),
  async (req, res, next) => {
    try {
      const partage = await service.changerAccesGeneral(
        req.etablissementId,
        req.anneeScolaire,
        req.params.page,
        req.utilisateur,
        req.body
      );
      res.json({ success: true, partage });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
