import { ROLES, STATUTS_COMPTE } from 'shared/constants';
import { anneeScolaireAPreparer } from 'shared/domain';
import { User } from '../../models/User.js';
import { Etablissement } from '../../models/Etablissement.js';
import { RefreshToken } from '../../models/RefreshToken.js';
import { ACTIONS_AUDIT, tracer } from '../../models/AuditLog.js';
import {
  CodeVerification,
  TYPES_CODE,
  genererCode,
  empreinteCode,
} from '../../models/CodeVerification.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../lib/httpError.js';
import { envoyerEmail } from '../../config/mailer.js';
import { creerRefreshToken, empreinte, signerAccessToken } from './tokens.js';

const DUREE_CODE_MS = 15 * 60 * 1000;

/**
 * Rôles dispensés du code « nouvel appareil » (décision du porteur, 2026-09-12).
 *
 * Leur adresse e-mail n'est souvent pas une vraie boîte : celle d'un formateur
 * est DÉDUITE de son nom (« prenom.nom@ofppt.ma », jamais vérifiée), celle d'un
 * stagiaire FABRIQUÉE à partir de son CEF (« cef@ofppt-edu.ma »). Le code
 * partait donc dans le vide, et la personne restait bloquée à la connexion
 * depuis son téléphone. Leur compte est de plus en consultation — il ne modifie
 * pas l'emploi du temps de l'établissement.
 *
 * ⚠️ L'ADMIN GARDE LA VÉRIFICATION, comme directeur et gestionnaire : c'est le
 * compte le plus sensible, il peut prendre la place de n'importe qui.
 */
const ROLES_SANS_VERIFICATION_APPAREIL = [ROLES.FORMATEUR, ROLES.STAGIAIRE];

/**
 * Logique d'authentification.
 *
 * Règle de couches (§10.1) : ce service ne connaît ni `req` ni `res`. Il reçoit
 * des valeurs et renvoie des valeurs — c'est ce qui le rend testable sans
 * serveur HTTP, à l'inverse des endpoints PHP.
 */

export async function inscrire(donnees) {
  const existant = await User.findOne({ email: donnees.email });
  if (existant) {
    throw conflict('Un compte existe déjà avec cette adresse e-mail', { code: 'EMAIL_EXISTANT' });
  }

  // L'inscription libre est réservée aux directeurs d'EFP. Les formateurs,
  // stagiaires et gestionnaires sont créés par leur directeur (module F12).
  const utilisateur = await User.create({
    nomComplet: donnees.nomComplet,
    email: donnees.email,
    telephone: donnees.telephone || null,
    motDePasse: donnees.motDePasse,
    role: ROLES.DIRECTEUR,
    statut: STATUTS_COMPTE.EN_ATTENTE,
    estVerifie: false,
  });

  const etablissement = await Etablissement.create({
    proprietaireId: utilisateur.id,
    region: donnees.region,
    complexe: donnees.complexe,
    nom: donnees.nomEtablissement,
    /*
     * L'année à PRÉPARER, pas celle en cours : un directeur qui s'inscrit en
     * août monte son établissement pour la rentrée. Cette règle vivait ici en
     * TROISIÈME exemplaire (`mois >= 8`), la variante PHP que le plan §4.2
     * donne pour cause n°1 d'instabilité — elle divergeait de la règle du
     * domaine sur les derniers jours d'août.
     */
    anneeScolaire: anneeScolaireAPreparer(),
  });

  utilisateur.etablissementIds = [etablissement.id];
  await utilisateur.save();

  await emettreCode(utilisateur, TYPES_CODE.EMAIL);

  return { utilisateur: presenter(utilisateur), etablissementId: etablissement.id };
}

/**
 * Connexion.
 *
 * Renvoie soit `{ action: 'verification_appareil' }` — appareil inconnu, un code
 * vient d'être envoyé —, soit les jetons. L'ordre des contrôles reprend celui de
 * login.php:79-129 pour ne pas modifier les messages vus par les utilisateurs.
 */
export async function connecter({ identifiant, motDePasse, appareil, ip }) {
  const utilisateur = await User.findOne({
    $or: [{ email: identifiant.toLowerCase() }, { identifiant }],
  }).select('+motDePasse');

  // Message identique que le compte n'existe pas ou que le mot de passe soit
  // faux : sinon l'API confirme l'existence d'une adresse.
  const erreurIdentifiants = unauthorized('Identifiant ou mot de passe incorrect', {
    code: 'IDENTIFIANTS_INVALIDES',
  });
  if (!utilisateur) throw erreurIdentifiants;

  const motDePasseValide = await utilisateur.verifierMotDePasse(motDePasse);
  if (!motDePasseValide) throw erreurIdentifiants;

  // Auto-blocage si l'essai est arrivé à terme. ← login.php:89-97
  if (utilisateur.statut === STATUTS_COMPTE.APPROUVE && utilisateur.essaiExpire()) {
    utilisateur.statut = STATUTS_COMPTE.BLOQUE;
    utilisateur.dateBlocage = new Date();
    await utilisateur.save();
  }

  if (!utilisateur.estActif) {
    throw forbidden('Votre compte a été désactivé. Contactez un administrateur.', {
      code: 'COMPTE_DESACTIVE',
    });
  }

  // Un directeur « en attente » peut se connecter pour demander un essai.
  const directeurEnAttente =
    utilisateur.role === ROLES.DIRECTEUR && utilisateur.statut === STATUTS_COMPTE.EN_ATTENTE;

  if (utilisateur.statut !== STATUTS_COMPTE.APPROUVE && !directeurEnAttente) {
    throw forbidden(
      utilisateur.statut === STATUTS_COMPTE.EN_ATTENTE
        ? "Votre compte est en attente d'approbation."
        : 'Votre compte a expiré. Contactez le service EDT Pro.',
      { code: 'COMPTE_NON_APPROUVE' }
    );
  }

  if (!utilisateur.estVerifie) {
    throw forbidden("Votre compte n'est pas encore vérifié.", { code: 'COMPTE_NON_VERIFIE' });
  }

  // Appareil inconnu → code de vérification, pas de jeton. Le premier appareil
  // est accepté d'office, sinon aucune connexion ne serait possible.
  // Formateurs et stagiaires en sont dispensés (cf. ROLES_SANS_VERIFICATION_APPAREIL).
  const verificationRequise = !ROLES_SANS_VERIFICATION_APPAREIL.includes(utilisateur.role);
  const appareilConnu = !verificationRequise || (await estAppareilConnu(utilisateur, appareil));
  if (!appareilConnu) {
    await emettreCode(utilisateur, TYPES_CODE.APPAREIL, { appareil, ip });
    return { action: 'verification_appareil', email: utilisateur.email };
  }

  return { action: 'connecte', ...(await ouvrirSession(utilisateur, appareil, ip)) };
}

async function estAppareilConnu(utilisateur, appareil) {
  const nombreAppareils = await RefreshToken.countDocuments({ utilisateurId: utilisateur.id });
  if (nombreAppareils === 0) return true;

  const connu = await RefreshToken.findOne({
    utilisateurId: utilisateur.id,
    'appareil.nom': appareil.nom,
    'appareil.navigateur': appareil.navigateur,
    'appareil.os': appareil.os,
  });
  return Boolean(connu);
}

async function ouvrirSession(utilisateur, appareil, ip) {
  utilisateur.derniereConnexion = new Date();
  utilisateur.derniereActivite = new Date();
  await utilisateur.save();

  return {
    utilisateur: presenter(utilisateur),
    accessToken: signerAccessToken(utilisateur),
    refreshToken: await creerRefreshToken(utilisateur, appareil, ip),
  };
}

/** Émet un code à 6 chiffres et l'envoie. Tout code antérieur du même type est invalidé. */
async function emettreCode(utilisateur, type, contexte = {}) {
  await CodeVerification.deleteMany({ utilisateurId: utilisateur.id, type });

  const code = genererCode();
  await CodeVerification.create({
    utilisateurId: utilisateur.id,
    type,
    empreinte: empreinteCode(code),
    appareil: contexte.appareil,
    ip: contexte.ip,
    expireLe: new Date(Date.now() + DUREE_CODE_MS),
  });

  // Un message qui ne contient qu'un code ressemble à un hameçonnage et part en
  // indésirable. Chaque type porte donc son contexte : ce qui vient de se
  // passer, ce que le destinataire doit faire, et quoi faire si ce n'est pas lui.
  const modeles = {
    [TYPES_CODE.EMAIL]: {
      sujet: 'Confirmez votre adresse e-mail EDT Pro',
      intro:
        "Votre compte directeur vient d'être créé sur EDT Pro. Pour l'activer, saisissez le code ci-dessous dans la page de vérification.",
      cloture:
        "Si vous n'avez pas créé de compte, ignorez ce message : aucune donnée ne sera conservée.",
      raison:
        'Vous recevez ce message parce que cette adresse a été utilisée pour créer un compte sur EDT Pro.',
    },
    [TYPES_CODE.APPAREIL]: {
      sujet: 'Nouvelle connexion à votre compte EDT Pro',
      intro:
        "Une connexion à votre compte vient d'être tentée depuis un appareil que nous ne reconnaissons pas. Saisissez ce code pour l'autoriser.",
      cloture:
        "Si ce n'est pas vous, ne communiquez ce code à personne et changez votre mot de passe sans attendre.",
      raison:
        'Vous recevez ce message parce que quelqu\'un tente de se connecter à votre compte EDT Pro.',
    },
    [TYPES_CODE.MOT_DE_PASSE]: {
      sujet: 'Réinitialisation de votre mot de passe EDT Pro',
      intro:
        'Vous avez demandé à changer votre mot de passe. Saisissez ce code pour définir le nouveau.',
      cloture:
        "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.",
      raison:
        'Vous recevez ce message parce qu\'une réinitialisation de mot de passe a été demandée pour ce compte.',
    },
  };

  const modele = modeles[type];

  await envoyerEmail({
    destinataire: utilisateur.email,
    sujet: modele.sujet,
    raison: modele.raison,
    texte:
      `Bonjour ${utilisateur.nomComplet},\n\n` +
      `${modele.intro}\n\n` +
      `${code}\n\n` +
      `Ce code est valable 15 minutes et ne fonctionne qu'une seule fois.\n\n` +
      `${modele.cloture}\n\n` +
      `L'équipe EDT Pro`,
  });

  return code;
}

/**
 * Renvoi d'un code. ← api/auth/resend_code.php
 *
 * Ne signale jamais si le compte existe — même raisonnement que pour la
 * réinitialisation : sans cela, l'endpoint permet d'énumérer les adresses.
 * `emettreCode` supprime la demande précédente, donc l'ancien code cesse
 * immédiatement de fonctionner et le compteur de tentatives repart à zéro.
 */
export async function renvoyerCode({ email, type, appareil, ip }) {
  const utilisateur = await User.findOne({ email: email.toLowerCase() });
  if (!utilisateur || !utilisateur.estActif) return;

  // Un compte déjà vérifié n'a pas à recevoir de nouveau code de vérification.
  if (type === TYPES_CODE.EMAIL && utilisateur.estVerifie) return;

  // Pour un appareil, on conserve le contexte de la demande initiale : c'est
  // lui qui sera autorisé, pas l'appareil qui clique sur « renvoyer ».
  const precedente = await CodeVerification.findOne({ utilisateurId: utilisateur.id, type });
  const contexte =
    type === TYPES_CODE.APPAREIL
      ? { appareil: precedente?.appareil?.nom ? precedente.appareil.toObject() : appareil, ip }
      : {};

  await emettreCode(utilisateur, type, contexte);
}

/** Valide un code. Consomme la demande en cas de succès. */
export async function verifierCode({ email, code, type, appareil, ip }) {
  const utilisateur = await User.findOne({ email: email.toLowerCase() });
  if (!utilisateur) throw notFound('Compte introuvable', { code: 'COMPTE_INCONNU' });

  const demande = await CodeVerification.findOne({ utilisateurId: utilisateur.id, type });
  if (!demande || demande.expireLe < new Date()) {
    throw badRequest('Code expiré ou inexistant. Demandez-en un nouveau.', { code: 'CODE_EXPIRE' });
  }

  if (demande.empreinte !== empreinteCode(code)) {
    demande.tentatives += 1;
    // Au-delà de 5 essais, la demande est détruite : un code à 6 chiffres se
    // devine sinon par balayage.
    if (demande.tentatives >= 5) await demande.deleteOne();
    else await demande.save();
    throw badRequest('Code incorrect', { code: 'CODE_INVALIDE' });
  }

  await demande.deleteOne();

  if (type === TYPES_CODE.EMAIL) {
    utilisateur.estVerifie = true;
    await utilisateur.save();
    return { action: 'email_verifie' };
  }

  const appareilAutorise = demande.appareil?.nom ? demande.appareil.toObject() : appareil;
  return { action: 'connecte', ...(await ouvrirSession(utilisateur, appareilAutorise, ip)) };
}

/**
 * Rotation du refresh token : l'ancien est révoqué et remplacé. Un jeton volé
 * ne reste donc utilisable que jusqu'au prochain rafraîchissement légitime.
 */
export async function rafraichir(jeton, appareil, ip) {
  if (!jeton) throw unauthorized('Session expirée', { code: 'REFRESH_ABSENT' });

  const enregistrement = await RefreshToken.findOne({ empreinte: empreinte(jeton) });
  if (!enregistrement || !enregistrement.estValide()) {
    throw unauthorized('Session expirée ou révoquée', { code: 'REFRESH_INVALIDE' });
  }

  const utilisateur = await User.findById(enregistrement.utilisateurId);
  if (!utilisateur || !utilisateur.estActif) {
    throw unauthorized('Compte indisponible', { code: 'COMPTE_INDISPONIBLE' });
  }

  await enregistrement.deleteOne();

  // L'usurpation survit au rafraichissement : sans cela, l'administrateur
  // perdrait le moyen de revenir a son compte au bout de 15 minutes.
  const impersonateurId = enregistrement.impersonateurId ?? null;
  // La collaboration aussi (2026-09-14) — pour un administrateur seulement : un
  // compte rétrogradé entre-temps la perd au premier rafraîchissement.
  const collaborationId =
    utilisateur.role === ROLES.ADMIN ? enregistrement.collaborationEtablissementId ?? null : null;

  return {
    utilisateur: presenter(utilisateur),
    accessToken: signerAccessToken(utilisateur, impersonateurId, collaborationId),
    refreshToken: await creerRefreshToken(
      utilisateur,
      appareil ?? enregistrement.appareil,
      ip,
      impersonateurId,
      collaborationId
    ),
  };
}

/**
 * Referme la collaboration d'un administrateur (2026-09-14) : la session
 * redevient celle de l'administration, sans établissement.
 *
 * ⚠️ L'ANCIENNE SESSION EST FERMÉE, comme au retour d'une usurpation : le refresh
 * token de la collaboration ne doit pas pouvoir la rouvrir.
 */
export async function quitterCollaboration(utilisateur, jetonCourant, appareil, ip) {
  if (utilisateur?.role !== ROLES.ADMIN || !utilisateur.$locals?.collaboration) {
    throw badRequest("Cette session n'est pas une collaboration", { code: 'PAS_COLLABORATION' });
  }
  const etablissementId = utilisateur.$locals.collaboration;
  if (jetonCourant) await RefreshToken.deleteOne({ empreinte: empreinte(jetonCourant) });

  await tracer({
    acteur: utilisateur,
    action: ACTIONS_AUDIT.COLLABORATION_FIN,
    details: { etablissementId },
    ip,
  });

  return {
    utilisateur: presenter(utilisateur),
    accessToken: signerAccessToken(utilisateur),
    refreshToken: await creerRefreshToken(utilisateur, appareil, ip),
  };
}

/** L'établissement avec lequel cet administrateur collabore — pour le bandeau. */
export async function collaborationPresentee(utilisateur) {
  const id = utilisateur?.$locals?.collaboration;
  if (!id) return null;
  const etablissement = await Etablissement.findById(id).select('nom nomAbrege').lean();
  return etablissement ? { etablissementId: id, nom: etablissement.nomAbrege || etablissement.nom } : null;
}

export async function deconnecter(jeton) {
  if (!jeton) return;
  await RefreshToken.deleteOne({ empreinte: empreinte(jeton) });
}

/**
 * Met fin à une session usurpée et rend la main à l'administrateur.
 *
 * L'identité de l'usurpateur vient du jeton (`imp`), pas du client : elle ne
 * peut donc pas être forgée. Son rôle est revérifié — s'il a été rétrogradé
 * entre-temps, le retour est refusé plutôt que de recréer un accès admin.
 */
export async function revenirAdmin(impersonateur, jetonCourant, appareil, ip) {
  if (!impersonateur) {
    throw badRequest("Cette session n'est pas une session déléguée", { code: 'PAS_USURPATION' });
  }
  if (impersonateur.role !== ROLES.ADMIN || !impersonateur.estActif) {
    throw forbidden("Le compte d'origine n'est plus administrateur", { code: 'ROLE_INSUFFISANT' });
  }

  // La session usurpée est fermée, pas seulement abandonnée.
  if (jetonCourant) await RefreshToken.deleteOne({ empreinte: empreinte(jetonCourant) });

  return {
    utilisateur: presenter(impersonateur),
    accessToken: signerAccessToken(impersonateur),
    refreshToken: await creerRefreshToken(impersonateur, appareil, ip),
  };
}

/**
 * Demande de réinitialisation de mot de passe.
 *
 * Ne signale JAMAIS qu'un compte existe ou non : l'appelant reçoit toujours la
 * même réponse. Sans cela, l'endpoint devient un oracle permettant d'énumérer
 * les adresses inscrites — ce que faisait `request_reset.php`, qui renvoyait un
 * message différent selon les cas.
 */
export async function demanderReinitialisation(email) {
  const utilisateur = await User.findOne({ email: email.toLowerCase() });
  if (utilisateur && utilisateur.estActif) {
    await emettreCode(utilisateur, TYPES_CODE.MOT_DE_PASSE);
  }
}

/**
 * Réinitialisation effective.
 *
 * Toutes les sessions existantes sont révoquées : si le compte avait été
 * compromis, changer le mot de passe doit déconnecter l'intrus. La table
 * `sessions` de l'existant n'était pas purgée dans ce cas.
 */
export async function reinitialiserMotDePasse({ email, code, motDePasse }) {
  const utilisateur = await User.findOne({ email: email.toLowerCase() }).select('+motDePasse');
  if (!utilisateur) throw badRequest('Code expiré ou inexistant', { code: 'CODE_EXPIRE' });

  const demande = await CodeVerification.findOne({
    utilisateurId: utilisateur.id,
    type: TYPES_CODE.MOT_DE_PASSE,
  });
  if (!demande || demande.expireLe < new Date()) {
    throw badRequest('Code expiré ou inexistant. Demandez-en un nouveau.', { code: 'CODE_EXPIRE' });
  }

  if (demande.empreinte !== empreinteCode(code)) {
    demande.tentatives += 1;
    if (demande.tentatives >= 5) await demande.deleteOne();
    else await demande.save();
    throw badRequest('Code incorrect', { code: 'CODE_INVALIDE' });
  }

  utilisateur.motDePasse = motDePasse; // le hook `pre('save')` le hache
  await utilisateur.save();

  await demande.deleteOne();
  await RefreshToken.deleteMany({ utilisateurId: utilisateur.id });
}

/**
 * Demande d'essai par un directeur en attente d'approbation.
 * ← api/auth/request_trial.php
 *
 * La demande est enregistrée ; c'est l'administrateur qui l'accorde en
 * approuvant le compte avec une durée (module admin).
 */
export async function demanderEssai(utilisateur) {
  if (utilisateur.statut === STATUTS_COMPTE.APPROUVE) {
    throw conflict('Votre compte est déjà approuvé', { code: 'DEJA_APPROUVE' });
  }
  if (utilisateur.essai?.demande) {
    throw conflict("Une demande d'essai est déjà en cours", { code: 'ESSAI_DEJA_DEMANDE' });
  }

  utilisateur.essai = { ...utilisateur.essai, demande: true };
  await utilisateur.save();
}

export async function listerAppareils(utilisateurId, jetonCourant) {
  const empreinteCourante = jetonCourant ? empreinte(jetonCourant) : null;
  const appareils = await RefreshToken.find({ utilisateurId }).sort({ derniereActivite: -1 });

  return appareils.map((a) => ({
    id: a.id,
    appareil: a.appareil,
    ip: a.ip,
    derniereActivite: a.derniereActivite,
    creeLe: a.createdAt,
    courant: a.empreinte === empreinteCourante,
  }));
}

/**
 * Révoque toutes les sessions SAUF celle en cours.
 * ← api/profile/revoke_all_sessions.php
 *
 * Le geste utile après un doute : on referme tout ce qui traîne ailleurs sans
 * se déconnecter soi-même de l'écran où l'on vient de le décider.
 */
export async function revoquerAutresAppareils(utilisateurId, jetonCourant) {
  const empreinteCourante = jetonCourant ? empreinte(jetonCourant) : null;

  const resultat = await RefreshToken.deleteMany({
    utilisateurId,
    ...(empreinteCourante ? { empreinte: { $ne: empreinteCourante } } : {}),
  });

  return { revoques: resultat.deletedCount ?? 0 };
}

export async function revoquerAppareil(utilisateurId, appareilId) {
  const resultat = await RefreshToken.deleteOne({ _id: appareilId, utilisateurId });
  if (resultat.deletedCount === 0) {
    throw notFound('Appareil introuvable', { code: 'APPAREIL_INCONNU' });
  }
}

/** Projection publique : ni hash, ni champs internes. */
/**
 * Changement de mot de passe par un utilisateur CONNECTÉ.
 * ← api/profile/change_password.php
 *
 * Trois différences avec le parcours « mot de passe oublié » :
 *   - le mot de passe ACTUEL est exigé : sans lui, un poste laissé ouvert
 *     suffirait à prendre le compte définitivement ;
 *   - les AUTRES sessions sont révoquées, pas toutes — on ne déconnecte pas
 *     quelqu'un de l'écran où il vient d'agir ;
 *   - aucun code n'est envoyé : l'identité est déjà établie par la session.
 *
 * @param {string} jetonCourant  Refresh token de la session en cours, épargné.
 */
export async function changerMotDePasse({ utilisateurId, actuel, nouveau, jetonCourant }) {
  const utilisateur = await User.findById(utilisateurId).select('+motDePasse');
  if (!utilisateur) throw notFound('Compte introuvable', { code: 'COMPTE_INCONNU' });

  if (!(await utilisateur.verifierMotDePasse(actuel))) {
    throw unauthorized('Mot de passe actuel incorrect', { code: 'MOT_DE_PASSE_INCORRECT' });
  }

  // Refuser un « changement » qui n'en est pas un : l'utilisateur croirait
  // avoir tourné la page alors que l'ancien mot de passe reste valable.
  if (await utilisateur.verifierMotDePasse(nouveau)) {
    throw badRequest("Le nouveau mot de passe doit différer de l'actuel", {
      code: 'MOT_DE_PASSE_IDENTIQUE',
    });
  }

  utilisateur.motDePasse = nouveau;
  await utilisateur.save();

  const empreinteCourante = jetonCourant ? empreinte(jetonCourant) : null;
  const revoques = await RefreshToken.deleteMany({
    utilisateurId: utilisateur.id,
    ...(empreinteCourante ? { empreinte: { $ne: empreinteCourante } } : {}),
  });

  return { appareilsRevoques: revoques.deletedCount ?? 0 };
}

/**
 * Modification des informations du profil (nom complet et e-mail).
 *
 * ⚠️⚠️ FORMATEUR ET STAGIAIRE N'Y ONT PAS DROIT (2026-09-05, demande du
 * porteur) : leur identité vient d'un IMPORT — `Base.formateurs` (e-note) ou
 * Konosys pour un stagiaire, cf. Phase 4 du plan — pas d'une inscription.
 * Le nom sert de CLÉ à la résolution d'affectations et de séances
 * (`shared/src/domain/formateurs`) ; l'e-mail est celui auquel partent les
 * identifiants de connexion créés en masse. Les laisser diverger de la carte
 * romprait exactement l'appariement que ces fonctions existent pour garantir
 * — la cause n°1 d'instabilité du §4.2, version « la personne se renomme
 * elle-même ». Directeur, gestionnaire et admin restent libres : leur
 * compte n'est rattaché à aucun import.
 */
export async function modifierProfil({ utilisateurId, nomComplet, email }) {
  const utilisateur = await User.findById(utilisateurId);
  if (!utilisateur) throw notFound('Compte introuvable', { code: 'COMPTE_INCONNU' });

  if (utilisateur.role === ROLES.FORMATEUR || utilisateur.role === ROLES.STAGIAIRE) {
    throw forbidden('Votre nom et votre e-mail sont gérés par votre établissement.', {
      code: 'PROFIL_NON_MODIFIABLE',
    });
  }

  if (email && email.toLowerCase() !== utilisateur.email.toLowerCase()) {
    const emailNettoye = email.toLowerCase().trim();
    const inexistant = await User.findOne({
      email: emailNettoye,
      _id: { $ne: utilisateurId },
    });
    if (inexistant) {
      throw badRequest('Cet e-mail est déjà utilisé par un autre compte', {
        code: 'EMAIL_DEJA_UTILISE',
      });
    }
    utilisateur.email = emailNettoye;
  }

  if (nomComplet && nomComplet.trim()) {
    utilisateur.nomComplet = nomComplet.trim();
  }

  await utilisateur.save();

  return presenter(utilisateur);
}

export function presenter(utilisateur) {
  return {
    id: utilisateur.id,
    nomComplet: utilisateur.nomComplet,
    email: utilisateur.email,
    /*
     * ⚠️ AJOUTÉ (2026-09-03) — DÉFAUT TROUVÉ SUR UN COMPTE FORMATEUR RÉEL :
     * « Mon emploi du temps » affichait une grille entièrement vide malgré des
     * séances bien réelles. `identifiant` (le matricule formateur / CEF
     * stagiaire) n'a jamais été exposé ici, faute d'avoir été nécessaire côté
     * client avant les sessions consultatives (F14) — le serveur, lui, le lit
     * directement sur `req.utilisateur`, d'où l'absence de toute erreur 401/403
     * qui aurait signalé le manque.
     *
     * `PageMonEmploi.jsx` construit `sujets = [utilisateur.identifiant]` pour
     * savoir QUELLE ligne isoler dans `GrilleDetaillee` — sans ce champ,
     * `sujets` valait `[undefined]`, et `assemblerConsultation` ne faisait
     * plus correspondre AUCUNE séance à un sujet inexistant : la grille se
     * vidait en silence, sans la moindre requête en erreur pour le signaler.
     * C'est aussi ce qui produisait le second symptôme — « Each child in a
     * list should have a unique "key" prop » — une clé `undefined` sur
     * l'unique élément de la liste.
     *
     * ⚠️ Ce n'est pas une donnée sensible à cacher : c'est le PROPRE
     * identifiant de connexion de la personne, au même titre que son e-mail,
     * déjà renvoyé juste au-dessus.
     */
    identifiant: utilisateur.identifiant,
    role: utilisateur.role,
    statut: utilisateur.statut,
    estVerifie: utilisateur.estVerifie,
    configurationTerminee: utilisateur.configurationTerminee,
    etablissementIds: utilisateur.etablissementIds,
  };
}

/**
 * Enregistre un battement de cœur. ← api/auth/heartbeat.php
 *
 * ⚠️ LE TEMPS AJOUTÉ EST CELUI QUI S'EST RÉELLEMENT ÉCOULÉ, borné par
 * `PAS_ACTIVITE_MAX`. L'existant ajoutait 30 s à chaque appel : trois onglets
 * ouverts comptaient trois fois le même temps, et un rechargement en ajoutait un
 * de plus. Mesuré, le total ne peut plus dépasser le temps réel.
 *
 * ⚠️ ET LE PREMIER BATTEMENT N'AJOUTE RIEN : sans activité antérieure, il n'y a
 * aucune durée à créditer — seulement un instant à poser.
 */
export async function enregistrerActivite(utilisateur) {
  const maintenant = new Date();
  const precedent = utilisateur.derniereActivite;

  const ecoule = precedent ? Math.floor((maintenant - precedent) / 1000) : 0;
  const ajout = Math.max(0, Math.min(ecoule, PAS_ACTIVITE_MAX));

  await User.updateOne(
    { _id: utilisateur.id },
    { $set: { derniereActivite: maintenant }, $inc: { tempsPasse: ajout } }
  );

  return { ajout };
}

/**
 * Le plus grand intervalle qu'un battement puisse créditer, en secondes.
 *
 * ⚠️ IL VAUT LE DOUBLE DU PAS DU CLIENT (30 s) : un battement manqué — onglet
 * masqué une seconde, réseau lent — ne doit pas faire perdre la période, mais
 * une absence d'une heure ne doit pas se compter comme du temps passé.
 */
const PAS_ACTIVITE_MAX = 60;
