import mongoose from 'mongoose';
import { ROLES } from 'shared/constants';
import {
  DROITS_PAGE,
  PAGES_PARTAGEABLES,
  PORTEES_GENERALES,
  ROLES_INVITABLES,
  SOURCES_DROIT,
  droitBorne,
  droitSuffit,
  droitSurPage,
  libellePage,
  pagePrete,
  pagesPretes,
} from 'shared/domain';
import { Partage } from '../../models/Partage.js';
import { Message } from '../../models/Message.js';
import { User } from '../../models/User.js';
import { ACTIONS_AUDIT, tracer } from '../../models/AuditLog.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/httpError.js';
import { bus, EVENEMENTS } from '../../lib/bus.js';
import { logger } from '../../lib/logger.js';
import { envoyer as envoyerMessage } from '../messagerie/messagerie.service.js';

/**
 * Partage des pages collaboratives (Phase 5bis, étape c).
 *
 * ⚠️ AUCUNE FONCTION NE REÇOIT UN ÉTABLISSEMENT DU CLIENT : toutes prennent
 * celui que `resolveTenant` a résolu. Un directeur ne peut inviter que sur SES
 * pages, et seulement des comptes de SON établissement — c'est vérifié ici, en
 * base, pas cru sur la foi de la requête.
 */

async function charger(etablissementId, anneeScolaire, page) {
  return Partage.findOne({ etablissementId, anneeScolaire, page }).lean();
}

const identite = (utilisateur) => ({ id: String(utilisateur.id), role: utilisateur.role });

/**
 * Refuse une page qui n'accepte pas encore d'invités (étape d).
 *
 * ⚠️ AU SERVEUR, PAS SEULEMENT À L'ÉCRAN : la boîte ne propose que les pages
 * prêtes, mais un appel direct pourrait en nommer une autre — et l'invité
 * recevrait un accès que chaque requête de la page refuserait ensuite.
 */
function exigerPagesPretes(pages) {
  const refusees = pages.filter((page) => !pagePrete(page));
  if (refusees.length > 0) {
    throw badRequest('Cette page ne peut pas encore être partagée', {
      code: 'PAGE_NON_PRETE',
      details: refusees.map((page) => ({ message: `« ${libellePage(page)} » n’accepte pas encore d’invités.` })),
    });
  }
}

/**
 * Le droit d'un utilisateur sur une page. LE point d'entrée des routes et de la
 * salle temps réel — qui appliquent donc exactement la même règle.
 *
 * @returns {{ droit, source } | null}
 */
export async function droitDe(utilisateur, etablissementId, anneeScolaire, page) {
  /*
   * Le directeur est propriétaire par son rôle, l'administrateur en collaboration
   * invité par défaut (2026-09-14) : ni l'un ni l'autre n'est écrit dans un
   * partage — inutile de lire la base.
   */
  if (utilisateur?.role === ROLES.DIRECTEUR || utilisateur?.role === ROLES.ADMIN) {
    return droitSurPage(utilisateur, null, page);
  }
  if (!ROLES_INVITABLES.includes(utilisateur?.role)) return null;

  // ⚠️ LA PAGE EST PASSÉE : sans partage en base, c'est elle seule qui dit ce
  // que le rôle y a par défaut (`parRole`).
  const partage = await charger(etablissementId, anneeScolaire, page);
  return droitSurPage(identite(utilisateur), partage, page);
}

/**
 * Le PLUS FORT des droits d'un utilisateur sur plusieurs pages — pour une
 * route que plusieurs pages partagent (la base e-note est lue par Affectations
 * comme par Formateurs). Une seule lecture en base, quel que soit leur nombre.
 */
export async function meilleurDroit(utilisateur, etablissementId, anneeScolaire, pages) {
  if (pages.length === 1) return droitDe(utilisateur, etablissementId, anneeScolaire, pages[0]);
  if (utilisateur?.role === ROLES.DIRECTEUR) return droitSurPage(utilisateur, null, pages[0]);
  if (utilisateur?.role === ROLES.ADMIN) {
    // Invité par défaut sur les pages qui se partagent : la plus ouverte l'emporte.
    return pages.map((page) => droitSurPage(utilisateur, null, page)).find(Boolean) ?? null;
  }
  if (!ROLES_INVITABLES.includes(utilisateur?.role)) return null;

  const partages = await Partage.find({ etablissementId, anneeScolaire, page: { $in: pages } }).lean();
  const parPage = new Map(partages.map((p) => [p.page, p]));

  let meilleur = null;
  for (const page of pages) {
    const acces = droitSurPage(identite(utilisateur), parPage.get(page) ?? null, page);
    // Strictement plus fort : à égalité, la première page nommée l'emporte.
    if (acces && (!meilleur || !droitSuffit(meilleur.droit, acces.droit))) meilleur = acces;
  }
  return meilleur;
}

/**
 * Les pages partagées avec cet utilisateur — pour le menu.
 *
 * ⚠️ SEULEMENT CE QUI VIENT D'UN PARTAGE (invitation ou accès général). Le
 * gestionnaire consulte l'emploi du temps par son RÔLE, depuis « Édition » : lui
 * rendre une entrée « partagée » pour ce seul motif doublerait un menu qu'il a
 * déjà.
 */
export async function pagesPartageesAvec(utilisateur, etablissementId, anneeScolaire) {
  /*
   * ⚠️ LES SEULES PAGES PRÊTES : une page encore gardée par rôle refuserait
   * chaque requête de l'invité — la montrer au menu mènerait à un écran vide.
   *
   * ⚠️ UNE SEULE REQUÊTE pour toutes les pages, et aucune pour qui n'est pas
   * invitable : la route est appelée à chaque ouverture de la barre latérale.
   */
  const pretes = pagesPretes();
  const invitable = ROLES_INVITABLES.includes(utilisateur?.role);
  const partages = invitable
    ? await Partage.find({ etablissementId, anneeScolaire, page: { $in: pretes } }).lean()
    : [];
  const parPage = new Map(partages.map((p) => [p.page, p]));

  const resultat = [];
  for (const page of pretes) {
    const acces = droitSurPage(identite(utilisateur), parPage.get(page) ?? null, page);
    if (!acces) continue;
    // L'accès de l'administrateur en collaboration compte comme un partage : ce
    // sont ses seules pages, et c'est par elles que son menu se construit.
    const partagee = [SOURCES_DROIT.GENERAL, SOURCES_DROIT.INVITATION, SOURCES_DROIT.ADMIN].includes(acces.source);
    resultat.push({ page, ...acces, partagee });
  }
  return resultat;
}

/** Les comptes qu'un directeur peut inviter : formateurs et gestionnaires actifs de SON établissement. */
async function candidatsDe(etablissementId) {
  return User.find({
    etablissementIds: etablissementId,
    role: { $in: ROLES_INVITABLES },
    estActif: true,
  })
    .select('nomComplet email role')
    .sort({ nomComplet: 1 })
    .lean();
}

const presenterCompte = (compte) => ({
  id: String(compte._id),
  nom: compte.nomComplet,
  email: compte.email,
  role: compte.role,
});

/**
 * Tout ce que la boîte « Partager » affiche au directeur.
 *
 * ⚠️ UN MEMBRE DONT LE COMPTE A DISPARU (supprimé, désactivé, changé
 * d'établissement) N'EST PAS RENDU : il n'a plus accès de toute façon, et le
 * montrer laisserait croire qu'il travaille encore sur la page.
 */
export async function presenter(etablissementId, anneeScolaire, page) {
  /*
   * ⚠️ TOUS LES PARTAGES DE L'ANNÉE, PAS LE SEUL DE LA PAGE : la ligne de chaque
   * invité dit sur combien de pages il est (2026-09-13) — c'est ce qui invite à
   * ouvrir « Gérer ses pages ». Une requête, quatorze documents au plus.
   */
  const [partages, candidats] = await Promise.all([
    Partage.find({ etablissementId, anneeScolaire }).lean(),
    candidatsDe(etablissementId),
  ]);
  const partage = partages.find((p) => p.page === page) ?? null;

  const parId = new Map(candidats.map((c) => [String(c._id), c]));
  const nombrePages = new Map();
  // ⚠️ Les pages qui se PARTAGENT seulement : une invitation restée en base sur
  // une page qui ne se partage plus n'ouvre rien, elle ne se compte pas.
  for (const autre of partages.filter((p) => pagePrete(p.page))) {
    for (const m of autre.membres ?? []) {
      const id = String(m.utilisateurId);
      nombrePages.set(id, (nombrePages.get(id) ?? 0) + 1);
    }
  }

  const membres = (partage?.membres ?? [])
    .filter((m) => parId.has(String(m.utilisateurId)))
    .map((m) => ({
      ...presenterCompte(parId.get(String(m.utilisateurId))),
      droit: m.droit,
      // « En attente » tant que l'invité n'a pas accepté — la boîte le dit,
      // sans quoi on croirait la page déjà ouverte chez lui.
      statut: m.statut ?? 'accepte',
      inviteLe: m.inviteLe,
      pages: nombrePages.get(String(m.utilisateurId)) ?? 1,
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  const dejaMembres = new Set(membres.map((m) => m.id));

  return {
    page,
    anneeScolaire,
    general: {
      portee: partage?.general?.portee ?? PORTEES_GENERALES.RESTREINT,
      droit: partage?.general?.droit ?? DROITS_PAGE.CONSULTER,
    },
    membres,
    // Ceux qu'on peut encore inviter — un membre ne se réinvite pas, il change
    // de droit dans sa ligne.
    candidats: candidats.filter((c) => !dejaMembres.has(String(c._id))).map(presenterCompte),
    // Le groupe « consulte par son rôle » de la boîte : sans lui, on croirait
    // la page fermée aux gestionnaires qu'on n'a pas invités. ⚠️ SEULEMENT sur
    // une page qui le prévoit (`parRole`) : ailleurs, ils n'y ont rien.
    gestionnairesParRole: PAGES_PARTAGEABLES[page]?.parRole?.[ROLES.GESTIONNAIRE]
      ? candidats.filter((c) => c.role === ROLES.GESTIONNAIRE && !dejaMembres.has(String(c._id))).length
      : 0,
  };
}

/**
 * Annonce aux sockets qu'un droit a changé — ceux qui l'ont perdu quittent la
 * salle sur-le-champ, au lieu d'attendre la fin de leur jeton.
 * `utilisateurId: null` = tout le monde (changement de l'accès général).
 */
function annoncer(etablissementId, anneeScolaire, page, utilisateurId) {
  try {
    bus.emit(EVENEMENTS.PARTAGE_MODIFIE, {
      etablissementId: String(etablissementId),
      anneeScolaire,
      page,
      utilisateurId: utilisateurId ? String(utilisateurId) : null,
    });
  } catch (erreur) {
    logger.error({ err: erreur }, 'Annonce de partage impossible');
  }
}

const tracerPartage = (acteur, details) =>
  tracer({ acteur, action: ACTIONS_AUDIT.PARTAGE_MODIFIE, details });

/**
 * Invite une ou plusieurs personnes, sur une ou plusieurs pages (étape d).
 *
 * ⚠️ UNE PERSONNE DÉJÀ MEMBRE N'EST PAS DOUBLÉE : son droit est mis à jour.
 * Deux lignes pour le même compte, et `droitSurPage` n'en lirait qu'une —
 * retirer « la » personne en laisserait l'autre, avec son accès.
 *
 * ⚠️ PLUSIEURS PAGES = PLUSIEURS DOCUMENTS, ÉCRITS DANS UNE TRANSACTION : une
 * invitation à moitié posée ouvrirait deux pages sur trois, sans rien qui le
 * dise — et le message, lui, en annoncerait trois.
 *
 * ⚠️ LE DROIT EST BORNÉ PAGE PAR PAGE : « peut modifier » sur Emploi et
 * Sessions donne modifier sur l'un, consulter sur l'autre (lecture seule).
 */
/**
 * Le droit accordé sur chaque page d'une invitation : celui que `droits` nomme
 * pour elle, sinon `droit` — toujours borné au `droitMax` de la page.
 *
 * @returns {Map<string, 'modifier'|'consulter'>}
 */
function droitsAccordes(pages, droit, droits = {}) {
  return new Map(pages.map((cible) => [cible, droitBorne(cible, droits[cible] ?? droit)]));
}

/*
 * ═══ UN DROIT PAR PAGE (2026-09-13) ═══ `droits` nomme le droit de chaque page
 * — Emploi en modification, Absences en consultation — et chacune de ses pages
 * entre dans l'invitation. `droit` reste celui des pages qu'il ne nomme pas.
 */
export async function inviter(
  etablissementId,
  anneeScolaire,
  page,
  directeur,
  { utilisateurIds, droit = DROITS_PAGE.MODIFIER, pages = [], droits = {} }
) {
  // La page de la route en tête : c'est elle que la boîte affiche ensuite.
  const toutes = [...new Set([page, ...pages, ...Object.keys(droits)])];
  exigerPagesPretes(toutes);
  const accordes = droitsAccordes(toutes, droit, droits);

  const candidats = await candidatsDe(etablissementId);
  const parId = new Map(candidats.map((c) => [String(c._id), c]));

  const invites = [...new Set(utilisateurIds.map(String))].filter((id) => parId.has(id));
  if (invites.length === 0) {
    throw badRequest('Aucune de ces personnes ne peut être invitée', {
      code: 'INVITES_REFUSES',
      details: [
        {
          message:
            'On n’invite que les formateurs et gestionnaires actifs de votre établissement.',
        },
      ],
    });
  }

  // Invité → les pages où il est NOUVEAU : c'est ce que son message annonce.
  const nouvellesPages = new Map();

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // `withTransaction` peut rejouer : on repart d'un relevé vide.
      nouvellesPages.clear();
      for (const cible of toutes) {
        const droitPage = accordes.get(cible);
        const partage =
          (await Partage.findOne({ etablissementId, anneeScolaire, page: cible }).session(session)) ??
          new Partage({ etablissementId, anneeScolaire, page: cible });

        for (const id of invites) {
          const existant = partage.membres.find((m) => String(m.utilisateurId) === id);
          if (existant) {
            // Le droit change ; le statut, lui, reste : une invitation en attente
            // attend toujours, une invitation acceptée n'a pas à l'être de nouveau.
            existant.droit = droitPage;
          } else {
            /*
             * ⚠️ `en_attente` EXPLICITE : tant que la personne n'a pas accepté,
             * elle n'a aucun accès (demande du porteur, 2026-09-12).
             */
            partage.membres.push({ utilisateurId: id, droit: droitPage, invitePar: directeur.id, statut: 'en_attente' });
            nouvellesPages.set(id, [...(nouvellesPages.get(id) ?? []), cible]);
          }
        }
        await partage.save({ session });
      }
    });
  } finally {
    await session.endSession();
  }

  for (const cible of toutes) {
    for (const id of invites) annoncer(etablissementId, anneeScolaire, cible, id);
  }
  await tracerPartage(directeur, {
    page: toutes.join(','),
    pages: toutes,
    anneeScolaire,
    action: 'inviter',
    invites,
    droit,
    droits: Object.fromEntries(accordes),
  });

  /*
   * UN MESSAGE PAR JEU DE PAGES : deux invités nouveaux sur les mêmes pages
   * reçoivent le même message ; celui qui était déjà membre de l'une ne reçoit
   * que l'annonce des autres.
   */
  const parJeu = new Map();
  for (const [id, pagesNouvelles] of nouvellesPages) {
    const cle = pagesNouvelles.join('|');
    parJeu.set(cle, [...(parJeu.get(cle) ?? []), id]);
  }
  for (const [cle, destinataires] of parJeu) {
    await notifierInvites(directeur, destinataires, { etablissementId, anneeScolaire, pages: cle.split('|') }, accordes);
  }

  return presenter(etablissementId, anneeScolaire, page);
}

const annonceDroit = (droit) =>
  droit === DROITS_PAGE.MODIFIER ? 'vous pourrez modifier' : 'vous pourrez consulter';

/**
 * Le droit d'une page dans une invitation. `droits` est UN droit pour toutes
 * (appels antérieurs), ou le droit de chaque page — `Map` ou objet.
 */
function droitAnnonce(droits, page) {
  const demande =
    typeof droits === 'string' ? droits : droits instanceof Map ? droits.get(page) : droits?.[page];
  return droitBorne(page, demande ?? DROITS_PAGE.CONSULTER);
}

/** Sujet et corps d'une invitation — une page, ou la liste de ses pages avec leur droit. */
export function redigerInvitation(nomDirecteur, pages, droits) {
  if (pages.length === 1) {
    const [page] = pages;
    return {
      sujet: `Invitation à collaborer sur « ${libellePage(page)} »`,
      corps:
        `${nomDirecteur} vous invite à collaborer sur « ${libellePage(page)} » de l’établissement ` +
        `(${annonceDroit(droitAnnonce(droits, page))}).\n\n` +
        `Acceptez l’invitation ci-dessous : la page apparaîtra alors dans votre menu.`,
    };
  }
  const lignes = pages.map((page) => `• ${libellePage(page)} — ${annonceDroit(droitAnnonce(droits, page))}`);
  return {
    sujet: `Invitation à collaborer sur ${pages.length} pages`,
    corps:
      `${nomDirecteur} vous invite à collaborer sur ces pages de l’établissement :\n${lignes.join('\n')}\n\n` +
      `Acceptez l’invitation ci-dessous : les pages apparaîtront alors dans votre menu.`,
  };
}

/**
 * Prévient les nouveaux invités par la MESSAGERIE existante — le message porte
 * l'invitation, que la personne ACCEPTE ou REFUSE depuis ce message.
 *
 * ⚠️ PAS PAR LA SOCKET : un formateur n'a de socket ouverte que sur une page
 * collaborative — précisément celle qu'il ne connaît pas encore. Le message
 * l'attend, et le compteur de non-lus le signale.
 *
 * ⚠️ PLUS DE LIEN DANS LE CORPS (demande du porteur, 2026-09-12) : l'adresse
 * d'`APP_URL` n'est pas encore hébergée, le lien menait nulle part. Et il n'a
 * plus d'objet : c'est « Accepter » qui ouvre la page, en l'ajoutant au menu.
 *
 * ⚠️ UN ÉCHEC D'ENVOI N'ANNULE PAS L'INVITATION — mais sans message, elle ne
 * peut pas être acceptée : c'est journalisé, et le directeur la voit « en
 * attente » dans sa boîte.
 */
async function notifierInvites(directeur, destinataires, { etablissementId, anneeScolaire, pages }, accordes) {
  if (destinataires.length === 0) return;
  // Le droit de CHAQUE page, et le plus haut en résumé : « modifier » ne se
  // promet pas sur une invitation qui ne porte que des pages en consultation.
  const droits = pages.map((page) => ({ page, droit: accordes.get(page) }));
  const droit = droits.some((d) => d.droit === DROITS_PAGE.MODIFIER) ? DROITS_PAGE.MODIFIER : DROITS_PAGE.CONSULTER;
  try {
    await envoyerMessage(directeur.id, {
      destinataires,
      ...redigerInvitation(directeur.nomComplet, pages, accordes),
      invitation: { etablissementId, anneeScolaire, pages, droit, droits },
    });
  } catch (erreur) {
    logger.warn({ err: erreur }, 'Message d’invitation non envoyé');
  }
}

/**
 * Accepte ou refuse une invitation, depuis le message qui la porte.
 *
 * ⚠️ SEUL LE DESTINATAIRE DU MESSAGE Y RÉPOND : le message est cherché avec
 * `destinataireId`, jamais par son seul identifiant — sinon n'importe qui
 * connaissant l'identifiant accepterait à la place de l'invité.
 *
 * ⚠️ L'ÉTABLISSEMENT VIENT DU MESSAGE, POSÉ PAR LE SERVEUR, et il est revérifié
 * contre le compte : un formateur qui aurait quitté l'établissement entre-temps
 * ne rouvre rien.
 *
 * ⚠️ RETIRÉE ENTRE-TEMPS : si le directeur a retiré la personne avant qu'elle
 * réponde, accepter ne recrée rien — le message passe `retiree` et le dit.
 *
 * @param {'accepter'|'refuser'} reponse
 */
export async function repondreInvitation(utilisateur, messageId, reponse) {
  const message = await Message.findOne({ _id: messageId, destinataireId: utilisateur.id });
  if (!message?.invitation) {
    throw notFound('Invitation introuvable', { code: 'INVITATION_INCONNUE' });
  }

  const invitation = message.invitation;
  if (invitation.statut !== 'en_attente') {
    throw conflict('Vous avez déjà répondu à cette invitation', {
      code: 'INVITATION_TRAITEE',
      details: [{ message: `Statut actuel : ${invitation.statut}` }],
    });
  }

  const { etablissementId, anneeScolaire } = invitation;
  const appartient = (utilisateur.etablissementIds ?? []).some((id) => String(id) === String(etablissementId));
  if (!appartient) {
    throw forbidden('Vous ne faites plus partie de cet établissement', { code: 'ETABLISSEMENT_INTERDIT' });
  }

  let concernees = 0;
  for (const page of invitation.pages) {
    const partage = await Partage.findOne({ etablissementId, anneeScolaire, page });
    const membre = partage?.membres.find((m) => String(m.utilisateurId) === String(utilisateur.id));
    if (!membre) continue;

    if (reponse === 'accepter') {
      membre.statut = 'accepte';
      membre.accepteLe = new Date();
    } else {
      partage.membres = partage.membres.filter((m) => String(m.utilisateurId) !== String(utilisateur.id));
    }
    await partage.save();
    concernees += 1;
    annoncer(etablissementId, anneeScolaire, page, utilisateur.id);
  }

  invitation.statut = concernees === 0 ? 'retiree' : reponse === 'accepter' ? 'acceptee' : 'refusee';
  invitation.reponduLe = new Date();
  await message.save();

  await tracerPartage(utilisateur, {
    page: invitation.pages.join(','),
    anneeScolaire,
    action: `invitation_${invitation.statut}`,
  });

  if (invitation.statut === 'retiree') {
    throw conflict('Le directeur a retiré cette invitation', { code: 'INVITATION_RETIREE' });
  }

  return { statut: invitation.statut, pages: invitation.pages };
}

async function chargerPourModifier(etablissementId, anneeScolaire, page) {
  const partage = await Partage.findOne({ etablissementId, anneeScolaire, page });
  if (!partage) throw notFound('Cette page n’est partagée avec personne', { code: 'PARTAGE_INCONNU' });
  return partage;
}

export async function changerDroit(etablissementId, anneeScolaire, page, directeur, utilisateurId, droit) {
  const partage = await chargerPourModifier(etablissementId, anneeScolaire, page);
  const membre = partage.membres.find((m) => String(m.utilisateurId) === String(utilisateurId));
  if (!membre) throw notFound('Cette personne n’est pas invitée', { code: 'MEMBRE_INCONNU' });

  membre.droit = droit;
  await partage.save();

  annoncer(etablissementId, anneeScolaire, page, utilisateurId);
  await tracerPartage(directeur, { page, anneeScolaire, action: 'changer', cible: String(utilisateurId), droit });
  return presenter(etablissementId, anneeScolaire, page);
}

export async function retirer(etablissementId, anneeScolaire, page, directeur, utilisateurId) {
  const partage = await chargerPourModifier(etablissementId, anneeScolaire, page);
  const avant = partage.membres.length;
  partage.membres = partage.membres.filter((m) => String(m.utilisateurId) !== String(utilisateurId));
  if (partage.membres.length === avant) {
    throw notFound('Cette personne n’est pas invitée', { code: 'MEMBRE_INCONNU' });
  }
  await partage.save();
  await retirerInvitationsOrphelines(etablissementId, anneeScolaire, utilisateurId);

  annoncer(etablissementId, anneeScolaire, page, utilisateurId);
  await tracerPartage(directeur, { page, anneeScolaire, action: 'retirer', cible: String(utilisateurId) });
  return presenter(etablissementId, anneeScolaire, page);
}

/**
 * Les invitations EN ATTENTE d'une personne qui n'ouvrent plus rien perdent
 * leurs boutons : sans cela, le message continuerait d'afficher « Accepter »
 * pour des pages qu'on vient de refermer.
 *
 * ⚠️ UNE INVITATION À PLUSIEURS PAGES GARDE SES BOUTONS tant qu'UNE de ses pages
 * attend encore la personne (2026-09-13). La version précédente la retirait dès
 * qu'on refermait l'une d'elles — l'invité perdait alors les deux autres, qu'on
 * ne lui avait pas retirées.
 */
async function retirerInvitationsOrphelines(etablissementId, anneeScolaire, utilisateurId) {
  const messages = await Message.find({
    destinataireId: utilisateurId,
    'invitation.statut': 'en_attente',
    'invitation.etablissementId': etablissementId,
    'invitation.anneeScolaire': anneeScolaire,
  });
  if (messages.length === 0) return;

  const partages = await Partage.find({
    etablissementId,
    anneeScolaire,
    'membres.utilisateurId': utilisateurId,
  }).lean();
  const enAttente = new Set(
    partages
      .filter((p) =>
        p.membres.some((m) => String(m.utilisateurId) === String(utilisateurId) && m.statut === 'en_attente')
      )
      .map((p) => p.page)
  );

  for (const message of messages) {
    if (message.invitation.pages.some((page) => enAttente.has(page))) continue;
    message.invitation.statut = 'retiree';
    message.invitation.reponduLe = new Date();
    await message.save();
  }
}

/** Le compte d'un invité possible — refusé s'il n'est pas de l'établissement, ou pas invitable. */
async function exigerCandidat(etablissementId, utilisateurId) {
  const candidat = (await candidatsDe(etablissementId)).find((c) => String(c._id) === String(utilisateurId));
  if (!candidat) {
    throw notFound('Cette personne ne peut pas être invitée', {
      code: 'MEMBRE_INCONNU',
      details: [{ message: 'On n’invite que les formateurs et gestionnaires actifs de votre établissement.' }],
    });
  }
  return candidat;
}

/**
 * ═══ LES PAGES D'UN INVITÉ, TOUTES À LA FOIS (2026-09-13) ═══
 * La boîte « Partager » ne montre qu'UNE page ; le directeur qui veut savoir ce
 * qu'une personne voit ailleurs devait ouvrir la boîte de chaque page. Cette
 * vue les rend toutes, avec :
 *   - `invitation` : son droit et son statut PAR INVITATION sur la page ;
 *   - `sansInvitation` : ce qu'elle y aurait SANS invitation — par son rôle
 *     (le gestionnaire consulte l'emploi du temps) ou par l'accès général.
 *     ⚠️ C'est ce qui évite d'inviter « à consulter » quelqu'un qui consulte
 *     déjà : la ligne le dit.
 */
export async function pagesDuMembre(etablissementId, anneeScolaire, utilisateurId) {
  const candidat = await exigerCandidat(etablissementId, utilisateurId);
  const partages = await Partage.find({ etablissementId, anneeScolaire }).lean();
  const parPage = new Map(partages.map((p) => [p.page, p]));
  const id = String(candidat._id);
  const qui = { id, role: candidat.role };

  // Les pages qui se partagent (2026-09-14 : Emploi, Chronogramme, Affectations).
  const pages = pagesPretes().map((page) => {
    const partage = parPage.get(page) ?? null;
    const membre = partage?.membres.find((m) => String(m.utilisateurId) === id) ?? null;
    // Le même partage, SANS la ligne de la personne : ce qui lui resterait.
    const sansLui = partage ? { ...partage, membres: partage.membres.filter((m) => m !== membre) } : null;
    return {
      page,
      prete: pagePrete(page),
      droitMax: PAGES_PARTAGEABLES[page].droitMax ?? DROITS_PAGE.MODIFIER,
      invitation: membre ? { droit: membre.droit, statut: membre.statut ?? 'accepte' } : null,
      sansInvitation: droitSurPage(qui, sansLui, page),
    };
  });

  return { membre: presenterCompte(candidat), anneeScolaire, pages };
}

/**
 * Règle d'un coup les pages d'UN invité — `{ page: droit | null }`.
 *
 *   - un droit sur une page où il n'est pas → il y est INVITÉ (`en_attente`), et
 *     un seul message annonce toutes les pages nouvelles, avec leur droit ;
 *   - un droit sur une page où il est → le droit change, le statut reste ;
 *   - `null` → il perd l'accès par invitation (celui de son rôle ou de l'accès
 *     général demeure : il n'est pas écrit dans le partage).
 *   - une page non nommée n'est pas touchée.
 *
 * ⚠️ UNE SEULE TRANSACTION : régler quatre pages et n'en voir passer que deux
 * laisserait une personne avec un accès que la boîte ne montre plus.
 */
export async function reglerPagesMembre(etablissementId, anneeScolaire, directeur, utilisateurId, droits) {
  const candidat = await exigerCandidat(etablissementId, utilisateurId);
  const id = String(candidat._id);

  const pages = Object.keys(droits);
  // Ouvrir une page pas encore prête est refusé ; en retirer l'accès, jamais.
  exigerPagesPretes(pages.filter((page) => droits[page] !== null));
  const accordes = new Map(
    pages.filter((page) => droits[page] !== null).map((page) => [page, droitBorne(page, droits[page])])
  );

  const modifiees = [];
  const nouvelles = [];

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // `withTransaction` peut rejouer : on repart de relevés vides.
      modifiees.length = 0;
      nouvelles.length = 0;
      for (const page of pages) {
        const voulu = accordes.get(page) ?? null;
        let partage = await Partage.findOne({ etablissementId, anneeScolaire, page }).session(session);
        const existant = partage?.membres.find((m) => String(m.utilisateurId) === id);

        if (voulu === null) {
          if (!existant) continue;
          partage.membres = partage.membres.filter((m) => String(m.utilisateurId) !== id);
        } else if (existant) {
          if (existant.droit === voulu) continue;
          existant.droit = voulu;
        } else {
          partage ??= new Partage({ etablissementId, anneeScolaire, page });
          partage.membres.push({ utilisateurId: id, droit: voulu, invitePar: directeur.id, statut: 'en_attente' });
          nouvelles.push(page);
        }
        await partage.save({ session });
        modifiees.push(page);
      }
    });
  } finally {
    await session.endSession();
  }

  if (modifiees.length > 0) {
    await retirerInvitationsOrphelines(etablissementId, anneeScolaire, id);
    for (const page of modifiees) annoncer(etablissementId, anneeScolaire, page, id);
    await tracerPartage(directeur, {
      page: modifiees.join(','),
      pages: modifiees,
      anneeScolaire,
      action: 'regler',
      cible: id,
      droits,
    });
  }
  if (nouvelles.length > 0) {
    await notifierInvites(directeur, [id], { etablissementId, anneeScolaire, pages: nouvelles }, accordes);
  }

  return pagesDuMembre(etablissementId, anneeScolaire, id);
}

export async function changerAccesGeneral(etablissementId, anneeScolaire, page, directeur, { portee, droit }) {
  exigerPagesPretes([page]);
  await Partage.findOneAndUpdate(
    { etablissementId, anneeScolaire, page },
    // Borné comme une invitation : « tout l'établissement peut modifier » ne
    // vaut que « consulter » sur une page en lecture seule.
    { $set: { general: { portee, droit: droitBorne(page, droit) } } },
    { upsert: true, setDefaultsOnInsert: true }
  );

  // Tout le monde est concerné : l'accès général vaut pour tout l'établissement.
  annoncer(etablissementId, anneeScolaire, page, null);
  await tracerPartage(directeur, { page, anneeScolaire, action: 'general', portee, droit });
  return presenter(etablissementId, anneeScolaire, page);
}
