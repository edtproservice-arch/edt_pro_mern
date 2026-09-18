import crypto from 'node:crypto';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';
import { User } from '../../models/User.js';
import { Etablissement } from '../../models/Etablissement.js';
import { RefreshToken } from '../../models/RefreshToken.js';
import { CodeVerification } from '../../models/CodeVerification.js';
import { Partage } from '../../models/Partage.js';
import { ACTIONS_AUDIT, tracer } from '../../models/AuditLog.js';
import { badRequest, notFound } from '../../lib/httpError.js';
import { envoyerEmail } from '../../config/mailer.js';
import { creerRefreshToken, signerAccessToken } from '../auth/tokens.js';

/**
 * Administration des comptes (F15).
 * ← api/admin/get_all_users.php, get_pending_users.php, approve_user.php,
 *   update_user_status.php, reset_user_password.php, get_user_stats.php
 *
 * Ces six endpoints PHP refaisaient chacun leur propre contrôle de rôle. Ici le
 * contrôle est fait une fois, par `requireRole('admin')` au montage des routes.
 */

/**
 * La liste des comptes, filtrable.
 *
 * ═══ LES FILTRES D'ACTIVITÉ ═══ ← la barre du tableau « Activité et Temps Passé
 * par Utilisateur » de `admin_dashboard.html` (demande du porteur, 2026-09-02).
 *
 * ⚠️ ILS SONT APPLIQUÉS EN BASE, PAS DANS LE NAVIGATEUR. L'existant chargeait
 * TOUS les comptes puis filtrait en JavaScript — 1 078 lignes à chaque ouverture
 * de l'onglet, et une pagination impossible.
 */
export async function listerUtilisateurs({
  statut,
  role,
  recherche,
  activite,
  actif,
  connexion,
  tempsMin,
  tri,
  etablissement,
  page,
  parPage,
}) {
  const filtre = {};
  if (statut) filtre.statut = statut;
  if (role) filtre.role = role;
  if (actif) filtre.estActif = actif === 'oui';
  /*
   * ⚠️ `etablissementIds` EST UN TABLEAU, et Mongo compare alors CHAQUE élément :
   * un directeur qui gère deux établissements ressort sous l'un comme sous
   * l'autre. C'est ce qu'on veut — il travaille bien dans les deux.
   */
  if (etablissement) filtre.etablissementIds = etablissement;

  /*
   * ⚠️ « EN LIGNE » EST UNE FENÊTRE DE TEMPS, pas un drapeau : elle se calcule à
   * l'instant de la requête. « Hors ligne » comprend donc AUSSI ceux qui n'ont
   * jamais eu d'activité — sinon la somme des deux filtres ne ferait pas le
   * total, et on chercherait longtemps les manquants.
   */
  const seuil = new Date(Date.now() - SEUIL_EN_LIGNE_MS);
  if (activite === 'en_ligne') {
    filtre.derniereActivite = { $gte: seuil };
  } else if (activite === 'hors_ligne') {
    filtre.$or = [{ derniereActivite: null }, { derniereActivite: { $lt: seuil } }];
  }

  if (connexion === 'jamais') {
    filtre.derniereConnexion = null;
  } else if (connexion) {
    const jours = { aujourdhui: 1, '7j': 7, '30j': 30 }[connexion];
    if (jours) filtre.derniereConnexion = { $gte: new Date(Date.now() - jours * 86400 * 1000) };
  }

  /* En SECONDES, comme `tempsPasse`. */
  if (tempsMin) filtre.tempsPasse = { $gte: Number(tempsMin) };

  if (recherche) {
    // `escapeRegExp` : sans échappement, une recherche contenant « ( » ou « * »
    // ferait planter la requête, et un motif coûteux pourrait la bloquer.
    const motif = new RegExp(recherche.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const surLeNom = [{ nomComplet: motif }, { email: motif }];

    /*
     * ⚠️⚠️ `$or` EST DÉJÀ PRIS PAR « hors ligne » : l'écraser ici annulerait ce
     * filtre EN SILENCE, et une recherche rendrait des gens EN LIGNE dans une
     * liste qui prétend n'en montrer aucun. Les deux conditions se combinent
     * donc par `$and` — c'est un ET, pas un remplacement.
     */
    if (filtre.$or) {
      filtre.$and = [{ $or: filtre.$or }, { $or: surLeNom }];
      delete filtre.$or;
    } else {
      filtre.$or = surLeNom;
    }
  }

  /*
   * ⚠️ « EN LIGNE D'ABORD » EST LE TRI DE L'EXISTANT : on regarde d'abord qui
   * est là. À défaut d'un champ booléen, c'est `derniereActivite` décroissante
   * qui le donne — les plus récents sont précisément ceux qui sont en ligne.
   */
  const ORDRES = {
    activite: { derniereActivite: -1 },
    temps: { tempsPasse: -1 },
    connexion: { derniereConnexion: -1 },
    inscription: { createdAt: -1 },
  };
  const ordre = ORDRES[tri] ?? ORDRES.inscription;

  const [total, utilisateurs] = await Promise.all([
    User.countDocuments(filtre),
    User.find(filtre)
      .sort(ordre)
      .skip((page - 1) * parPage)
      .limit(parPage)
      /* Le nom de l'établissement, pour la colonne du tableau d'activité. */
      .populate('etablissementIds', 'nom'),
  ]);

  return {
    total,
    page,
    parPage,
    pages: Math.ceil(total / parPage) || 1,
    utilisateurs: utilisateurs.map(presenterPourAdmin),
  };
}

/**
 * Le fuseau du serveur — celui dans lequel les libellés de mois sont construits.
 * MongoDB doit découper les siens de la même façon, sinon les deux ne parlent
 * pas des mêmes journées.
 */
const FUSEAU = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * Au-delà de ce délai sans battement de cœur, la personne n'est plus « en
 * ligne ». ← `INTERVAL 75 SECOND` de `get_user_stats.php`.
 *
 * ⚠️ C'EST DEUX FOIS ET DEMIE LE PAS DU CLIENT (30 s) : un battement manqué ne
 * doit pas faire clignoter le badge, mais un onglet fermé doit s'éteindre vite.
 */
const SEUIL_EN_LIGNE_MS = 75 * 1000;

const estEnLigne = (derniereActivite) =>
  Boolean(derniereActivite) && Date.now() - new Date(derniereActivite).getTime() <= SEUIL_EN_LIGNE_MS;

/**
 * Les chiffres du parc de comptes.
 *
 * ═══ ⚠️ UNE SEULE AGRÉGATION, CROISÉE RÔLE × STATUT ═══
 * Les marginales — par rôle, par statut — s'en DÉDUISENT. Trois agrégations
 * séparées, c'est trois parcours de la collection et surtout trois vérités qui
 * peuvent diverger : c'est exactement ce qui a produit le défaut du 2026-09-02,
 * où le décompte par statut ne parlait pas de la même population que la liste
 * affichée à côté.
 *
 * ⚠️ `parStatutDirecteurs` EST À PART, ET SON NOM LE DIT : il alimente les
 * pastilles de l'écran « Directeurs », qui n'arbitre que ceux-là. `parStatut`,
 * lui, compte TOUT LE MONDE — c'est ce que demande la page « Statistiques ».
 */
export async function statistiques() {
  const maintenant = new Date();

  /*
   * ⚠️ ON REMONTE 11 MOIS EN ARRIÈRE, pas 12 : avec le mois courant, la série
   * en compte bien douze. Le `get_user_stats.php` d'origine faisait
   * `INTERVAL 12 MONTH` et en rendait treize.
   */
  const debutSerie = new Date(maintenant.getFullYear(), maintenant.getMonth() - 11, 1);

  const [croise, parMois, dernieresConnexions, enLigne, etablissementsServis] = await Promise.all([
    /*
     * ⚠️ TOUT CE QUI DÉCRIT LE PARC TIENT DANS CETTE SEULE AGRÉGATION, y compris
     * les comptes actifs, les essais et ceux qui ne se sont jamais connectés.
     * Autant de `countDocuments` séparés, ce serait autant de parcours de la
     * collection — et autant de vérités qui peuvent diverger.
     */
    User.aggregate([
      {
        $group: {
          _id: { role: '$role', statut: '$statut' },
          total: { $sum: 1 },
          actifs: { $sum: { $cond: ['$estActif', 1, 0] } },
          jamaisConnectes: { $sum: { $cond: [{ $eq: ['$derniereConnexion', null] }, 1, 0] } },
          essaisEnCours: { $sum: { $cond: [{ $gt: ['$essai.dateFin', maintenant] }, 1, 0] } },
          essaisDemandes: { $sum: { $cond: ['$essai.demande', 1, 0] } },
        },
      },
    ]),
    User.aggregate([
      { $match: { createdAt: { $gte: debutSerie } } },
      {
        $group: {
          /*
           * ⚠️⚠️ `timezone` EST INDISPENSABLE : sans elle, `$dateToString`
           * découpe les mois en UTC, alors que les libellés de la série sont
           * construits en heure LOCALE. Au Maroc (UTC+1), une inscription du
           * 1er septembre à 00 h 30 tomberait dans « 2026-08 » côté base et
           * « 2026-09 » côté série — elle disparaîtrait de la courbe. C'est le
           * décalage déjà corrigé sur les absences et l'objectif pédagogique,
           * ici à l'échelle du mois.
           */
          _id: {
            $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: FUSEAU },
          },
          total: { $sum: 1 },
        },
      },
    ]),
    /* Les huit dernières connexions — un signe de vie, pas un annuaire. */
    User.find({ derniereConnexion: { $ne: null } })
      .sort({ derniereConnexion: -1 })
      .limit(8)
      .select('nomComplet email role derniereConnexion'),
    /*
     * ⚠️ COMPTÉ À PART, PAS DANS L'AGRÉGATION CROISÉE : « en ligne » dépend de
     * l'INSTANT de la requête, pas d'un champ. Le glisser dans le `$group`
     * l'aurait figé au découpage rôle × statut, où il n'a rien à faire.
     */
    User.countDocuments({
      derniereActivite: { $gte: new Date(Date.now() - SEUIL_EN_LIGNE_MS) },
    }),
    /*
     * ═══ ⚠️ LES ÉTABLISSEMENTS QUI PORTENT DES COMPTES ═══ (demande du porteur,
     * 2026-09-02.) Le nombre BRUT avait été retiré la veille : il comptait des
     * cartes créées puis abandonnées — sept sur huit, sur le parc réel. Celui-ci
     * dit ceux qui SERVENT, et c'est enfin une mesure d'usage.
     *
     * ⚠️ IL PASSE PAR `listerEtablissements`, LA FONCTION DU FILTRE, plutôt que
     * par un comptage écrit ici : la carte annonce un nombre, et la liste
     * déroulante juste dessous propose exactement ces entrées-là. Deux calculs
     * parallèles finiraient par se contredire à l'écran — « 3 établissements »
     * au-dessus d'un menu qui en offre deux.
     */
    listerEtablissements(),
  ]);

  const parRoleEtStatut = croise.map(({ _id, ...compteurs }) => ({
    role: _id.role ?? 'inconnu',
    statut: _id.statut ?? 'inconnu',
    ...compteurs,
  }));

  const cumuler = (cle, lignes) =>
    lignes.reduce((acc, ligne) => {
      acc[ligne[cle]] = (acc[ligne[cle]] ?? 0) + ligne.total;
      return acc;
    }, {});

  const somme = (champ, lignes = parRoleEtStatut) =>
    lignes.reduce((n, ligne) => n + (ligne[champ] ?? 0), 0);

  const directeurs = parRoleEtStatut.filter((l) => l.role === ROLES.DIRECTEUR);
  const total = somme('total');

  return {
    total,
    /* Actifs et désactivés se déduisent l'un de l'autre : un seul est compté. */
    actifs: somme('actifs'),
    desactives: total - somme('actifs'),
    jamaisConnectes: somme('jamaisConnectes'),
    /* Un essai EN COURS n'est pas une DEMANDE d'essai : le premier court, la
       seconde attend une décision. L'existant ne montrait que le premier. */
    essaisEnCours: somme('essaisEnCours', directeurs),
    essaisEnAttente: somme(
      'essaisDemandes',
      directeurs.filter((l) => l.statut === STATUTS_COMPTE.EN_ATTENTE)
    ),
    parRole: cumuler('role', parRoleEtStatut),
    parStatut: cumuler('statut', parRoleEtStatut),
    parStatutDirecteurs: cumuler('statut', directeurs),
    parRoleEtStatut,
    inscriptionsParMois: serieMensuelle(parMois, debutSerie),
    dernieresConnexions: dernieresConnexions.map((u) => ({
      id: u.id,
      nomComplet: u.nomComplet,
      email: u.email,
      role: u.role,
      derniereConnexion: u.derniereConnexion,
    })),
    /*
     * ⚠️ LE NOMBRE D'ÉTABLISSEMENTS A ÉTÉ RETIRÉ (2026-09-02, demande du
     * porteur : « pas significatif »). Il comptait des cartes créées, dont
     * beaucoup n'ont jamais servi — il ne disait ni combien sont configurées ni
     * combien vivent. Ce qui reste utile de cette collection, c'est de pouvoir
     * FILTRER par établissement : voir `listerEtablissements`.
     */
    etablissementsAvecComptes: etablissementsServis.length,
    enLigne,
  };
}

/**
 * Les établissements, pour le filtre du tableau d'activité.
 * (demande du porteur, 2026-09-02.)
 *
 * ⚠️ ON REND LE NOMBRE DE COMPTES AVEC CHACUN : sans lui, la liste propose des
 * établissements qui ne rendront aucune ligne, et le filtre paraît cassé alors
 * qu'il dit vrai. C'est déjà la règle des facettes du produit — on ne propose
 * que ce qui existe, et on dit ce qu'on va trouver.
 *
 * ⚠️ UN SEUL `$group`, PAS UNE REQUÊTE PAR ÉTABLISSEMENT : le parc en compte
 * huit aujourd'hui, il en comptera cent. `$unwind` sur `etablissementIds` est ce
 * qui permet à un compte rattaché à deux établissements d'être compté dans les
 * deux.
 */
export async function listerEtablissements() {
  const [etablissements, comptes] = await Promise.all([
    Etablissement.find().select('nom').sort({ nom: 1 }),
    User.aggregate([
      { $unwind: '$etablissementIds' },
      { $group: { _id: '$etablissementIds', total: { $sum: 1 } } },
    ]),
  ]);

  const parEtablissement = new Map(comptes.map((c) => [String(c._id), c.total]));

  /*
   * ═══ ⚠️ ON NE PROPOSE QUE CE QUI RENDRA QUELQUE CHOSE ═══ (demande du
   * porteur, 2026-09-02.) Sur les huit établissements du parc réel, SEPT ne
   * portent aucun compte : ce sont des cartes créées puis abandonnées. Les
   * offrir dans un filtre, c'est proposer huit choix dont un seul fonctionne —
   * et les sept autres rendent une liste vide, qu'on met sur le dos du filtre.
   *
   * C'est la règle déjà tenue par les facettes des autres écrans : on ne propose
   * que ce qui existe.
   *
   * ⚠️ CONSÉQUENCE ASSUMÉE : un établissement dont tous les comptes viennent
   * d'être supprimés DISPARAÎT de la liste. C'est juste — il n'y a plus personne
   * à y filtrer — mais cela veut dire que cette liste ne fait pas l'inventaire
   * du parc. Elle sert la recherche de PERSONNES, pas la gestion des
   * établissements.
   */
  return etablissements
    .map((e) => ({ id: e.id, nom: e.nom, comptes: parEtablissement.get(e.id) ?? 0 }))
    .filter((e) => e.comptes > 0);
}

/**
 * Douze mois consécutifs, du plus ancien au plus récent.
 *
 * ═══ ⚠️ LES MOIS SANS INSCRIPTION DOIVENT VALOIR ZÉRO, PAS DISPARAÎTRE ═══
 * L'agrégation ne rend que les mois où quelqu'un s'est inscrit. Tracée telle
 * quelle, la courbe relierait juillet à octobre comme s'ils se suivaient, et un
 * creux de trois mois se lirait comme une progression régulière.
 */
function serieMensuelle(lignes, debut) {
  const parCle = new Map(lignes.map(({ _id, total }) => [_id, total]));
  const mois = [];

  for (let i = 0; i < 12; i += 1) {
    const date = new Date(debut.getFullYear(), debut.getMonth() + i, 1);
    /* ⚠️ CONSTRUIT À LA MAIN, PAS PAR `toISOString()` : celui-ci bascule en UTC
       et rendrait le mois précédent pour tout ce qui est à l'est de Greenwich —
       le décalage déjà corrigé sur les absences et l'objectif pédagogique. */
    const cle = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    mois.push({ mois: cle, total: parCle.get(cle) ?? 0 });
  }

  return mois;
}

/**
 * Change le statut d'un compte.
 *
 * Un blocage ou un rejet révoque immédiatement toutes les sessions : sans cela,
 * l'utilisateur resterait connecté jusqu'à l'expiration de son access token.
 * C'était le comportement de l'existant, où `update_user_status.php` ne touchait
 * pas à la table `sessions`.
 */
export async function changerStatut(utilisateurId, { statut, essaiJours }, administrateur) {
  const utilisateur = await User.findById(utilisateurId);
  if (!utilisateur) throw notFound('Compte introuvable', { code: 'COMPTE_INCONNU' });

  if (utilisateur.id === administrateur.id) {
    throw badRequest('Vous ne pouvez pas modifier votre propre statut', { code: 'AUTO_MODIFICATION' });
  }
  if (utilisateur.role === ROLES.ADMIN) {
    throw badRequest('Un compte administrateur ne peut pas être modifié ici', {
      code: 'CIBLE_ADMIN',
    });
  }

  utilisateur.statut = statut;

  if (statut === STATUTS_COMPTE.APPROUVE) {
    utilisateur.dateApprobation = new Date();
    utilisateur.dateBlocage = null;
    // Une approbation avec durée = période d'essai. Sans durée, accès illimité.
    utilisateur.essai = {
      demande: utilisateur.essai?.demande ?? false,
      dateFin: essaiJours ? new Date(Date.now() + essaiJours * 86_400_000) : null,
    };
  }
  if (statut === STATUTS_COMPTE.REJETE) utilisateur.dateRejet = new Date();
  if (statut === STATUTS_COMPTE.BLOQUE) utilisateur.dateBlocage = new Date();

  await utilisateur.save();

  if (statut !== STATUTS_COMPTE.APPROUVE) {
    await RefreshToken.deleteMany({ utilisateurId: utilisateur.id });
  }

  await notifier(utilisateur, statut, essaiJours);

  await tracer({
    acteur: administrateur,
    action: ACTIONS_AUDIT.STATUT_CHANGE,
    cible: utilisateur,
    details: { statut, essaiJours: essaiJours ?? null },
  });

  return presenterPourAdmin(utilisateur);
}

async function notifier(utilisateur, statut, essaiJours) {
  const messages = {
    [STATUTS_COMPTE.APPROUVE]: essaiJours
      ? `Votre compte EDT Pro est activé pour une période d'essai de ${essaiJours} jours.`
      : 'Votre compte EDT Pro a été approuvé. Vous pouvez vous connecter.',
    [STATUTS_COMPTE.REJETE]: "Votre demande d'accès à EDT Pro n'a pas été retenue.",
    [STATUTS_COMPTE.BLOQUE]: 'Votre accès à EDT Pro a été suspendu.',
  };

  const texte = messages[statut];
  if (!texte) return;

  await envoyerEmail({
    destinataire: utilisateur.email,
    sujet: 'EDT Pro — Statut de votre compte',
    texte: `Bonjour ${utilisateur.nomComplet},\n\n${texte}\n\nL'équipe EDT Pro`,
  });
}

/**
 * Réinitialise un mot de passe et renvoie le provisoire à l'utilisateur.
 *
 * Le mot de passe généré n'est PAS renvoyé dans la réponse HTTP : il part par
 * e-mail. `reset_user_password.php` l'affichait à l'écran de l'administrateur,
 * ce qui le faisait transiter par les journaux et l'historique du navigateur.
 */
export async function reinitialiserMotDePasse(utilisateurId) {
  const utilisateur = await User.findById(utilisateurId).select('+motDePasse');
  if (!utilisateur) throw notFound('Compte introuvable', { code: 'COMPTE_INCONNU' });

  // 12 caractères base64url : assez pour ne pas être devinable, sans caractère
  // ambigu à recopier.
  const provisoire = crypto.randomBytes(9).toString('base64url');

  utilisateur.motDePasse = `Aa1${provisoire}`; // respecte la politique de complexité
  await utilisateur.save();
  await RefreshToken.deleteMany({ utilisateurId: utilisateur.id });

  await envoyerEmail({
    destinataire: utilisateur.email,
    sujet: 'EDT Pro — Nouveau mot de passe',
    texte:
      `Bonjour ${utilisateur.nomComplet},\n\n` +
      `Votre mot de passe a été réinitialisé par un administrateur. ` +
      `Voici votre mot de passe provisoire :\n\n` +
      // ⚠️ SEUL SUR SON PARAGRAPHE : c'est ce qui le fait ressortir dans le
      // gabarit HTML, et ce qui le rend sélectionnable d'un geste en texte brut.
      // Collé à la phrase, il se recopiait avec la ponctuation qui le suit.
      `Aa1${provisoire}\n\n` +
      `Changez-le dès votre prochaine connexion.\n\nL'équipe EDT Pro`,
  });
}

/**
 * Ouvre une session à la place d'un utilisateur (support).
 *
 * ⚠️ Fonctionnalité sensible, encadrée par quatre garde-fous :
 *   - réservée au rôle `admin` (contrôlé au montage des routes) ;
 *   - IMPOSSIBLE sur un autre administrateur — sinon un admin compromis prend
 *     le contrôle de tous les autres ;
 *   - tracée dans `auditLogs`, avec l'IP ;
 *   - la session porte l'identité de l'usurpateur (`imp`), ce qui permet de
 *     l'afficher en permanence et de revenir au compte d'origine.
 */
export async function connecterEnTantQue(cibleId, administrateur, appareil, ip) {
  const cible = await User.findById(cibleId);
  if (!cible) throw notFound('Compte introuvable', { code: 'COMPTE_INCONNU' });

  if (cible.role === ROLES.ADMIN) {
    throw badRequest("Impossible de se connecter à la place d'un administrateur", {
      code: 'CIBLE_ADMIN',
    });
  }
  if (!cible.estActif) {
    throw badRequest('Ce compte est désactivé', { code: 'COMPTE_DESACTIVE' });
  }

  await tracer({
    acteur: administrateur,
    action: ACTIONS_AUDIT.USURPATION_DEBUT,
    cible,
    details: { role: cible.role, statut: cible.statut },
    ip,
  });

  return {
    utilisateur: presenterPourAdmin(cible),
    accessToken: signerAccessToken(cible, administrateur.id),
    refreshToken: await creerRefreshToken(cible, appareil, ip, administrateur.id),
  };
}

/**
 * ═══ COLLABORER AVEC L'ÉTABLISSEMENT D'UN COMPTE (2026-09-14) ═══
 * (demande du porteur : « l'admin peut aussi collaborer, invité par défaut sans
 * figurer dans la liste — un bouton à côté de “Se connecter” ».)
 *
 * À la différence de « Se connecter », l'administrateur agit en SON nom : les
 * collègues le voient « Administrateur » dans la pile d'avatars, et il n'a sur
 * les pages collaboratives que le droit d'un invité « peut modifier » — ni
 * publier, ni importer, ni partager, qui restent au directeur.
 *
 * ⚠️ L'ÉTABLISSEMENT EST CELUI DU COMPTE CHOISI, RELU EN BASE — jamais un
 * identifiant venu du client. Et il voyage dans le jeton (`col`), pas dans le
 * compte : l'admin ne devient membre d'aucun établissement.
 *
 * ⚠️ TRACÉ, comme l'usurpation : l'admin peut écrire dans l'emploi du temps d'un
 * établissement qui ne l'a pas invité.
 */
export async function collaborerAvec(cibleId, administrateur, appareil, ip) {
  const cible = await User.findById(cibleId);
  if (!cible) throw notFound('Compte introuvable', { code: 'COMPTE_INCONNU' });
  if (cible.role === ROLES.ADMIN) {
    throw badRequest("Un administrateur n'a pas d'établissement avec lequel collaborer", { code: 'CIBLE_ADMIN' });
  }

  const etablissement = cible.etablissementIds?.[0]
    ? await Etablissement.findById(cible.etablissementIds[0]).select('nom nomAbrege')
    : null;
  if (!etablissement) {
    throw badRequest("Ce compte n'est rattaché à aucun établissement", { code: 'ETABLISSEMENT_ABSENT' });
  }

  await tracer({
    acteur: administrateur,
    action: ACTIONS_AUDIT.COLLABORATION_DEBUT,
    cible,
    details: { etablissementId: etablissement.id, etablissement: etablissement.nom },
    ip,
  });

  return {
    etablissement: { id: etablissement.id, nom: etablissement.nomAbrege || etablissement.nom },
    accessToken: signerAccessToken(administrateur, null, etablissement.id),
    refreshToken: await creerRefreshToken(administrateur, appareil, ip, null, etablissement.id),
  };
}

/**
 * Suppression définitive d'un compte.
 *
 * MongoDB n'a pas de `ON DELETE CASCADE` : les dépendances doivent être
 * supprimées explicitement (réserve du plan §5). Sans cela, des jetons de
 * session et des établissements orphelins subsisteraient.
 */
export async function supprimerCompte(utilisateurId, administrateur, ip) {
  const cible = await User.findById(utilisateurId);
  if (!cible) throw notFound('Compte introuvable', { code: 'COMPTE_INCONNU' });

  if (cible.id === administrateur.id) {
    throw badRequest('Vous ne pouvez pas supprimer votre propre compte', {
      code: 'AUTO_SUPPRESSION',
    });
  }
  if (cible.role === ROLES.ADMIN) {
    throw badRequest('Un compte administrateur ne peut pas être supprimé ici', {
      code: 'CIBLE_ADMIN',
    });
  }

  // Établissements dont ce compte est propriétaire. Ils partent avec lui : un
  // établissement sans propriétaire serait inaccessible et invisible.
  const etablissements = await Etablissement.find({ proprietaireId: cible.id }).select('_id nom');

  await Promise.all([
    RefreshToken.deleteMany({ utilisateurId: cible.id }),
    CodeVerification.deleteMany({ utilisateurId: cible.id }),
    Etablissement.deleteMany({ proprietaireId: cible.id }),
    // Les partages de ses établissements partent avec eux ; et s'il était
    // invité ailleurs, il quitte ces listes.
    Partage.deleteMany({ etablissementId: { $in: etablissements.map((e) => e._id) } }),
    Partage.updateMany(
      { 'membres.utilisateurId': cible._id },
      { $pull: { membres: { utilisateurId: cible._id } } }
    ),
  ]);
  await cible.deleteOne();

  await tracer({
    acteur: administrateur,
    action: ACTIONS_AUDIT.COMPTE_SUPPRIME,
    cible,
    details: {
      role: cible.role,
      statut: cible.statut,
      etablissementsSupprimes: etablissements.map((e) => e.nom),
    },
    ip,
  });

  return { etablissementsSupprimes: etablissements.length };
}

function presenterPourAdmin(utilisateur) {
  return {
    id: utilisateur.id,
    nomComplet: utilisateur.nomComplet,
    email: utilisateur.email,
    telephone: utilisateur.telephone,
    role: utilisateur.role,
    statut: utilisateur.statut,
    estVerifie: utilisateur.estVerifie,
    estActif: utilisateur.estActif,
    essai: utilisateur.essai,
    dateInscription: utilisateur.createdAt,
    derniereConnexion: utilisateur.derniereConnexion,
    derniereActivite: utilisateur.derniereActivite,
    /* En SECONDES, comme la colonne `temps_passe` de l'existant. */
    tempsPasse: utilisateur.tempsPasse ?? 0,
    estEnLigne: estEnLigne(utilisateur.derniereActivite),
    nombreEtablissements: utilisateur.etablissementIds.length,
    /*
     * ⚠️ LES NOMS, PAS LES IDENTIFIANTS : la colonne « Établissement » du
     * tableau d'activité les affiche. `populate` ne les rend que si l'appelant
     * l'a demandé — sinon on retombe sur une liste vide plutôt que d'afficher
     * des identifiants Mongo.
     */
    etablissements: utilisateur.etablissementIds
      .map((e) => e?.nom)
      .filter((nom) => typeof nom === 'string'),
  };
}
