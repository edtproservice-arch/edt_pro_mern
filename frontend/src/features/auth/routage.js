import { ROLES, STATUTS_COMPTE } from 'shared/constants';

/**
 * Destination après une connexion réussie.
 *
 * ← login.php:326-433, où la redirection était calculée côté serveur et
 * renvoyée sous forme d'URL de page HTML (`emploi.html`, `admin_dashboard.html`…).
 * Le serveur n'a plus à connaître les écrans du client : il renvoie l'utilisateur,
 * le client décide.
 */
export function routeApresConnexion(utilisateur) {
  if (!utilisateur) return '/connexion';

  if (utilisateur.role === ROLES.ADMIN) return '/admin';

  // Un directeur non approuvé obtient une session, mais n'accède qu'à l'écran
  // de demande d'essai.
  if (utilisateur.statut === STATUTS_COMPTE.EN_ATTENTE) return '/essai';

  // Configuration initiale (F3) — ← login.php:334, qui renvoyait vers
  // setup.html tant que `is_setup_complete` était faux. Le directeur y importe
  // sa base e-note, vérifie ses formateurs, règle le calendrier et liste ses
  // espaces. Sans elle, il arriverait sur une application vide.
  if (utilisateur.role === ROLES.DIRECTEUR && !utilisateur.configurationTerminee) {
    return '/configuration';
  }

  return '/app';
}

/**
 * Destination après une USURPATION par un administrateur.
 *
 * ═══ ⚠️ ELLE NE PASSE JAMAIS PAR LA CONFIGURATION ═══ (2026-09-06, demande du
 * porteur : « en général l'admin dirige directement en compte directeur accueil
 * sans passer par configuration, même si le directeur n'a pas fini ces
 * étapes ». Cette décision REVIENT sur celle du 2026-08-14, qui alignait
 * l'usurpation sur la connexion ordinaire.)
 *
 * Les deux gestes n'ont pas le même but : le DIRECTEUR qui se connecte doit
 * finir de configurer son établissement — c'est son travail, et l'application
 * lui serait vide sans cela. L'ADMINISTRATEUR, lui, prend sa place pour
 * REGARDER : l'enfermer dans un assistant de configuration l'empêche de voir
 * l'écran sur lequel il vient enquêter, et il pourrait le remplir à la place de
 * son propriétaire. L'assistant reste accessible — par son adresse, s'il veut
 * précisément vérifier là.
 *
 * ⚠️ « EN ATTENTE » RESTE, LUI : un directeur non approuvé n'a AUCUN
 * établissement, donc rien à montrer sur `/app`. Ce n'est pas une étape à
 * franchir mais un compte sans données.
 */
export function routeApresUsurpation(utilisateur) {
  if (!utilisateur) return '/connexion';
  if (utilisateur.statut === STATUTS_COMPTE.EN_ATTENTE) return '/essai';
  return '/app';
}
