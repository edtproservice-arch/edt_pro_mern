import { ROLES } from 'shared/constants';
import { peutEcrire, peutRepondre } from 'shared/domain';
import { Message } from '../../models/Message.js';
import { User } from '../../models/User.js';
import { badRequest, forbidden, notFound } from '../../lib/httpError.js';

/**
 * Messagerie interne (F10).
 * ← api/messaging/*.php — 11 fichiers, 1 275 lignes
 *
 * ═══ CE QUI CHANGE PAR RAPPORT À L'EXISTANT ═══
 * 1. Les DROITS vivent dans `shared/domain` — une matrice, testée, au lieu des
 *    cinq branches de `send.php` avec leurs replis par e-mail.
 * 2. Le corps n'est PLUS échappé à l'écriture. `send.php` appliquait
 *    `htmlspecialchars` à l'entrée : les messages étaient stockés encodés
 *    (« l&#039;emploi ») et le restaient à jamais. React échappe à l'AFFICHAGE,
 *    ce qui est le bon endroit — c'est le constat §4.6 du plan.
 * 3. Un envoi à plusieurs destinataires crée UN document par personne, comme
 *    l'existant : chacun lit, répond et supprime le sien sans toucher aux
 *    autres.
 */

/** Ce qu'un écran a besoin de savoir d'un message. */
function presenter(message, correspondant, recu) {
  return {
    id: String(message._id),
    sujet: message.sujet,
    corps: message.corps,
    lu: message.lu,
    /*
     * ⚠️ « REÇU OU ENVOYÉ » NE SE DÉDUIT PAS DE LA BOÎTE. L'archive et la
     * corbeille mêlent les deux sens : un message que J'AI envoyé puis archivé
     * s'y affichait « Reçu ». C'est aussi ce champ qui décide si « marquer non
     * lu » a un sens — le drapeau `lu` n'appartient qu'au destinataire.
     */
    recu: Boolean(recu),
    reponseA: message.reponseA ? String(message.reponseA) : null,
    date: message.createdAt,
    /*
     * L'invitation à collaborer, quand le message en porte une : c'est elle qui
     * fait afficher « Accepter » et « Refuser ». Ni l'établissement ni l'année
     * ne repartent au client — le serveur les relit au moment de répondre.
     */
    invitation: message.invitation
      ? {
          pages: message.invitation.pages,
          droit: message.invitation.droit,
          // ⚠️ Rendu, sinon la carte ne peut dire que le droit le plus haut.
          droits: (message.invitation.droits ?? []).map(({ page, droit }) => ({ page, droit })),
          statut: message.invitation.statut,
        }
      : null,
    correspondant: correspondant
      ? {
          id: String(correspondant._id),
          nom: correspondant.nomComplet,
          role: correspondant.role,
        }
      : /*
         * ⚠️ UN COMPTE SUPPRIMÉ NE FAIT PAS DISPARAÎTRE SES MESSAGES. On rend un
         * correspondant nommé « Compte supprimé » plutôt que `null` : l'écran
         * afficherait sinon une ligne sans expéditeur, qu'on prendrait pour un
         * défaut.
         */
        { id: null, nom: 'Compte supprimé', role: null },
  };
}

/**
 * Boîte de réception ou messages envoyés.
 *
 * ⚠️ LA SUPPRESSION EST PAR CÔTÉ, comme dans l'existant : un message retiré de
 * ma boîte reste chez mon correspondant. Deux drapeaux, et le document ne
 * disparaît que lorsque les deux l'ont retiré.
 */
export async function lister(utilisateurId, { boite = 'reception', page = 1, taille = 25 } = {}) {
  const critere = critereDeBoite(utilisateurId, boite);

  const [messages, total] = await Promise.all([
    Message.find(critere)
      .sort({ createdAt: -1 })
      .skip((page - 1) * taille)
      .limit(taille)
      .lean(),
    Message.countDocuments(critere),
  ]);

  /*
   * ⚠️ LE CORRESPONDANT EST « L'AUTRE », PAS « L'EXPÉDITEUR ». La corbeille et
   * l'archive mêlent des messages REÇUS et ENVOYÉS : y afficher toujours
   * l'expéditeur ferait lire mon propre nom sur mes messages archivés. On
   * regarde donc, message par message, qui n'est pas moi.
   */
  const autre = (message) =>
    String(message.expediteurId) === String(utilisateurId)
      ? message.destinataireId
      : message.expediteurId;

  const identifiants = [
    ...new Set(
      messages.flatMap((message) =>
        message.brouillon
          ? (message.brouillonDestinataires ?? []).map(String)
          : [String(autre(message))]
      )
    ),
  ];

  /*
   * ⚠️ LES CORRESPONDANTS EN UNE SEULE REQUÊTE. Un `populate` par message
   * ferait 25 allers-retours pour une page — c'est la forme que prenait
   * `inbox.php`, avec sa jointure refaite ligne par ligne.
   */
  const comptes = new Map(
    (await User.find({ _id: { $in: identifiants } }).select('nomComplet role').lean()).map((u) => [
      String(u._id),
      u,
    ])
  );

  return {
    messages: messages.map((message) =>
      message.brouillon
        ? presenterBrouillon(message, comptes)
        : presenter(
            message,
            comptes.get(String(autre(message))),
            String(message.destinataireId) === String(utilisateurId)
          )
    ),
    total,
    page,
  };
}

/**
 * Un brouillon : il n'a pas UN correspondant mais une liste en attente.
 *
 * ⚠️ « SANS DESTINATAIRE » EST DIT EN TOUTES LETTRES. Une ligne vide à la place
 * du nom laisserait croire à un défaut d'affichage, alors que c'est l'état
 * normal d'un brouillon qu'on vient de commencer.
 */
function presenterBrouillon(message, comptes) {
  const noms = (message.brouillonDestinataires ?? [])
    .map((identifiant) => comptes.get(String(identifiant))?.nomComplet)
    .filter(Boolean);

  return {
    id: String(message._id),
    sujet: message.sujet,
    corps: message.corps,
    lu: true,
    brouillon: true,
    destinataires: (message.brouillonDestinataires ?? []).map(String),
    reponseA: message.reponseA ? String(message.reponseA) : null,
    date: message.updatedAt ?? message.createdAt,
    correspondant: {
      id: null,
      nom: noms.length > 0 ? noms.join(', ') : 'Sans destinataire',
      role: null,
    },
  };
}

/**
 * Le filtre d'une boîte.
 *
 * ═══ ⚠️ CINQ BOÎTES, TROIS ÉTATS ═══
 * Un message porte, DE CHAQUE CÔTÉ, deux drapeaux indépendants : archivé et
 * supprimé. La boîte se déduit de leur combinaison, elle n'est pas stockée —
 * un champ « dossier » aurait pu contredire les drapeaux, et il aurait fallu
 * les tenir cohérents à la main.
 *
 * ⚠️ SUPPRIMÉ L'EMPORTE SUR ARCHIVÉ : un message archivé puis mis à la corbeille
 * est dans la corbeille. L'ordre des conditions porte cette règle.
 */
function critereDeBoite(utilisateurId, boite) {
  if (boite === 'brouillons') {
    return { expediteurId: utilisateurId, brouillon: true };
  }

  if (boite === 'corbeille') {
    /*
     * ⚠️ LA CORBEILLE EST LA MIENNE, DES DEUX CÔTÉS. Un message que j'ai envoyé
     * puis retiré doit s'y retrouver aussi — sinon « supprimer » depuis les
     * envoyés ferait disparaître le message sans recours.
     */
    return {
      brouillon: false,
      $or: [
        { destinataireId: utilisateurId, supprimeParDestinataire: true },
        { expediteurId: utilisateurId, supprimeParExpediteur: true },
      ],
    };
  }

  if (boite === 'archive') {
    return {
      brouillon: false,
      $or: [
        { destinataireId: utilisateurId, archiveParDestinataire: true, supprimeParDestinataire: false },
        { expediteurId: utilisateurId, archiveParExpediteur: true, supprimeParExpediteur: false },
      ],
    };
  }

  if (boite === 'envoyes') {
    return {
      expediteurId: utilisateurId,
      brouillon: false,
      supprimeParExpediteur: false,
      archiveParExpediteur: false,
    };
  }

  return {
    destinataireId: utilisateurId,
    brouillon: false,
    supprimeParDestinataire: false,
    archiveParDestinataire: false,
  };
}

/** Le compteur du menu. */
export async function compterNonLus(utilisateurId) {
  return Message.countDocuments({ ...critereDeBoite(utilisateurId, 'reception'), lu: false });
}

/**
 * Ce que chaque boîte contient — les chiffres de la colonne de gauche.
 *
 * ⚠️ RÉCEPTION COMPTE LES NON LUS, les autres leur TOTAL. C'est ce que dit la
 * maquette, et c'est juste : sur la boîte de réception, ce qu'on veut savoir
 * c'est ce qui reste à traiter ; sur les brouillons ou la corbeille, c'est ce
 * qui s'y trouve.
 */
export async function compterBoites(utilisateurId) {
  const [reception, brouillons, corbeille, archive] = await Promise.all([
    compterNonLus(utilisateurId),
    Message.countDocuments(critereDeBoite(utilisateurId, 'brouillons')),
    Message.countDocuments(critereDeBoite(utilisateurId, 'corbeille')),
    Message.countDocuments(critereDeBoite(utilisateurId, 'archive')),
  ]);

  return { reception, brouillons, corbeille, archive };
}

/**
 * Ouvre un message, et le marque lu.
 *
 * ⚠️ SEUL LE DESTINATAIRE LE MARQUE LU. Ouvrir un message qu'on a ENVOYÉ ne doit
 * pas le faire passer pour lu chez l'autre — `read.php` ne s'en gardait pas.
 */
export async function ouvrir(utilisateurId, id) {
  const { message, estDestinataire } = await mien(utilisateurId, id);

  if (estDestinataire && !message.lu) {
    message.lu = true;
    await message.save();
  }

  const autre = await User.findById(estDestinataire ? message.expediteurId : message.destinataireId)
    .select('nomComplet role')
    .lean();

  return presenter(message.toObject(), autre, estDestinataire);
}

/**
 * Remet un message reçu à l'état non lu.
 *
 * ⚠️ SEUL LE DESTINATAIRE LE PEUT : `lu` décrit SA lecture, et l'expéditeur n'en
 * a aucune. C'est la même règle que pour le marquage automatique à l'ouverture —
 * relire un message qu'on a envoyé ne le fait pas passer pour lu chez l'autre.
 *
 * ⚠️ L'ÉCRAN DOIT REFERMER LE MESSAGE ENSUITE, sinon la lecture suivante le
 * remarquerait lu aussitôt et le geste paraîtrait sans effet.
 */
export async function marquerNonLu(utilisateurId, id) {
  const { message, estDestinataire } = await mien(utilisateurId, id);

  if (!estDestinataire) {
    throw forbidden('Un message envoyé ne se marque pas non lu', { code: 'MESSAGE_ENVOYE' });
  }

  message.lu = false;
  await message.save();
  return { lu: false };
}

/**
 * Envoie un message à un ou plusieurs destinataires.
 *
 * ⚠️ UN REFUS EST UN REFUS, PAS UN SILENCE. `send.php` faisait `continue` sur
 * un destinataire non autorisé et répondait « envoyé » : on croyait avoir écrit
 * à cinq personnes, trois l'avaient reçu. Ici, ce qui n'est pas parti est NOMMÉ.
 */
/**
 * ⚠️ `invitation` N'EST PAS ACCESSIBLE PAR LA ROUTE : son schéma ne la déclare
 * pas, Zod la retire. Seul le service des partages la passe.
 */
export async function envoyer(expediteurId, { destinataires, sujet, corps, reponseA, invitation = null }) {
  const expediteur = await User.findById(expediteurId).select('role etablissementIds').lean();
  if (!expediteur) throw notFound('Compte introuvable', { code: 'COMPTE_INTROUVABLE' });

  const cibles = await User.find({ _id: { $in: destinataires }, estActif: true })
    .select('nomComplet role etablissementIds')
    .lean();

  /*
   * ⚠️ LE FIL EST VÉRIFIÉ, PAS CRU SUR PAROLE. `reponseA` vient du client :
   * sans ce contrôle, on rattacherait sa réponse à la conversation de
   * quelqu'un d'autre — et `peutRepondre` ouvrirait alors un droit d'écriture
   * qui n'existe pas.
   */
  const original = reponseA
    ? await Message.findOne({
        _id: reponseA,
        $or: [{ expediteurId }, { destinataireId: expediteurId }],
      }).lean()
    : null;

  const envoyes = [];
  const refuses = [];

  for (const identifiant of destinataires) {
    const cible = cibles.find((c) => String(c._id) === String(identifiant));

    if (!cible) {
      refuses.push({ id: identifiant, motif: 'Compte inconnu ou désactivé' });
      continue;
    }

    const aEcritAvant = Boolean(original) && String(original.expediteurId) === String(cible._id);
    const autorise = peutRepondre(
      { id: expediteurId, role: expediteur.role, etablissementIds: expediteur.etablissementIds },
      { id: cible._id, role: cible.role, etablissementIds: cible.etablissementIds },
      { aEcritAvant }
    );

    if (!autorise) {
      refuses.push({ id: String(cible._id), nom: cible.nomComplet, motif: 'Destinataire non autorisé' });
      continue;
    }

    envoyes.push({
      expediteurId,
      destinataireId: cible._id,
      sujet,
      corps,
      reponseA: original?._id ?? null,
      invitation,
    });
  }

  if (envoyes.length === 0) {
    throw badRequest('Aucun destinataire autorisé', { code: 'DESTINATAIRES_REFUSES', details: refuses });
  }

  await Message.insertMany(envoyes);

  return { envoyes: envoyes.length, refuses };
}

/**
 * Retire un message de SA propre vue.
 *
 * ⚠️ ON NE SUPPRIME JAMAIS LE DOCUMENT tant que l'autre le garde : effacer pour
 * les deux ferait disparaître un message de la boîte de quelqu'un qui ne l'a pas
 * demandé.
 */
export async function supprimer(utilisateurId, id) {
  const { message, estDestinataire, estExpediteur } = await mien(utilisateurId, id);

  if (estDestinataire) message.supprimeParDestinataire = true;
  if (estExpediteur) message.supprimeParExpediteur = true;

  // Les deux l'ont retiré : plus personne ne le voit, il n'a plus de raison
  // d'occuper la collection.
  if (message.supprimeParDestinataire && message.supprimeParExpediteur) {
    await message.deleteOne();
    return { supprime: true, definitif: true };
  }

  await message.save();
  return { supprime: true, definitif: false };
}

/**
 * Archive ou désarchive un message, de MON côté.
 *
 * ⚠️ ARCHIVER N'EST PAS SUPPRIMER : le message quitte la boîte de réception mais
 * reste consultable, et il revient d'un geste. C'est ce qui permet de vider sa
 * boîte sans rien perdre — et sans cela, « supprimer » deviendrait le seul
 * moyen de la ranger.
 */
export async function archiver(utilisateurId, id, archive = true) {
  const { message, estDestinataire, estExpediteur } = await mien(utilisateurId, id);

  if (estDestinataire) message.archiveParDestinataire = archive;
  if (estExpediteur) message.archiveParExpediteur = archive;

  await message.save();
  return { archive };
}

/**
 * Sort un message de la corbeille.
 *
 * ⚠️ C'EST L'EXACT INVERSE DE `supprimer`, et c'est pour cela que la corbeille
 * a du sens : sans restauration, elle ne serait qu'un cimetière consultable.
 */
export async function restaurer(utilisateurId, id) {
  const { message, estDestinataire, estExpediteur } = await mien(utilisateurId, id);

  if (estDestinataire) message.supprimeParDestinataire = false;
  if (estExpediteur) message.supprimeParExpediteur = false;

  await message.save();
  return { restaure: true };
}

/**
 * Un message, à condition qu'il soit le mien.
 *
 * ⚠️ ÉCRIT UNE FOIS : les quatre actions — ouvrir, supprimer, archiver,
 * restaurer — posent la même question, et quatre copies du contrôle auraient
 * fini par diverger. C'est le §4.2 appliqué à une garde d'accès.
 */
async function mien(utilisateurId, id) {
  const message = await Message.findById(id);
  if (!message) throw notFound('Message introuvable', { code: 'MESSAGE_INTROUVABLE' });

  const estDestinataire = String(message.destinataireId) === String(utilisateurId);
  const estExpediteur = String(message.expediteurId) === String(utilisateurId);

  if (!estDestinataire && !estExpediteur) {
    throw forbidden('Ce message ne vous est pas destiné', { code: 'MESSAGE_ETRANGER' });
  }

  return { message, estDestinataire, estExpediteur };
}

/**
 * Enregistre un brouillon — création ou mise à jour.
 *
 * ⚠️ UN BROUILLON N'EXIGE RIEN. Ni destinataire, ni sujet, ni corps : c'est un
 * travail en cours, et le contraindre reviendrait à interdire de s'interrompre.
 * Les contrôles s'appliquent à l'ENVOI, où ils ont un sens.
 */
export async function enregistrerBrouillon(utilisateurId, { id, destinataires = [], sujet = '', corps = '', reponseA }) {
  const champs = {
    expediteurId: utilisateurId,
    brouillon: true,
    brouillonDestinataires: destinataires,
    sujet,
    corps,
    reponseA: reponseA ?? null,
  };

  if (id) {
    const existant = await Message.findOneAndUpdate(
      { _id: id, expediteurId: utilisateurId, brouillon: true },
      { $set: champs },
      { new: true }
    );
    if (!existant) throw notFound('Brouillon introuvable', { code: 'BROUILLON_INTROUVABLE' });
    return { id: String(existant._id) };
  }

  const cree = await Message.create(champs);
  return { id: String(cree._id) };
}

/**
 * Supprime un brouillon.
 *
 * ⚠️ DÉFINITIVEMENT, SANS PASSER PAR LA CORBEILLE : un brouillon n'a jamais été
 * envoyé, personne d'autre ne l'a vu, et le garder « au cas où » encombrerait un
 * dossier qu'on ouvre justement pour reprendre un travail en cours.
 */
export async function supprimerBrouillon(utilisateurId, id) {
  const bilan = await Message.deleteOne({ _id: id, expediteurId: utilisateurId, brouillon: true });
  if (bilan.deletedCount === 0) {
    throw notFound('Brouillon introuvable', { code: 'BROUILLON_INTROUVABLE' });
  }
  return { supprime: true };
}

/**
 * À qui je peux écrire.
 *
 * ⚠️ LA LISTE VIENT DE LA MÊME RÈGLE QUE LE CONTRÔLE D'ENVOI. Deux définitions —
 * une pour proposer, une pour vérifier — divergeraient, et l'écran offrirait des
 * destinataires que le serveur refuse.
 */
export async function correspondants(utilisateurId) {
  const moi = await User.findById(utilisateurId).select('role etablissementIds').lean();
  if (!moi) throw notFound('Compte introuvable', { code: 'COMPTE_INTROUVABLE' });

  /*
   * On ne charge que les comptes des établissements de la personne — sauf pour
   * l'admin, qui n'en a aucun et joint tous les directeurs.
   */
  const critere = { _id: { $ne: utilisateurId }, estActif: true };
  if ((moi.etablissementIds ?? []).length > 0) {
    critere.etablissementIds = { $in: moi.etablissementIds };
  }

  /*
   * ⚠️ `email` REJOINT LA SÉLECTION (2026-09-03, demande du porteur : « comme
   * dans Gmail »). L'écran de rédaction affiche désormais l'adresse sous
   * chaque nom, exactement comme `CelluleUtilisateur` le fait déjà pour les
   * tableaux de l'administration — deux personnes homonymes de deux
   * établissements se distinguent par leur adresse, pas par leur seul nom.
   */
  const comptes = await User.find(critere)
    .select('nomComplet email role etablissementIds')
    .sort({ nomComplet: 1 })
    .lean();

  const admins =
    (moi.etablissementIds ?? []).length > 0
      ? await User.find({ role: ROLES.ADMIN, estActif: true })
          .select('nomComplet email role etablissementIds')
          .lean()
      : [];

  const tous =
    moi.role === ROLES.ADMIN ? await comptesSansTenant(utilisateurId) : [...comptes, ...admins];

  return tous
    .filter((cible) =>
      peutEcrire(
        { id: utilisateurId, role: moi.role, etablissementIds: moi.etablissementIds },
        { id: cible._id, role: cible.role, etablissementIds: cible.etablissementIds }
      )
    )
    .map((cible) => ({
      id: String(cible._id),
      nom: cible.nomComplet,
      email: cible.email,
      role: cible.role,
    }));
}

/** L'admin n'appartient à aucun établissement : sa liste n'est pas bornée. */
function comptesSansTenant(utilisateurId) {
  return User.find({ _id: { $ne: utilisateurId }, estActif: true })
    .select('nomComplet email role etablissementIds')
    .sort({ nomComplet: 1 })
    .lean();
}
