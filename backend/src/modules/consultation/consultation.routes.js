import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from 'shared/constants';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { forbidden } from '../../lib/httpError.js';
import * as service from './consultation.service.js';

/**
 * Sessions consultatives — formateur & stagiaire (F14).
 * ← `emploiFormateur.html`, `emploiStagiaire.html`, `avancementFormateur.html`,
 *   `avancementStagiaire.html`, `affectationFormateur.html`
 *
 * ⚠️ UN SEUL ROUTEUR POUR LES DEUX RÔLES, PAS DEUX : « mon emploi » et « mon
 * avancement » posent la MÊME question, seule change l'identité qui répond —
 * un matricule pour un formateur, une liste de groupes pour un stagiaire.
 * Séparer les routeurs aurait dupliqué la validation et le montage pour rien.
 *
 * ⚠️ `identifiant` PORTE LE MATRICULE — c'est la colonne `login` de
 * l'existant, ré-utilisée telle quelle pour retrouver « qui je suis » dans la
 * base e-note ou l'import Konosys, sans table de correspondance en plus.
 */
const router = Router();

router.use(authenticate, requireRole(ROLES.FORMATEUR, ROLES.STAGIAIRE), resolveTenant);

/**
 * ⚠️ ELLE N'ACCEPTE PAS `?role=` : le rôle vient TOUJOURS du jeton
 * (`req.utilisateur.role`), jamais d'un paramètre que le client pourrait
 * forger pour se faire passer pour l'autre rôle.
 */
function monIdentite(req) {
  const identifiant = String(req.utilisateur.identifiant ?? '').trim();
  if (identifiant === '') {
    throw forbidden('Ce compte ne porte aucun identifiant', { code: 'IDENTIFIANT_ABSENT' });
  }
  return identifiant;
}

/**
 * `?date=` — même règle que `avancement.routes.js` : une date illisible est
 * IGNORÉE plutôt que refusée, et la borne est la FIN de la journée en heure
 * locale pour inclure les séances du jour désigné.
 */
function dateObservee(req) {
  if (!req.query.date) return null;
  const brute = new Date(`${req.query.date}T23:59:59`);
  return Number.isNaN(brute.getTime()) ? null : brute;
}

router.get('/emploi/semaines', async (req, res, next) => {
  try {
    res.json({ success: true, ...(await service.semaines(req.etablissementId, req.anneeScolaire)) });
  } catch (error) {
    next(error);
  }
});

/** Les groupes du stagiaire connecté — la page en a besoin pour se titrer. */
router.get('/groupes', requireRole(ROLES.STAGIAIRE), async (req, res, next) => {
  try {
    const donnees = await service.groupesDuStagiaire(req.etablissementId, req.anneeScolaire, monIdentite(req));
    res.json({ success: true, ...donnees });
  } catch (error) {
    next(error);
  }
});

router.get(
  '/emploi/:semaine',
  validate({ params: z.object({ semaine: z.string().trim().regex(/^\d{4}-W\d{1,3}$/i) }) }),
  async (req, res, next) => {
    try {
      const identifiant = monIdentite(req);

      const grille =
        req.utilisateur.role === ROLES.FORMATEUR
          ? await service.emploiFormateur(
              req.etablissementId,
              req.anneeScolaire,
              req.params.semaine,
              identifiant
            )
          : await service.emploiStagiaire(
              req.etablissementId,
              req.anneeScolaire,
              req.params.semaine,
              (await service.groupesDuStagiaire(req.etablissementId, req.anneeScolaire, identifiant)).groupes
            );

      res.json({ success: true, ...grille });
    } catch (error) {
      next(error);
    }
  }
);

router.get('/avancement', async (req, res, next) => {
  try {
    const identifiant = monIdentite(req);
    const observation = dateObservee(req);

    const donnees =
      req.utilisateur.role === ROLES.FORMATEUR
        ? await service.avancementFormateur(req.etablissementId, req.anneeScolaire, observation, identifiant)
        : await service.avancementStagiaire(
            req.etablissementId,
            req.anneeScolaire,
            observation,
            (await service.groupesDuStagiaire(req.etablissementId, req.anneeScolaire, identifiant)).groupes
          );

    res.json({ success: true, ...donnees });
  } catch (error) {
    next(error);
  }
});

/**
 * ⚠️ STAGIAIRE SEUL, et c'est le PENDANT de `/affectations` : « qu'est-ce qu'on
 * m'enseigne » contre « qu'est-ce que j'enseigne ». Un formateur a déjà sa
 * réponse dans « Mes affectations » — lui ouvrir celle-ci lui montrerait le
 * programme de groupes auxquels il n'est pas inscrit, puisqu'il n'est inscrit
 * à aucun.
 */
router.get('/programme', requireRole(ROLES.STAGIAIRE), async (req, res, next) => {
  try {
    const identifiant = monIdentite(req);
    const { groupes } = await service.groupesDuStagiaire(req.etablissementId, req.anneeScolaire, identifiant);
    const donnees = await service.programmeStagiaire(
      req.etablissementId,
      req.anneeScolaire,
      groupes
    );
    res.json({ success: true, ...donnees });
  } catch (error) {
    next(error);
  }
});

/**
 * ⚠️ FORMATEUR SEUL : un stagiaire n'est affecté à rien, il est INSCRIT à des
 * groupes — c'est `groupesDuStagiaire` qui répond à sa question à lui.
 */
router.get('/affectations', requireRole(ROLES.FORMATEUR), async (req, res, next) => {
  try {
    const donnees = await service.affectationsFormateur(
      req.etablissementId,
      req.anneeScolaire,
      monIdentite(req)
    );
    res.json({ success: true, ...donnees });
  } catch (error) {
    next(error);
  }
});

export default router;
