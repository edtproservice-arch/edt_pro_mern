import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from 'shared/constants';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { validate } from '../../middleware/validate.js';
import { exigerDroitPage } from '../partages/exigerDroitPage.js';
import { annoncerModification } from '../tempsReel/annonces.js';
import * as service from './calendrier.service.js';

/**
 * Calendrier de l'année : jours fériés et vacances (F3, F13).
 * ← api/data/morocco_holidays.php, api/setup/complete_setup.php:286-289
 */
const router = Router();

/*
 * ⚠️ LA LECTURE EST OUVERTE AUX QUATRE RÔLES, L'ÉCRITURE RESTE AU DIRECTEUR ET
 * AU GESTIONNAIRE — corrigé le 2026-09-04, signalé par le porteur (403 en
 * console sur « Mon emploi du temps » d'un formateur réel).
 *
 * `router.use(requireRole(DIRECTEUR, GESTIONNAIRE))` s'appliquait à TOUT le
 * routeur : `SelecteurSemaine.jsx` — partagé entre la grille du directeur et
 * les sessions consultatives (F14) — interroge pourtant CES DEUX MÊMES routes
 * pour colorer son calendrier de choix (fériés en ambre, vacances en bleu),
 * quel que soit qui le regarde. Un formateur ou un stagiaire qui ouvre le
 * sélecteur de semaine tombait donc en 403, silencieusement : aucune erreur ne
 * s'affichait, seule la couleur du calendrier restait plate — exactement le
 * genre de défaut qu'aucun test d'intégration existant ne pouvait voir, ce
 * composant n'ayant jamais été appelé par un rôle restreint avant F14.
 *
 * Ce sont des données ÉTABLISSEMENT, non sensibles, déjà visibles en clair
 * dans la grille d'emploi du temps que ces deux rôles consultent : les leur
 * cacher n'aurait protégé personne, seulement cassé l'écran.
 *
 * ⚠️ `requireRole` RESTE AVANT `resolveTenant`, PAR ROUTE — l'ordre exact
 * d'avant ce correctif. Un admin n'a AUCUN établissement : posé après le rôle,
 * `resolveTenant` ne le voit jamais, et c'est le rôle qui répond 403. Posé
 * en tête de routeur (donc avant même la vérification du rôle), il aurait
 * répondu 400 « ETABLISSEMENT_ABSENT » à la place — une réponse plausible,
 * mais qui n'est plus celle que ce routeur donnait déjà à un compte sans
 * droit d'y accéder, et qu'un test fige explicitement.
 */
router.use(authenticate);

const LECTURE = [
  requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE, ROLES.FORMATEUR, ROLES.STAGIAIRE),
  resolveTenant,
];
/*
 * ⚠️ L'ÉCRITURE PASSE PAR LE DROIT SUR LA PAGE « calendrier » (étape d3) : un
 * invité « peut modifier » y écrit, le gestionnaire perd l'écriture par son seul
 * rôle — la règle de d2. Le rôle reste vérifié AVANT `resolveTenant` : un admin
 * garde son 403 au lieu d'un 400 « établissement absent ».
 */
const ECRITURE = [
  requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE, ROLES.FORMATEUR),
  resolveTenant,
  exigerDroitPage('calendrier', 'modifier'),
];

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const jour = z.string().regex(JOUR, 'Date attendue au format AAAA-MM-JJ');

const anneeSchema = z.object({
  annee: z.coerce.number().int().min(2000).max(2100).optional(),
});

/**
 * Jours fériés effectifs de l'année.
 *
 * Réponse potentiellement lente au tout premier appel de l'année (24 requêtes
 * vers api.aladhan.com), instantanée ensuite : le résultat est mis en cache
 * pour 30 jours.
 */
router.get('/jours-feries', LECTURE, validate({ query: anneeSchema }), async (req, res, next) => {
  try {
    const annee = req.validatedQuery.annee ?? req.anneeScolaire;
    res.json({ success: true, anneeScolaire: annee, ...(await service.joursFeries(req.etablissementId, annee)) });
  } catch (error) {
    next(error);
  }
});

router.get('/', LECTURE, async (req, res, next) => {
  try {
    res.json({ success: true, ...(await service.obtenir(req.etablissementId, req.anneeScolaire)) });
  } catch (error) {
    next(error);
  }
});

const calendrierSchema = z.object({
  // La version lue par l'écran (étape d3) — facultative, voir `lib/versionOptimiste.js`.
  version: z.number().int().min(0).optional(),

  // Accepté mais non utilisé : le calendrier suit l'établissement, dont l'année
  // est déjà résolue par `resolveTenant`. Le client l'envoie par symétrie.
  anneeScolaire: z.coerce.number().int().min(2000).max(2100).optional(),

  vacances: z
    .array(
      z
        .object({
          intitule: z.string().trim().min(1).max(100).default('Vacances'),
          debut: jour,
          fin: jour,
        })
        .strict()
    )
    .max(50)
    .default([]),

  /*
   * Les périodes NATIONALES que cet établissement met de côté, par leur NOM :
   * c'est la clé stable quand l'admin décale une période d'un jour.
   */
  vacancesEcartees: z.array(z.string().trim().min(1).max(100)).max(50).optional(),

  ajustementsFeries: z
    .array(
      z
        .object({
          libelle: z.string().trim().min(1).max(120),
          date: jour.optional(),
          supprime: z.boolean().default(false),
        })
        .strict()
        // Un ajustement sans date qui ne supprime rien ne veut rien dire : le
        // laisser passer produirait un jour férié sans date, invisible et
        // impossible à corriger depuis l'écran.
        .refine((a) => a.supprime || Boolean(a.date), {
          message: 'Un ajustement doit porter une date, ou marquer la suppression',
          path: ['date'],
        })
    )
    .max(60)
    .default([]),
});

router.put('/', ECRITURE, validate({ body: calendrierSchema }), async (req, res, next) => {
  try {
    const resultat = await service.enregistrer(req.etablissementId, {
      ...req.body,
      anneeScolaire: req.anneeScolaire,
    });
    res.json({ success: true, ...resultat });
    // Le calendrier ferme des colonnes ailleurs : grille, chronogramme, rythme régional.
    annoncerModification(req, ['calendrier', 'emploi', 'chronogramme', 'avancement'], {
      action: 'enregistrer',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
