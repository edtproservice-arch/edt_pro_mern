import { ROLES } from '../../constants/index.js';
import { PAGES_PARTAGEABLES, droitBorne, pagePrete } from './pages.js';

/**
 * Droits sur une page collaborative (Phase 5bis, étape c — invitations).
 *
 * ═══ UNE SEULE RÈGLE, TROIS LECTEURS ═══
 * Les routes HTTP (peut-il lire ? écrire ?), la salle temps réel (peut-il y
 * entrer ?) et l'écran (quel menu lui montrer ?) posent la même question. Elle
 * vit donc ici, une fois : trois exemplaires auraient fini par laisser écrire à
 * la socket ce que la route refuse — la cause n°1 d'instabilité du §4.2.
 *
 * ⚠️ L'APPARTENANCE À L'ÉTABLISSEMENT N'EST PAS CONTRÔLÉE ICI : elle l'est avant,
 * par `resoudreContexte`, qui refuse un établissement qui n'est pas celui du
 * compte. Cette fonction ne répond qu'à « dans CET établissement, que peut-il ».
 */
export const DROITS_PAGE = {
  CONSULTER: 'consulter',
  MODIFIER: 'modifier',
  /** Le directeur : tout, y compris partager, publier, importer, réinitialiser. */
  PROPRIETAIRE: 'proprietaire',
};

/** Ce qu'un directeur peut accorder — jamais la propriété. */
export const DROITS_ACCORDABLES = [DROITS_PAGE.CONSULTER, DROITS_PAGE.MODIFIER];

/**
 * « Accès général » de Notion : `restreint` = seules les personnes invitées ;
 * `etablissement` = tous les formateurs et gestionnaires de l'établissement.
 */
export const PORTEES_GENERALES = { RESTREINT: 'restreint', ETABLISSEMENT: 'etablissement' };

/** D'où vient un droit — l'écran en tire le menu à montrer. */
export const SOURCES_DROIT = {
  PROPRIETAIRE: 'proprietaire',
  ROLE: 'role',
  GENERAL: 'general',
  INVITATION: 'invitation',
  /** L'administrateur en collaboration, invité par défaut (2026-09-14). */
  ADMIN: 'admin',
};

const RANG = { [DROITS_PAGE.CONSULTER]: 1, [DROITS_PAGE.MODIFIER]: 2, [DROITS_PAGE.PROPRIETAIRE]: 3 };

/** Qui peut RECEVOIR une invitation : ceux qui travaillent sous le directeur. */
export const ROLES_INVITABLES = [ROLES.FORMATEUR, ROLES.GESTIONNAIRE];

/**
 * Le droit d'un utilisateur sur une page, et d'où il le tient.
 *
 * ⚠️ LE PLUS FORT L'EMPORTE, comme dans Notion : un gestionnaire qui consulte
 * déjà par son rôle et qu'on invite à modifier peut modifier ; un formateur
 * invité à consulter sur une page ouverte en modification à tout
 * l'établissement peut modifier.
 *
 * ⚠️ LA PAGE EST UN ARGUMENT, PAS SEULEMENT UNE PROPRIÉTÉ DU PARTAGE : quand
 * aucune invitation n'existe encore, `partage` est `null` — et c'est alors la
 * page seule qui dit ce qu'un rôle y a par défaut (`parRole`).
 *
 * @param {{ id: string, role: string }} utilisateur
 * @param {{ page?, general?: { portee, droit }, membres?: { utilisateurId, droit, statut }[] } | null} partage
 * @param {string} [page]  la page ; par défaut celle du partage
 * @returns {{ droit: string, source: string } | null} `null` = aucun accès
 */
export function droitSurPage(utilisateur, partage, page = partage?.page) {
  if (!utilisateur?.role) return null;

  if (utilisateur.role === ROLES.DIRECTEUR) {
    return { droit: DROITS_PAGE.PROPRIETAIRE, source: SOURCES_DROIT.PROPRIETAIRE };
  }

  /*
   * ═══ L'ADMINISTRATEUR EST INVITÉ PAR DÉFAUT (2026-09-14) ═══ — « peut
   * modifier », sur les pages qui se partagent, sans figurer dans la liste des
   * invités. Il n'atteint une page d'établissement qu'en COLLABORATION (son
   * jeton désigne l'établissement, `resoudreContexte` refuse tout autre) : hors
   * de là, cette règle n'est jamais lue.
   */
  if (utilisateur.role === ROLES.ADMIN) {
    return pagePrete(page)
      ? { droit: droitBorne(page, DROITS_PAGE.MODIFIER), source: SOURCES_DROIT.ADMIN }
      : null;
  }

  // Le stagiaire n'est jamais invité à préparer un emploi du temps.
  if (!ROLES_INVITABLES.includes(utilisateur.role)) return null;

  const candidats = [];

  /*
   * ⚠️ CE QU'UN RÔLE A SANS INVITATION DÉPEND DE LA PAGE (`parRole`) : le
   * gestionnaire consulte l'emploi du temps (« Édition ») et les documents,
   * depuis le 2026-09-03 — pas le reste. Une invitation peut le porter plus
   * haut ; rien ne le fait descendre en dessous.
   */
  const parRole = PAGES_PARTAGEABLES[page]?.parRole?.[utilisateur.role];
  if (parRole) candidats.push({ droit: parRole, source: SOURCES_DROIT.ROLE });

  /*
   * ═══ ⚠️ UNE PAGE QUI NE SE PARTAGE PLUS N'OUVRE RIEN PAR SON PARTAGE ═══
   * (2026-09-14, décision du porteur : seules Emploi, Chronogramme et
   * Affectations se partagent.) Les invitations déjà acceptées sur les autres
   * pages restent en base — les supprimer serait irréversible —, mais elles ne
   * donnent plus rien : sans ce garde, un invité continuerait d'ouvrir Absences
   * par un lien, alors que la page a quitté son menu. Le rôle, lui, vaut
   * toujours (le gestionnaire lit les Documents par le sien).
   */
  if (!pagePrete(page)) {
    return candidats.length ? { ...candidats[0], droit: droitBorne(page, candidats[0].droit) } : null;
  }

  const general = partage?.general;
  if (general?.portee === PORTEES_GENERALES.ETABLISSEMENT && DROITS_ACCORDABLES.includes(general.droit)) {
    candidats.push({ droit: general.droit, source: SOURCES_DROIT.GENERAL });
  }

  /*
   * ⚠️ UNE INVITATION EN ATTENTE NE DONNE RIEN : la personne doit l'avoir
   * ACCEPTÉE (demande du porteur, 2026-09-12). Un membre sans statut est une
   * invitation antérieure à cette règle — elle vaut acceptée.
   */
  const membre = (partage?.membres ?? []).find(
    (m) => String(m.utilisateurId) === String(utilisateur.id) && m.statut !== 'en_attente'
  );
  if (membre && DROITS_ACCORDABLES.includes(membre.droit)) {
    candidats.push({ droit: membre.droit, source: SOURCES_DROIT.INVITATION });
  }

  if (candidats.length === 0) return null;

  // À rang égal, la première source l'emporte : rôle, puis général, puis
  // invitation — l'ordre où elles ont été empilées.
  const meilleur = candidats.reduce((m, c) => (RANG[c.droit] > RANG[m.droit] ? c : m));

  /*
   * ⚠️ JAMAIS AU-DELÀ DU PLAFOND DE LA PAGE : Sessions et Avancement sont en
   * lecture seule, quel que soit ce qu'un document en base prétendrait. Le
   * service borne déjà à l'invitation ; ce second garde tient même si une
   * donnée écrite autrement le contournait.
   */
  return { ...meilleur, droit: droitBorne(page, meilleur.droit) };
}

/** Le droit détenu suffit-il pour ce qui est demandé ? */
export function droitSuffit(droit, requis) {
  return Boolean(droit) && (RANG[droit] ?? 0) >= (RANG[requis] ?? Infinity);
}
