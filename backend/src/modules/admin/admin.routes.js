import { Router } from 'express';
import { z } from 'zod';
import { changementStatutSchema, listeUtilisateursSchema } from 'shared/schemas';
import { ROLES } from 'shared/constants';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { lireRefreshToken, poserCookies } from '../auth/tokens.js';
import { deconnecter as fermerSession } from '../auth/auth.service.js';
import * as service from './admin.service.js';

/**
 * Tableau de bord administrateur (F15).
 *
 * Le contrôle de rôle est posé UNE FOIS pour tout le module, au lieu d'être
 * réécrit dans chacun des six fichiers PHP d'origine.
 */
const router = Router();

router.use(authenticate, requireRole(ROLES.ADMIN));

const identifiantMongo = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Identifiant invalide'),
});

router.get('/statistiques', async (req, res, next) => {
  try {
    res.json({ success: true, statistiques: await service.statistiques() });
  } catch (error) {
    next(error);
  }
});

/**
 * ⚠️ ELLE SE DÉCLARE AVANT `/utilisateurs/:id` — pas ici en apparence, mais la
 * règle vaut : Express retient la première route qui correspond. Celle-ci n'a
 * pas de paramètre, donc aucune ambiguïté ; la vigilance reste de mise si un
 * `/:quelquechose` venait à la précéder.
 */
router.get('/etablissements', async (req, res, next) => {
  try {
    res.json({ success: true, etablissements: await service.listerEtablissements() });
  } catch (error) {
    next(error);
  }
});

router.get('/utilisateurs', validate({ query: listeUtilisateursSchema }), async (req, res, next) => {
  try {
    res.json({ success: true, ...(await service.listerUtilisateurs(req.validatedQuery)) });
  } catch (error) {
    next(error);
  }
});

router.patch(
  '/utilisateurs/:id/statut',
  validate({ params: identifiantMongo, body: changementStatutSchema }),
  async (req, res, next) => {
    try {
      const utilisateur = await service.changerStatut(req.params.id, req.body, req.utilisateur);
      res.json({ success: true, utilisateur });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/utilisateurs/:id/mot-de-passe',
  validate({ params: identifiantMongo }),
  async (req, res, next) => {
    try {
      await service.reinitialiserMotDePasse(req.params.id);
      // Le mot de passe provisoire part par e-mail, jamais dans la réponse.
      res.json({ success: true, message: 'Nouveau mot de passe envoyé par e-mail.' });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Ouvre une session à la place d'un utilisateur (support).
 * Les cookies de l'administrateur sont REMPLACÉS par ceux de la cible ; son
 * identité voyage dans le jeton, ce qui permet le retour.
 */
router.post(
  '/utilisateurs/:id/connexion',
  validate({ params: identifiantMongo }),
  async (req, res, next) => {
    try {
      const appareil = req.body?.appareil ?? {
        nom: 'Appareil inconnu',
        navigateur: 'inconnu',
        os: 'inconnu',
        type: 'desktop',
      };

      const resultat = await service.connecterEnTantQue(
        req.params.id,
        req.utilisateur,
        appareil,
        req.ip
      );

      poserCookies(res, resultat.accessToken, resultat.refreshToken);
      res.json({ success: true, utilisateur: resultat.utilisateur });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Collaborer avec l'établissement d'un compte, en son nom (2026-09-14). Les
 * cookies de l'administrateur sont remplacés par une session du MÊME compte,
 * limitée à cet établissement ; « Quitter la collaboration » la referme.
 *
 * ⚠️ L'ANCIENNE SESSION EST FERMÉE, pas abandonnée : son refresh token resterait
 * sinon valide trente jours sans que plus aucun cookie ne le porte.
 */
router.post(
  '/utilisateurs/:id/collaboration',
  validate({ params: identifiantMongo }),
  async (req, res, next) => {
    try {
      const appareil = req.body?.appareil ?? {
        nom: 'Appareil inconnu',
        navigateur: 'inconnu',
        os: 'inconnu',
        type: 'desktop',
      };
      const resultat = await service.collaborerAvec(req.params.id, req.utilisateur, appareil, req.ip);
      await fermerSession(lireRefreshToken(req));

      poserCookies(res, resultat.accessToken, resultat.refreshToken);
      res.json({ success: true, etablissement: resultat.etablissement });
    } catch (error) {
      next(error);
    }
  }
);

router.delete('/utilisateurs/:id', validate({ params: identifiantMongo }), async (req, res, next) => {
  try {
    const resultat = await service.supprimerCompte(req.params.id, req.utilisateur, req.ip);
    res.json({ success: true, ...resultat });
  } catch (error) {
    next(error);
  }
});

export default router;
