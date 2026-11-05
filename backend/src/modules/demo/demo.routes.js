import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { limiteurDemo } from '../../middleware/rateLimit.js';
import { chargerSession } from '../../middleware/authenticate.js';
import { conflict } from '../../lib/httpError.js';
import { RefreshToken } from '../../models/RefreshToken.js';
import { User } from '../../models/User.js';
import { empreinte, lireAccessToken, lireRefreshToken, poserCookies } from '../auth/tokens.js';
import { connecterDemo } from '../auth/auth.service.js';
import { ROLES_DEMO, compteDuMemeBac, creerBacASable } from './demo.service.js';

/**
 * « Essayer la démo » (2026-11-01) — depuis la page d'accueil, sans compte : crée le bac à
 * sable du visiteur (`demo.service`) et l'y connecte avec le rôle choisi. Limité par adresse :
 * chaque appel copie un établissement entier.
 */
const router = Router();

const APPAREIL_DEMO = { nom: 'Démo', navigateur: 'inconnu', os: 'inconnu' };

/**
 * ═══ LA DÉMO N'ÉCRASE JAMAIS UNE VRAIE SESSION (2026-11-05) ═══ Signalé par le porteur : « des
 * directeurs accèdent à edtpro.tech, ça les dirige vers le compte démo ». La démo se lançait
 * d'elle-même sur l'accueil, avant que la page sache le directeur connecté, et ses cookies
 * remplaçaient les siens. Un navigateur où un compte RÉEL est ouvert — jeton d'accès valide, ou
 * jeton de rafraîchissement encore valable (accès expiré) — ne reçoit donc pas de démo : 409.
 */
async function compteReelOuvert(req) {
  try {
    const { utilisateur } = await chargerSession(lireAccessToken(req));
    if (!utilisateur.demo) return true;
  } catch {
    // Pas de jeton d'accès valide : on regarde le jeton de rafraîchissement.
  }
  const jeton = lireRefreshToken(req);
  if (!jeton) return false;
  const enregistrement = await RefreshToken.findOne({ empreinte: empreinte(jeton) });
  if (!enregistrement?.estValide()) return false;
  const utilisateur = await User.findById(enregistrement.utilisateurId).select('demo estActif').lean();
  return Boolean(utilisateur?.estActif && !utilisateur.demo);
}

async function refuserSiCompteReel(req, res, next) {
  try {
    if (await compteReelOuvert(req)) {
      return next(conflict('Vous êtes déjà connecté à votre compte : déconnectez-vous pour essayer la démo.', { code: 'SESSION_REELLE' }));
    }
    return next();
  } catch (erreur) {
    return next(erreur);
  }
}

/**
 * Déjà en démo ? On change de COMPTE dans la même copie, sans en créer une nouvelle — et donc
 * AVANT la limite par adresse, qui ne compte que les copies créées (voir `compteDuMemeBac`).
 * Sans session de démo valide, on passe la main à la création.
 */
async function changerDeRoleDansLaCopie(req, res, next) {
  try {
    const { utilisateur } = await chargerSession(lireAccessToken(req));
    const compte = await compteDuMemeBac(utilisateur, req.body?.role);
    if (!compte) return next();
    const session = await connecterDemo(compte, req.body?.appareil ?? APPAREIL_DEMO, req.ip);
    poserCookies(res, session.accessToken, session.refreshToken);
    return res.status(200).json({ success: true, action: 'connecte', utilisateur: session.utilisateur });
  } catch {
    return next(); // pas de session, ou expirée : une nouvelle copie
  }
}

router.post(
  '/',
  refuserSiCompteReel,
  changerDeRoleDansLaCopie,
  limiteurDemo,
  validate({ body: z.object({ role: z.enum(ROLES_DEMO), appareil: z.any().optional() }) }),
  async (req, res, next) => {
    try {
      const compte = await creerBacASable({ role: req.body.role });
      const session = await connecterDemo(compte, req.body?.appareil ?? APPAREIL_DEMO, req.ip);
      poserCookies(res, session.accessToken, session.refreshToken);
      return res.status(201).json({ success: true, action: 'connecte', utilisateur: session.utilisateur });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
