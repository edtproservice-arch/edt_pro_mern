import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env, isProduction } from '../../config/env.js';
import { RefreshToken } from '../../models/RefreshToken.js';

/**
 * Jetons d'authentification.
 *
 * Remplace la session PHP et son contournement `X-Session-Id` (copié dans
 * 23 fichiers, et qui acceptait un identifiant de session fourni par le client
 * — fixation de session possible).
 *
 * Access token : JWT court (15 min), non révocable, porté par un cookie.
 * Refresh token : aléatoire, long, HACHÉ en base, révocable individuellement.
 */

const COOKIE_ACCESS = 'edt_access';
const COOKIE_REFRESH = 'edt_refresh';

const optionsCookie = {
  httpOnly: true,
  sameSite: env.COOKIE_SAME_SITE,
  secure: isProduction,
  domain: env.COOKIE_DOMAIN || undefined,
  path: '/',
};

/**
 * @param {string|null} impersonateurId  Administrateur agissant a la place de
 *   l'utilisateur (`imp`). Presence de cette revendication = session usurpee ;
 *   c'est elle qui permet de revenir au compte d'origine.
 */
/*
 * @param {string|null} collaborationId  ═══ (2026-09-14) ═══ L'établissement avec
 *   lequel un ADMINISTRATEUR collabore (`col`). À la différence de `imp`, il agit
 *   en SON nom : les autres le voient « Administrateur », et il n'a sur les pages
 *   que le droit d'un invité — jamais celui du directeur.
 */
export function signerAccessToken(utilisateur, impersonateurId = null, collaborationId = null) {
  return jwt.sign(
    {
      sub: utilisateur.id,
      role: utilisateur.role,
      ...(impersonateurId ? { imp: impersonateurId } : {}),
      ...(collaborationId ? { col: String(collaborationId) } : {}),
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.ACCESS_TOKEN_TTL }
  );
}

export function verifierAccessToken(jeton) {
  return jwt.verify(jeton, env.JWT_ACCESS_SECRET);
}

export function empreinte(jeton) {
  return crypto.createHash('sha256').update(jeton).digest('hex');
}

/** Crée un refresh token et enregistre l'appareil correspondant. */
export async function creerRefreshToken(utilisateur, appareil, ip, impersonateurId = null, collaborationId = null) {
  const jeton = crypto.randomBytes(48).toString('hex');

  await RefreshToken.create({
    utilisateurId: utilisateur.id,
    empreinte: empreinte(jeton),
    appareil,
    ip,
    // Conserve l'usurpation au travers des rafraichissements : sans cela, le
    // premier refresh transformerait la session usurpee en session normale, et
    // l'administrateur ne pourrait plus revenir a son compte.
    impersonateurId,
    collaborationEtablissementId: collaborationId,
    expireLe: new Date(Date.now() + dureeEnMs(env.REFRESH_TOKEN_TTL)),
  });

  return jeton;
}

export function poserCookies(res, accessToken, refreshToken) {
  res.cookie(COOKIE_ACCESS, accessToken, {
    ...optionsCookie,
    maxAge: dureeEnMs(env.ACCESS_TOKEN_TTL),
  });
  res.cookie(COOKIE_REFRESH, refreshToken, {
    ...optionsCookie,
    maxAge: dureeEnMs(env.REFRESH_TOKEN_TTL),
  });
}

export function effacerCookies(res) {
  res.clearCookie(COOKIE_ACCESS, optionsCookie);
  res.clearCookie(COOKIE_REFRESH, optionsCookie);
}

export function lireAccessToken(req) {
  return req.cookies?.[COOKIE_ACCESS] ?? null;
}

export function lireRefreshToken(req) {
  return req.cookies?.[COOKIE_REFRESH] ?? null;
}

/** « 15m », « 30d », « 3600s » → millisecondes. */
export function dureeEnMs(duree) {
  const correspondance = /^(\d+)([smhd])$/.exec(String(duree));
  if (!correspondance) throw new Error(`Durée invalide : ${duree}`);
  const [, valeur, unite] = correspondance;
  const facteurs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(valeur) * facteurs[unite];
}
