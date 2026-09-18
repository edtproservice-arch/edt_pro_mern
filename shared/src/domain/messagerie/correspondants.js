import { ROLES } from '../../constants/index.js';

/**
 * Qui peut écrire à qui.
 * ← `send.php:90-150`, dont la matrice est ici REMPLACÉE
 *
 * ═══ ⚠️ POURQUOI ON NE PORTE PAS L'EXISTANT ═══
 * `send.php` décide par cinq branches `switch`, dont plusieurs se replient l'une
 * sur l'autre : une jointure par E-MAIL sur `formateurs_details`, et quand elle
 * échoue, un repli « même établissement ». Deux chemins pour une même question,
 * dont l'un dépend d'une adresse qui n'est parfois qu'un `@placeholder.ofppt.ma`
 * fabriqué. La matrice ci-dessous est celle arrêtée par le porteur le
 * 2026-08-25 : une ligne par rôle, lisible d'un coup.
 *
 * ═══ ⚠️ ELLE N'EST PAS SYMÉTRIQUE, ET C'EST VOULU ═══
 * Un formateur écrit à ses collègues, un stagiaire n'écrit qu'à son
 * gestionnaire. C'est la règle demandée.
 *
 * ⚠️ CONSÉQUENCE ASSUMÉE : sans exception, un message reçu d'un rôle qu'on ne
 * peut pas viser en retour serait SANS RÉPONSE POSSIBLE. `peutRepondre` lève
 * donc ce seul cas — on peut toujours répondre à qui vous a écrit. Sans cela,
 * une partie des messages de l'établissement seraient des impasses.
 *
 * ═══ ⚠️⚠️ RÉVISION DU 2026-09-03 (demande du porteur) ═══
 * Le directeur ÉCRIT DÉSORMAIS à l'admin et à ses gestionnaires — la matrice du
 * 2026-08-25 ne l'y autorisait pas, seul `peutRepondre` le permettait après coup
 * (une fois que l'un des deux lui avait écrit en premier). Ce n'est PLUS une
 * exception de réponse : le directeur peut désormais INITIER la conversation.
 *
 * ⚠️ CE CHANGEMENT NE TOUCHE AUCUN SERVICE : `messagerie.service.js` charge déjà
 * TOUS les comptes du même établissement (gestionnaires compris) et TOUS les
 * administrateurs actifs, pour les filtrer ENSUITE par `peutEcrire` — la
 * matrice était le SEUL verrou. C'est exactement ce que « une ligne par rôle,
 * lisible d'un coup » rend possible : étendre un rôle ne demande de toucher
 * qu'ICI.
 */

/**
 * Rôles joignables, par rôle d'expéditeur.
 *
 * `etablissement: true` restreint au MÊME établissement. L'admin en est exempt :
 * il n'appartient à aucun.
 */
const MATRICE = {
  [ROLES.ADMIN]: [{ role: ROLES.DIRECTEUR, etablissement: false }],

  /*
   * ⚠️ ADMIN : `etablissement: false`, EXACTEMENT COMME CÔTÉ ADMIN. L'admin
   * n'appartient à aucun établissement — le contraire de cette règle refuserait
   * TOUJOURS, faute d'un établissement commun à trouver.
   */
  [ROLES.DIRECTEUR]: [
    { role: ROLES.FORMATEUR, etablissement: true },
    { role: ROLES.GESTIONNAIRE, etablissement: true },
    { role: ROLES.ADMIN, etablissement: false },
  ],

  [ROLES.FORMATEUR]: [
    { role: ROLES.DIRECTEUR, etablissement: true },
    { role: ROLES.FORMATEUR, etablissement: true },
  ],

  [ROLES.GESTIONNAIRE]: [
    { role: ROLES.DIRECTEUR, etablissement: true },
    { role: ROLES.FORMATEUR, etablissement: true },
    { role: ROLES.STAGIAIRE, etablissement: true },
  ],

  [ROLES.STAGIAIRE]: [{ role: ROLES.GESTIONNAIRE, etablissement: true }],
};

/** Les rôles qu'un expéditeur peut viser — pour construire la liste de choix. */
export function rolesJoignables(role) {
  return (MATRICE[role] ?? []).map((regle) => regle.role);
}

/**
 * `expediteur` peut-il écrire à `destinataire` ?
 *
 * ⚠️ ON NE S'ÉCRIT PAS À SOI-MÊME — l'existant l'écartait aussi, et un message
 * qui s'affiche à la fois dans la boîte et dans les envoyés ne se comprend pas.
 *
 * @param {{id, role, etablissementIds?}} expediteur
 * @param {{id, role, etablissementIds?}} destinataire
 */
export function peutEcrire(expediteur, destinataire) {
  if (!expediteur || !destinataire) return false;
  if (String(expediteur.id) === String(destinataire.id)) return false;

  const regle = (MATRICE[expediteur.role] ?? []).find((r) => r.role === destinataire.role);
  if (!regle) return false;
  if (!regle.etablissement) return true;

  return partagentUnEtablissement(expediteur, destinataire);
}

/**
 * ⚠️ RÉPONDRE EST TOUJOURS PERMIS à qui vous a écrit.
 *
 * La matrice est asymétrique par construction : sans cette exception, un
 * directeur ne pourrait pas répondre à l'admin, ni à son gestionnaire. Un
 * message sans réponse possible n'est pas une messagerie.
 */
export function peutRepondre(expediteur, destinataire, { aEcritAvant }) {
  return Boolean(aEcritAvant) || peutEcrire(expediteur, destinataire);
}

/**
 * ⚠️ L'ISOLATION MULTI-ÉTABLISSEMENT EST ICI, EN UN SEUL POINT. C'est le trou
 * de `toggle_user_status.php`, déjà rencontré sur les comptes : un contrôle de
 * rôle sans contrôle d'établissement laisse écrire à l'EFP d'à côté.
 */
function partagentUnEtablissement(a, b) {
  const siens = new Set((a.etablissementIds ?? []).map(String));
  return (b.etablissementIds ?? []).some((identifiant) => siens.has(String(identifiant)));
}
