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
 */
export function requireRole(...rolesAutorises) {
  return (req, res, next) => {
    if (!req.utilisateur) {
      return next(forbidden('Accès refusé', { code: 'NON_AUTHENTIFIE' }));
    }
    const collaborateur =
      req.utilisateur.role === ROLES.ADMIN &&
      Boolean(req.utilisateur.$locals?.collaboration) &&
      rolesAutorises.includes(ROLES.FORMATEUR);
    if (!rolesAutorises.includes(req.utilisateur.role) && !collaborateur) {
      return next(forbidden('Accès refusé', { code: 'ROLE_INSUFFISANT' }));
    }
    return next();
  };
}
