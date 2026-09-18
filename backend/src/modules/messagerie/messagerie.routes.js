import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import * as service from './messagerie.service.js';

/**
 * Messagerie interne (F10).
 * ← api/messaging/*.php
 *
 * ⚠️ PAS DE `resolveTenant` ICI, et c'est délibéré. Un message appartient à DEUX
 * PERSONNES, pas à un établissement : l'admin n'en a aucun, et un directeur qui
 * bascule d'année ne doit pas voir sa boîte changer. L'isolation passe par la
 * matrice de `shared/domain`, qui compare les établissements des DEUX comptes.
 *
 * ⚠️ AUCUN `requireRole` NON PLUS : les cinq rôles ont une messagerie. C'est la
 * matrice qui dit à qui l'on peut écrire, pas la route.
 */
const router = Router();

router.use(authenticate);

const identifiant = z.string().trim().length(24);

/** Boîte de réception ou messages envoyés. */
router.get(
  '/',
  validate({
    query: z.object({
      boite: z
        .enum(['reception', 'envoyes', 'brouillons', 'archive', 'corbeille'])
        .default('reception'),
      page: z.coerce.number().int().min(1).default(1),
    }),
  }),
  async (req, res, next) => {
    try {
      const donnees = await service.lister(req.utilisateur.id, req.validatedQuery);
      res.json({ success: true, ...donnees });
    } catch (error) {
      next(error);
    }
  }
);

/*
 * ⚠️ « non-lus » et « correspondants » se déclarent AVANT `/:id`. Express retient
 * la première route qui correspond : placées après, elles seraient captées par
 * `/:id`, qui chercherait un message ainsi nommé — le piège déjà rencontré sur
 * les séances et les chronogrammes.
 */

/** Le compteur du menu, interrogé périodiquement. */
router.get('/non-lus', async (req, res, next) => {
  try {
    res.json({ success: true, nonLus: await service.compterNonLus(req.utilisateur.id) });
  } catch (error) {
    next(error);
  }
});

/** Ce que chaque boîte contient — les chiffres de la colonne de gauche. */
router.get('/boites', async (req, res, next) => {
  try {
    res.json({ success: true, boites: await service.compterBoites(req.utilisateur.id) });
  } catch (error) {
    next(error);
  }
});

/** À qui je peux écrire — la MÊME règle que le contrôle d'envoi. */
router.get('/correspondants', async (req, res, next) => {
  try {
    res.json({ success: true, correspondants: await service.correspondants(req.utilisateur.id) });
  } catch (error) {
    next(error);
  }
});

/** Ouvre un message — et le marque lu si l'on en est le destinataire. */
router.get(
  '/:id',
  validate({ params: z.object({ id: identifiant }) }),
  async (req, res, next) => {
    try {
      const message = await service.ouvrir(req.utilisateur.id, req.params.id);
      res.json({ success: true, message });
    } catch (error) {
      next(error);
    }
  }
);

/** Envoie un message à un ou plusieurs destinataires. */
router.post(
  '/',
  validate({
    body: z.object({
      destinataires: z.array(identifiant).min(1).max(200),
      sujet: z.string().trim().min(1).max(255),
      /*
       * ⚠️ AUCUN ÉCHAPPEMENT ICI. `send.php` appliquait `htmlspecialchars` à
       * l'ENTRÉE : les corps étaient stockés encodés et le restaient. React
       * échappe à l'affichage, ce qui est le bon endroit (§4.6).
       */
      corps: z.string().trim().min(1).max(20000),
      reponseA: identifiant.optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const bilan = await service.envoyer(req.utilisateur.id, req.body);
      res.json({ success: true, ...bilan });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Enregistre un brouillon — création si `id` est absent.
 *
 * ⚠️ AUCUN CHAMP N'EST EXIGÉ : c'est un travail en cours. Les contrôles
 * s'appliquent à l'ENVOI, où ils ont un sens.
 */
router.post(
  '/brouillons',
  validate({
    body: z.object({
      id: identifiant.optional(),
      destinataires: z.array(identifiant).max(200).default([]),
      sujet: z.string().trim().max(255).default(''),
      corps: z.string().trim().max(20000).default(''),
      reponseA: identifiant.optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const bilan = await service.enregistrerBrouillon(req.utilisateur.id, req.body);
      res.json({ success: true, ...bilan });
    } catch (error) {
      next(error);
    }
  }
);

/** Supprime un brouillon — définitivement, il n'a jamais été envoyé. */
router.delete(
  '/brouillons/:id',
  validate({ params: z.object({ id: identifiant }) }),
  async (req, res, next) => {
    try {
      const bilan = await service.supprimerBrouillon(req.utilisateur.id, req.params.id);
      res.json({ success: true, ...bilan });
    } catch (error) {
      next(error);
    }
  }
);

/** Archive ou désarchive — de MON côté. */
router.post(
  '/:id/archive',
  validate({ params: z.object({ id: identifiant }), body: z.object({ archive: z.boolean().default(true) }) }),
  async (req, res, next) => {
    try {
      const bilan = await service.archiver(req.utilisateur.id, req.params.id, req.body.archive);
      res.json({ success: true, ...bilan });
    } catch (error) {
      next(error);
    }
  }
);

/** Sort un message de la corbeille. */
router.post(
  '/:id/restaurer',
  validate({ params: z.object({ id: identifiant }) }),
  async (req, res, next) => {
    try {
      const bilan = await service.restaurer(req.utilisateur.id, req.params.id);
      res.json({ success: true, ...bilan });
    } catch (error) {
      next(error);
    }
  }
);

/** Remet un message reçu à l'état non lu — pour y revenir plus tard. */
router.post(
  '/:id/non-lu',
  validate({ params: z.object({ id: identifiant }) }),
  async (req, res, next) => {
    try {
      const bilan = await service.marquerNonLu(req.utilisateur.id, req.params.id);
      res.json({ success: true, ...bilan });
    } catch (error) {
      next(error);
    }
  }
);

/** Retire un message de sa propre vue. */
router.delete(
  '/:id',
  validate({ params: z.object({ id: identifiant }) }),
  async (req, res, next) => {
    try {
      const bilan = await service.supprimer(req.utilisateur.id, req.params.id);
      res.json({ success: true, ...bilan });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
