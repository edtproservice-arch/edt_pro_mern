import crypto from 'node:crypto';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';
import { ROLES_GERABLES } from 'shared/schemas';
import { User } from '../../models/User.js';
import { Base } from '../../models/Base.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { RefreshToken } from '../../models/RefreshToken.js';
import { CodeVerification } from '../../models/CodeVerification.js';
import { Partage } from '../../models/Partage.js';
import { badRequest, conflict, notFound } from '../../lib/httpError.js';
import { envoyerEmail } from '../../config/mailer.js';

/**
 * Comptes formateurs, stagiaires et gestionnaires (F12).
 * ← api/session/*.php
 *
 * ⚠️ RÈGLE D'ISOLATION, appliquée par `chargerCible()` : un directeur ne peut
 * agir que sur les comptes de SON établissement, et seulement sur les trois
 * rôles gérables. Les huit endpoints PHP réimplémentaient ce contrôle chacun à
 * leur façon — `toggle_user_status.php` vérifiait le rôle cible mais pas
 * l'établissement, ce qui permettait d'activer un compte d'un autre EFP en
 * connaissant son identifiant.
 *
 * Ces comptes sont créés déjà actifs et vérifiés : ils n'ont pas de parcours
 * d'inscription, c'est le directeur qui en répond.
 */

/** Adresse de repli quand le compte n'en a pas — reprise de create_user_account.php:82. */
function emailParDefaut(identifiant) {
  return `${identifiant.toLowerCase()}@placeholder.ofppt.ma`;
}

function estPlaceholder(email) {
  return email.endsWith('@placeholder.ofppt.ma');
}

export async function lister(etablissementId, { role, recherche, actif, page, parPage }) {
  const filtre = {
    etablissementIds: etablissementId,
    role: role ? role : { $in: ROLES_GERABLES },
  };
  if (actif) filtre.estActif = actif === 'oui';

  if (recherche) {
    const motif = new RegExp(recherche.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filtre.$or = [{ nomComplet: motif }, { email: motif }, { identifiant: motif }];
  }

  const [total, comptes] = await Promise.all([
    User.countDocuments(filtre),
    User.find(filtre)
      .sort({ role: 1, nomComplet: 1 })
      .skip((page - 1) * parPage)
      .limit(parPage),
  ]);

  return {
    total,
    page,
    parPage,
    pages: Math.ceil(total / parPage) || 1,
    comptes: comptes.map(presenter),
  };
}

export async function creer(etablissementId, donnees) {
  const email = donnees.email || emailParDefaut(donnees.identifiant);

  const existant = await User.findOne({
    $or: [{ email }, { identifiant: donnees.identifiant }],
  });
  if (existant) {
    throw conflict("Un compte utilise déjà cet identifiant ou cette adresse", {
      code: 'COMPTE_EXISTANT',
    });
  }

  const compte = await User.create({
    nomComplet: donnees.nomComplet,
    identifiant: donnees.identifiant,
    email,
    motDePasse: donnees.motDePasse,
    role: donnees.role,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
    estActif: true,
    etablissementIds: [etablissementId],
  });

  return presenter(compte);
}

/**
 * Charge une cible en vérifiant qu'elle appartient bien à l'établissement et
 * qu'elle porte un rôle gérable. Tout passe par ici — c'est le point unique
 * d'isolation multi-établissement de ce module.
 */
async function chargerCible(etablissementId, compteId) {
  const compte = await User.findOne({
    _id: compteId,
    etablissementIds: etablissementId,
    role: { $in: ROLES_GERABLES },
  });

  // Message identique qu'il n'existe pas ou qu'il appartienne à un autre
  // établissement : sinon la réponse révèle l'existence de comptes voisins.
  if (!compte) throw notFound('Compte introuvable', { code: 'COMPTE_INCONNU' });
  return compte;
}

export async function definirActivation(etablissementId, compteId, actif) {
  const compte = await chargerCible(etablissementId, compteId);

  compte.estActif = actif;
  await compte.save();

  // Désactiver doit déconnecter tout de suite, pas à l'expiration du jeton.
  if (!actif) await RefreshToken.deleteMany({ utilisateurId: compte.id });

  return presenter(compte);
}

/**
 * Réinitialise le mot de passe.
 *
 * Deux cas, volontairement distincts :
 *   - adresse réelle → le mot de passe part par e-mail et n'est PAS renvoyé ;
 *   - adresse de remplissage (`@placeholder.ofppt.ma`) → il est renvoyé une
 *     fois, car aucun autre canal n'existe pour le transmettre au stagiaire.
 * Sans cette distinction, soit on expose inutilement des secrets, soit on rend
 * la réinitialisation inopérante pour la majorité des comptes.
 */
export async function reinitialiserMotDePasse(etablissementId, compteId) {
  const compte = await chargerCible(etablissementId, compteId);

  const provisoire = `Aa1${crypto.randomBytes(6).toString('base64url')}`;
  compte.motDePasse = provisoire;
  await compte.save();
  await RefreshToken.deleteMany({ utilisateurId: compte.id });

  if (estPlaceholder(compte.email)) {
    return { aTransmettre: true, motDePasse: provisoire };
  }

  await envoyerEmail({
    destinataire: compte.email,
    sujet: 'Votre mot de passe EDT Pro a été réinitialisé',
    raison:
      'Vous recevez ce message parce que le directeur de votre établissement a réinitialisé votre mot de passe.',
    texte:
      `Bonjour ${compte.nomComplet},\n\n` +
      `Le directeur de votre établissement vient de réinitialiser votre mot de passe.\n\n` +
      `${provisoire}\n\n` +
      `Changez-le dès votre prochaine connexion.\n\nL'équipe EDT Pro`,
  });

  return { aTransmettre: false };
}

/*
 * ⚠️ UN COMPTE SUPPRIMÉ QUITTE AUSSI LES PARTAGES (2026-09-12). Sans cela, son
 * identifiant restait dans la liste des invités d'une page : sans effet — plus
 * aucun compte ne le porte — mais c'est une ligne morte que chaque contrôle de
 * droit relit, et la boîte « Partager » devait penser à l'écarter. Constaté sur
 * les données réelles : un formateur supprimé puis recréé laissait sa première
 * invitation derrière lui.
 */
const retirerDesPartages = (ids) =>
  Partage.updateMany(
    { 'membres.utilisateurId': { $in: ids } },
    { $pull: { membres: { utilisateurId: { $in: ids } } } }
  );

export async function supprimer(etablissementId, compteId) {
  const compte = await chargerCible(etablissementId, compteId);
  await Promise.all([
    RefreshToken.deleteMany({ utilisateurId: compte.id }),
    CodeVerification.deleteMany({ utilisateurId: compte.id }),
    retirerDesPartages([compte._id]),
  ]);
  await compte.deleteOne();
}

/**
 * Suppression en lot, par identifiants ou par rôle entier.
 * ← delete_bulk_users.php
 */
export async function supprimerEnLot(etablissementId, { ids, role }, demandeur) {
  const filtre = {
    etablissementIds: etablissementId,
    role: { $in: ROLES_GERABLES },
    // Garde-fou de l'existant conservé : ne jamais s'auto-supprimer.
    _id: { $ne: demandeur.id },
  };

  if (ids) {
    filtre._id = { $in: ids, $ne: demandeur.id };
  } else if (role !== 'tous') {
    filtre.role = role;
  }

  const cibles = await User.find(filtre).select('_id');
  if (cibles.length === 0) {
    throw badRequest('Aucun compte correspondant', { code: 'AUCUNE_CIBLE' });
  }

  const cibleIds = cibles.map((c) => c._id);
  await Promise.all([
    RefreshToken.deleteMany({ utilisateurId: { $in: cibleIds } }),
    CodeVerification.deleteMany({ utilisateurId: { $in: cibleIds } }),
    retirerDesPartages(cibleIds),
  ]);
  const resultat = await User.deleteMany({ _id: { $in: cibleIds } });

  return { supprimes: resultat.deletedCount };
}

function presenter(compte) {
  return {
    id: compte.id,
    nomComplet: compte.nomComplet,
    identifiant: compte.identifiant,
    email: compte.email,
    emailFictif: estPlaceholder(compte.email),
    role: compte.role,
    estActif: compte.estActif,
    derniereConnexion: compte.derniereConnexion,
    creeLe: compte.createdAt,
  };
}

export { ROLES as ROLES_UTILISATEUR };

/* ══════════════════════════════════════════════════════════════════════════
 * CRÉATION EN MASSE DEPUIS LA BASE — ← api/session/create_user_account.php
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Personnes de la base pouvant recevoir un compte, avec l'état de leur compte.
 * ← get_formateurs.php + get_stagiaires.php
 *
 * ⚠️ La source diffère selon le rôle, et ce n'est pas un détail :
 *   FORMATEUR → `Base.formateurs`, alimenté par l'import e-note ou la carte.
 *   STAGIAIRE → collection `Stagiaire`, alimentée par l'import Konosys de la
 *               page Documents. Tant qu'il n'existe pas, la liste est vide —
 *               l'écran doit le DIRE, pas afficher un tableau vide.
 *
 * On renvoie `aDejaUnCompte` plutôt que de filtrer : le directeur doit voir qui
 * est déjà servi, sinon la liste rétrécit d'un import à l'autre sans qu'il
 * comprenne pourquoi. C'est ce que faisait « Sélectionner les nouveaux ».
 */
export async function candidats(etablissementId, anneeScolaire, role) {
  const personnes =
    role === ROLES.FORMATEUR
      ? await candidatsFormateurs(etablissementId, anneeScolaire)
      : await candidatsStagiaires(etablissementId, anneeScolaire);

  // Un seul aller-retour : `in` sur les identifiants, plutôt qu'une requête par
  // personne — l'existant en faisait une par ligne, dans une boucle.
  const existants = new Set(
    (
      await User.find({
        etablissementIds: etablissementId,
        role,
        identifiant: { $in: personnes.map((p) => p.identifiant) },
      }).select('identifiant')
    ).map((compte) => compte.identifiant)
  );

  return personnes.map((personne) => ({
    ...personne,
    aDejaUnCompte: existants.has(personne.identifiant),
  }));
}

async function candidatsFormateurs(etablissementId, anneeScolaire) {
  const base = await Base.findOne({ etablissementId, anneeScolaire });

  return (base?.formateurs ?? [])
    .filter((formateur) => String(formateur.matricule ?? '').trim() !== '')
    .map((formateur) => ({
      identifiant: String(formateur.matricule).trim(),
      nomComplet: formateur.nomComplet ?? '',
      email: formateur.email ?? '',
    }))
    .sort((a, b) => a.nomComplet.localeCompare(b.nomComplet, 'fr'));
}

/*
 * ⚠️ LA PRIORITÉ TS/FQ NE SE JOUE PLUS ICI — elle appartient à l'import Konosys.
 *
 * `create_user_account.php:88-100` dédoublonnait au moment de créer le compte :
 * en MySQL, un stagiaire figurait sur PLUSIEURS lignes de `stagiaires`, une par
 * groupe suivi (1 671 lignes pour ~995 personnes), et rattacher son compte à une
 * ligne « FQ » le reliait au mauvais groupe. D'où son
 * `ORDER BY (CASE WHEN niveau = 'FQ' THEN 1 ELSE 0 END)`.
 *
 * Le modèle Mongo a tranché autrement : `index({ etablissementId, anneeScolaire,
 * matricule }, { unique: true })` — UN document par stagiaire et par année. Le
 * dédoublonnage doit donc se
 * faire à l'ÉCRITURE, c'est-à-dire dans l'import Konosys de la page Documents,
 * qui devra choisir la ligne diplômante en collapsant les lignes du fichier.
 * Le refaire ici serait du code mort : l'index empêche le cas de se produire.
 *
 * ⚠️ À REPRENDRE quand cet import sera porté — sans cette règle, un stagieire
 * inscrit en FQ et en TS verra son compte rattaché au premier groupe rencontré.
 */
/*
 * ⚠️ LA BASE DE L'ANNÉE AFFICHÉE (2026-09-14) : il y a une base Konosys par
 * année, et un stagiaire de 2e année figure dans deux d'entre elles. Sans la
 * borne, il apparaîtrait deux fois dans la liste à cocher.
 */
async function candidatsStagiaires(etablissementId, anneeScolaire) {
  const stagiaires = await Stagiaire.find({ etablissementId, anneeScolaire })
    .select('matricule nom prenom email')
    .sort({ nom: 1, prenom: 1 });

  return stagiaires
    .filter((stagiaire) => String(stagiaire.matricule ?? '').trim() !== '')
    .map((stagiaire) => ({
      identifiant: String(stagiaire.matricule).trim(),
      nomComplet: `${stagiaire.nom ?? ''} ${stagiaire.prenom ?? ''}`.trim(),
      email: stagiaire.email ?? '',
    }));
}

/**
 * Crée les comptes des personnes sélectionnées.
 *
 * ═══ NI TRANSACTION UNIQUE, NI ARRÊT AU PREMIER ÉCHEC ═══
 * L'existant ouvrait UNE transaction autour des 995 insertions, avec un
 * `try/catch` par ligne qui avalait l'erreur sans la faire remonter : une
 * erreur non attrapée annulait les 994 comptes déjà créés. Ici chaque compte
 * est indépendant — c'est ce que le directeur attend d'un traitement de masse,
 * et cela rend l'opération REJOUABLE.
 *
 * Un identifiant déjà pris est IGNORÉ, pas une erreur (`$comptes_ignores`) :
 * relancer la création après un ajout de dix formateurs ne doit rien casser.
 */
export async function creerEnLot(etablissementId, anneeScolaire, { role, matricules, motDePasse }) {
  const disponibles = new Map(
    (await candidats(etablissementId, anneeScolaire, role)).map((p) => [p.identifiant, p])
  );

  const crees = [];
  const ignores = [];
  const echecs = [];

  for (const matricule of [...new Set(matricules)]) {
    const personne = disponibles.get(matricule);

    // Demandé mais absent de la base : ni créé, ni silencieusement passé sous
    // silence. C'est le cas d'une liste devenue obsolète dans l'onglet ouvert.
    if (!personne) {
      echecs.push({ identifiant: matricule, raison: 'Introuvable dans la base' });
      continue;
    }

    if (personne.aDejaUnCompte) {
      ignores.push(personne.identifiant);
      continue;
    }

    try {
      const compte = await creer(etablissementId, {
        nomComplet: personne.nomComplet || personne.identifiant,
        identifiant: personne.identifiant,
        email: personne.email,
        role,
        motDePasse,
      });
      crees.push(compte);
    } catch (erreur) {
      /*
       * ⚠️ Message CONTRÔLÉ, jamais `erreur.message` : `create_user_account.php`
       * renvoyait le message d'exception brut dans `errors[]`, avec ce qu'une
       * erreur PDO peut contenir. Le conflit est le seul cas attendu ici.
       */
      if (erreur?.code === 'COMPTE_EXISTANT' || erreur?.details?.code === 'COMPTE_EXISTANT') {
        ignores.push(personne.identifiant);
        continue;
      }

      echecs.push({ identifiant: personne.identifiant, raison: 'Création impossible' });
    }
  }

  return { crees, ignores, echecs };
}
