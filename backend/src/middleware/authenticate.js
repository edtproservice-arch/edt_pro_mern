import { User } from '../models/User.js';
import { unauthorized } from '../lib/httpError.js';
import { lireAccessToken, verifierAccessToken } from '../modules/auth/tokens.js';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

/**
 * Vérifie un access token et charge le compte qu'il désigne.
 *
 * ⚠️ EXTRAITE DU MIDDLEWARE (2026-09-12) pour que la collaboration en temps
 * réel l'appelle AUSSI : une socket s'authentifie à sa poignée de main, hors
 * d'Express. Recopier ces contrôles dans le serveur WebSocket en aurait fait
 * deux exemplaires — et le jour où l'un des deux gagne une règle (un statut de
 * compte de plus), l'autre laisserait entrer ce que le premier refuse.
 *
 * @returns {{ utilisateur, impersonateur: object|null, charge: object }}
 *   `charge` est la charge utile du JWT — son `exp` sert à fermer une socket à
 *   l'instant où le jeton expire.
 * @throws {HttpError} 401 avec un `code` explicite.
 */
export async function chargerSession(jeton) {
  if (!jeton) throw unauthorized('Authentification requise', { code: 'NON_AUTHENTIFIE' });

  let charge;
  try {
    charge = verifierAccessToken(jeton);
  } catch {
    // Jeton absent, malformé ou expiré : au client d'appeler /rafraichir.
    throw unauthorized('Session expirée', { code: 'JETON_EXPIRE' });
  }

  const utilisateur = await User.findById(charge.sub);
  if (!utilisateur) throw unauthorized('Compte introuvable', { code: 'NON_AUTHENTIFIE' });

  // Un compte désactivé ou bloqué APRÈS l'émission du jeton doit être rejeté
  // immédiatement : sans ce contrôle, il resterait actif jusqu'à expiration.
  if (!utilisateur.estActif) {
    throw unauthorized('Compte désactivé', { code: 'COMPTE_DESACTIVE' });
  }
  if (utilisateur.statut === STATUTS_COMPTE.BLOQUE) {
    throw unauthorized('Compte bloqué', { code: 'COMPTE_BLOQUE' });
  }

  // Session usurpée : un administrateur agit à la place de cet utilisateur.
  // On charge l'usurpateur pour que les écrans puissent l'afficher et que
  // l'audit sache qui agit réellement.
  const impersonateur = charge.imp ? await User.findById(charge.imp) : null;

  /*
   * ═══ COLLABORATION (2026-09-14) ═══ Un administrateur qui travaille AVEC un
   * établissement, en son nom : `col` porte l'établissement. Il est posé dans
   * `$locals` — des données du document que Mongoose n'écrit JAMAIS en base.
   * Le glisser dans `etablissementIds` l'aurait fait enregistrer au premier
   * `save()` du compte : l'admin serait devenu membre de l'établissement.
   *
   * ⚠️ UN ADMINISTRATEUR SEULEMENT : un jeton d'un autre rôle portant `col` est
   * un jeton forgé ou périmé — il est refusé, jamais ignoré.
   */
  if (charge.col) {
    if (utilisateur.role !== ROLES.ADMIN) {
      throw unauthorized('Session invalide', { code: 'NON_AUTHENTIFIE' });
    }
    utilisateur.$locals.collaboration = String(charge.col);
  }

  return { utilisateur, impersonateur, charge };
}

/** L'établissement avec lequel cet administrateur collabore, ou `null`. */
export const collaborationDe = (utilisateur) => utilisateur?.$locals?.collaboration ?? null;

/**
 * Vérifie l'access token et renseigne `req.utilisateur`.
 *
 * ⚠️ C'est LE point unique d'authentification de l'API. Il remplace les
 * 44 `session_start()` disséminés dans les endpoints PHP, chacun avec sa propre
 * variante de contrôle (`session_check.php` exigeait `etablissement_id`,
 * `save_timetable.php` le reconstruisait seul, `apply_proposition.php` encore
 * autrement). Toute règle d'authentification se change désormais ICI, une fois
 * — dans `chargerSession`, que la socket temps réel emploie aussi.
 */
export async function authenticate(req, res, next) {
  try {
    const { utilisateur, impersonateur } = await chargerSession(lireAccessToken(req));

    req.utilisateur = utilisateur;
    if (impersonateur) req.impersonateur = impersonateur;

    return next();
  } catch (error) {
    return next(error);
  }
}
