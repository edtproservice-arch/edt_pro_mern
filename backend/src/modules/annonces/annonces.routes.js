import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from 'shared/constants';
import { authenticate } from '../../middleware/authenticate.js';
import { agitEnDirecteur, requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { validate } from '../../middleware/validate.js';
import { IMPORTANCES } from '../../models/Annonce.js';
import * as service from './annonces.service.js';

/**
 * Annonces du bandeau passant (2026-10-10) — voir `annonces.service.js`.
 *
 * ⚠️ DEUX PORTES D'ÉCRITURE : `POST /admin` pour l'administrateur, qui n'a pas
 * d'établissement (donc pas de `resolveTenant`) et écrit au réseau ; `POST /`
 * pour le directeur et le gestionnaire, scopés à l'établissement de la requête.
 *
 * ⚠️ L'ADMINISTRATEUR EN COLLABORATION agit EN DIRECTEUR sous `/app` : il écrit
 * alors aux formateurs de l'établissement qu'il accompagne, comme le directeur.
 */
const router = Router();
router.use(authenticate);

const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const annonceSchema = z.object({
  texte: z.string().trim().min(1).max(500),
  importance: z.enum(IMPORTANCES).default('info'),
  debut: jour.optional(),
  fin: jour,
  // ⚠️ INTERNE SEULEMENT : `/app` ou `/app/…`, sans hôte ni protocole.
  lien: z
    .string()
    .trim()
    .max(160)
    .regex(/^(\/app(\/[A-Za-z0-9\-_/]*)?)?$/, 'Page interne attendue (/app/…)')
    .default(''),
  lienTitre: z.string().trim().max(80).default(''),
});

/** Le rôle sous lequel la requête agit : un admin en collaboration est directeur. */
const roleEffectif = (utilisateur) => (agitEnDirecteur(utilisateur) ? ROLES.DIRECTEUR : utilisateur.role);

router.post(
  '/admin',
  requireRole(ROLES.ADMIN),
  validate({ body: annonceSchema.extend({ etablissementIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(500).default([]) }) }),
  async (req, res, next) => {
    try {
      const resultat = await service.publier({ id: req.utilisateur.id, role: ROLES.ADMIN }, null, req.body);
      res.status(201).json({ success: true, ...resultat });
    } catch (error) {
      next(error);
    }
  }
);

/** Les établissements que l'admin peut viser (vide = tous). */
router.get('/admin/etablissements', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    res.json({ success: true, etablissements: await service.etablissementsVisables() });
  } catch (error) {
    next(error);
  }
});

/** Les formateurs (directeur) ou les groupes (gestionnaire) qu'on peut viser. */
router.get('/choix', requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE), resolveTenant, async (req, res, next) => {
  try {
    const choix = await service.choix(roleEffectif(req.utilisateur), req.etablissementId, req.anneeScolaire);
    res.json({ success: true, choix });
  } catch (error) {
    next(error);
  }
});

const liste = z.array(z.string().trim().min(1).max(150)).max(2000).default([]);

router.post(
  '/',
  requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE),
  resolveTenant,
  // Vide = tous les formateurs (directeur) ou tous les groupes (gestionnaire).
  validate({ body: annonceSchema.extend({ matricules: liste, groupes: liste }) }),
  async (req, res, next) => {
    try {
      const resultat = await service.publier(
        { id: req.utilisateur.id, role: roleEffectif(req.utilisateur) },
        req.etablissementId,
        req.body,
        req.anneeScolaire
      );
      res.status(201).json({ success: true, ...resultat });
    } catch (error) {
      next(error);
    }
  }
);

/** Mes publications — pour les relire et les retirer. */
router.get('/publiees', requireRole(ROLES.ADMIN, ROLES.DIRECTEUR, ROLES.GESTIONNAIRE), async (req, res, next) => {
  try {
    res.json({ success: true, annonces: await service.mesPublications(req.utilisateur.id) });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', requireRole(ROLES.ADMIN, ROLES.DIRECTEUR, ROLES.GESTIONNAIRE), async (req, res, next) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
      res.status(404).json({ success: false, message: 'Annonce introuvable' });
      return;
    }
    res.json({ success: true, annonce: await service.retirer(req.utilisateur.id, req.params.id) });
  } catch (error) {
    next(error);
  }
});

/** Les annonces en cours du compte connecté — celles de son bandeau. */
router.get(
  '/mes',
  requireRole(ROLES.DIRECTEUR, ROLES.FORMATEUR, ROLES.STAGIAIRE),
  resolveTenant,
  async (req, res, next) => {
    try {
      const annonces = await service.mesAnnonces(
        { id: req.utilisateur.id, role: roleEffectif(req.utilisateur), identifiant: req.utilisateur.identifiant },
        req.etablissementId,
        new Date(),
        req.anneeScolaire
      );
      res.json({ success: true, annonces });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
