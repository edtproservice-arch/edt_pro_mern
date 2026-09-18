import { Router } from 'express';
import { z } from 'zod';
import {
  activationCompteSchema,
  candidatsSchema,
  creationCompteSchema,
  creationLotSchema,
  listeComptesSchema,
  suppressionLotSchema,
} from 'shared/schemas';
import { ROLES } from 'shared/constants';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { exigerDroitPage } from '../partages/exigerDroitPage.js';
import { annoncerModification } from '../tempsReel/annonces.js';
import * as service from './comptes.service.js';

/**
 * Comptes formateurs / stagiaires / gestionnaires (F12).
 *
 * La chaîne `authenticate → requireRole → resolveTenant` est posée UNE FOIS
 * pour tout le module. Les huit fichiers PHP d'origine la réécrivaient chacun,
 * avec des variantes — et l'un d'eux oubliait le contrôle d'établissement.
 */
const router = Router();

/*
 * ═══ SESSIONS SE PARTAGE EN LECTURE SEULE (Phase 5bis, étape d4) ═══
 * Décision du porteur : « modifier » permettrait de réinitialiser le mot de
 * passe d'un collègue — et, pour un compte sans vraie adresse, de le LIRE à
 * l'écran. Une prise de compte. Un invité LIT donc les listes (comptes,
 * candidats) ; toute écriture reste au DIRECTEUR, par son rôle — voir plus bas.
 *
 * ⚠️ LE RÔLE RESTE FILTRÉ AVANT `resolveTenant` : un administrateur n'a pas
 * d'établissement, un stagiaire n'est jamais invité — ils gardent leur 403.
 */
router.use(
  authenticate,
  requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE, ROLES.FORMATEUR),
  resolveTenant
);

const lire = exigerDroitPage('sessions', 'consulter');

const identifiantMongo = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Identifiant invalide'),
});

router.get('/', lire, validate({ query: listeComptesSchema }), async (req, res, next) => {
  try {
    res.json({ success: true, ...(await service.lister(req.etablissementId, req.validatedQuery)) });
  } catch (error) {
    next(error);
  }
});

/**
 * Personnes de la base pouvant recevoir un compte.
 * ← get_formateurs.php + get_stagiaires.php
 */
router.get('/candidats', lire, validate({ query: candidatsSchema }), async (req, res, next) => {
  try {
    const personnes = await service.candidats(
      req.etablissementId,
      req.anneeScolaire,
      req.validatedQuery.role
    );

    /*
     * ⚠️ L'ANNÉE EST RENVOYÉE AVEC LA LISTE.
     *
     * La base est rangée par `(établissement, année)` : une liste vide veut
     * presque toujours dire « pas de base POUR CETTE ANNÉE-LÀ », et non « aucun
     * formateur ». Sans ce champ, l'écran ne peut qu'affirmer « aucun formateur
     * dans la base » — une phrase fausse qui envoie chercher au mauvais endroit.
     */
    res.json({ success: true, personnes, anneeScolaire: req.anneeScolaire });
  } catch (error) {
    next(error);
  }
});

/*
 * ═══ ⚠️ À PARTIR D'ICI, TOUT ÉCRIT : AU DIRECTEUR SEUL ═══
 * Posé en `router.use` APRÈS les deux lectures : Express parcourt la pile dans
 * l'ordre, et une lecture a déjà répondu avant d'y arriver. Un seul point de
 * contrôle pour les six écritures — les poser une à une, c'était le risque d'en
 * oublier une, et celle-là aurait ouvert la réinitialisation d'un mot de passe.
 *
 * Toute écriture réussie prévient la salle « sessions » : la liste d'un invité
 * suit ce que le directeur crée, désactive ou supprime.
 */
router.use(requireRole(ROLES.DIRECTEUR), (req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode < 300) annoncerModification(req, 'sessions', { action: 'comptes' });
  });
  next();
});

/**
 * Création EN MASSE depuis la base.
 * ← create_user_account.php:58-135
 *
 * Répond 200 et non 201 : l'opération est partielle par nature — des comptes
 * créés, d'autres ignorés parce qu'ils existaient déjà. Un 201 laisserait croire
 * que tout le lot a été créé.
 */
router.post('/lot', validate({ body: creationLotSchema }), async (req, res, next) => {
  try {
    const bilan = await service.creerEnLot(req.etablissementId, req.anneeScolaire, req.body);
    res.json({ success: true, ...bilan });
  } catch (error) {
    next(error);
  }
});

router.post('/', validate({ body: creationCompteSchema }), async (req, res, next) => {
  try {
    const compte = await service.creer(req.etablissementId, req.body);
    res.status(201).json({ success: true, compte });
  } catch (error) {
    next(error);
  }
});

router.patch(
  '/:id/activation',
  validate({ params: identifiantMongo, body: activationCompteSchema }),
  async (req, res, next) => {
    try {
      const compte = await service.definirActivation(
        req.etablissementId,
        req.params.id,
        req.body.actif
      );
      res.json({ success: true, compte });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/:id/mot-de-passe',
  validate({ params: identifiantMongo }),
  async (req, res, next) => {
    try {
      // `motDePasse` n'est présent que pour les comptes sans adresse réelle —
      // le service décide, la route se contente de relayer.
      res.json({ success: true, ...(await service.reinitialiserMotDePasse(req.etablissementId, req.params.id)) });
    } catch (error) {
      next(error);
    }
  }
);

router.delete('/:id', validate({ params: identifiantMongo }), async (req, res, next) => {
  try {
    await service.supprimer(req.etablissementId, req.params.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/** Suppression en lot — par identifiants, ou par rôle entier. */
router.post('/suppression-lot', validate({ body: suppressionLotSchema }), async (req, res, next) => {
  try {
    const resultat = await service.supprimerEnLot(req.etablissementId, req.body, req.utilisateur);
    res.json({ success: true, ...resultat });
  } catch (error) {
    next(error);
  }
});

export default router;
