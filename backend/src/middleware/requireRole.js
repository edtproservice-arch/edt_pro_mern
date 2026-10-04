import { ROLES } from 'shared/constants';
import { forbidden } from '../lib/httpError.js';

/**
 * Restreint une route à certains rôles. À monter APRÈS `authenticate`.
 *
 *   router.post('/', authenticate, requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE), controleur)
 *
 * Passer par les constantes de `shared/constants` plutôt que par des chaînes :
 * en PHP, ce contrôle était réécrit à la main dans chaque fichier, avec des
 * variantes — `apply_proposition.php:18` acceptait à la fois 'director' et
 * 'directeur', deux orthographes pour un même rôle, sans que rien ne l'empêche.
 *
 * ═══ L'ADMINISTRATEUR EN COLLABORATION PASSE LÀ OÙ PASSE UN INVITÉ ═══
 * (2026-09-14, demande du porteur : « l'admin peut aussi collaborer, invité par
 * défaut ».) Une garde qui admet le FORMATEUR admet les invités ; les pages y
 * décident ensuite par le DROIT (`exigerDroitPage`), qui donne à l'admin celui
 * d'un invité « peut modifier » sur les pages qui se partagent. Une garde
 * réservée au directeur — publier, importer, partager — le refuse toujours.
 *
 * ⚠️ UNE RÈGLE ICI PLUTÔT QUE « ADMIN » AJOUTÉ AUX HUIT ROUTEURS DES PAGES : on
 * l'y aurait oublié sur le prochain, et un admin HORS collaboration aurait
 * passé la garde pour échouer plus loin sur l'établissement (400 au lieu de 403).
 *
 * ═══ CONTRÔLE TOTAL (2026-10-03, décision du porteur) ═══ « Pour la
 * collaboration, l'admin a un contrôle total : tous les onglets du directeur. »
 * L'administrateur en collaboration passe désormais AUSSI les gardes réservées
 * au directeur — publier, importer, partager compris. Il reste tracé
 * (`COLLABORATION_DEBUT`) et cantonné à l'établissement de son jeton.
 */
export function requireRole(...rolesAutorises) {
  return (req, res, next) => {
    if (!req.utilisateur) {
      return next(forbidden('Accès refusé', { code: 'NON_AUTHENTIFIE' }));
    }
    const collaborateur =
      enCollaboration(req.utilisateur) &&
      (rolesAutorises.includes(ROLES.DIRECTEUR) || rolesAutorises.includes(ROLES.FORMATEUR));
    if (!rolesAutorises.includes(req.utilisateur.role) && !collaborateur) {
      return next(forbidden('Accès refusé', { code: 'ROLE_INSUFFISANT' }));
    }
    return next();
  };
}

/** Un administrateur qui collabore avec un établissement (jeton `col`). */
export function enCollaboration(utilisateur) {
  return utilisateur?.role === ROLES.ADMIN && Boolean(utilisateur.$locals?.collaboration);
}

/**
 * Agit-il en DIRECTEUR ? Le directeur lui-même, ou l'administrateur en
 * collaboration, qui en a le contrôle total depuis le 2026-10-03.
 */
export function agitEnDirecteur(utilisateur) {
  return utilisateur?.role === ROLES.DIRECTEUR || enCollaboration(utilisateur);
}
