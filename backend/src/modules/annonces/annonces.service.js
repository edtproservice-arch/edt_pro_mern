import { ROLES } from 'shared/constants';
import { Annonce } from '../../models/Annonce.js';
import { Etablissement } from '../../models/Etablissement.js';
import { Message } from '../../models/Message.js';
import { User } from '../../models/User.js';
import { Base } from '../../models/Base.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { badRequest, forbidden, notFound } from '../../lib/httpError.js';
import { envoyer } from '../messagerie/messagerie.service.js';

/**
 * Les annonces du bandeau passant (2026-10-10, demande du porteur : « en admin
 * et gestionnaire, l'option d'écrire une note ou information — pour les
 * directeurs côté admin, pour les stagiaires côté gestionnaire — et le
 * directeur peut écrire aux formateurs ; avec un degré d'importance ; le même
 * message s'affiche aussi en messagerie automatiquement »).
 *
 * ⚠️ LA CIBLE SE DÉDUIT DU RÔLE DE L'AUTEUR (`CIBLE_PAR_ROLE`), jamais de la
 * requête : un gestionnaire ne peut pas « choisir » d'écrire aux directeurs.
 *
 * ⚠️ LA COPIE EN MESSAGERIE PASSE PAR `envoyer`, SANS EXCEPTION : la matrice
 * de la messagerie autorise déjà ces trois sens (admin → directeur, directeur →
 * formateur, gestionnaire → stagiaire). Une annonce n'ouvre donc aucun droit
 * que la messagerie n'accorde pas — et le destinataire peut y répondre.
 */
export const CIBLE_PAR_ROLE = {
  [ROLES.ADMIN]: ROLES.DIRECTEUR,
  [ROLES.DIRECTEUR]: ROLES.FORMATEUR,
  [ROLES.GESTIONNAIRE]: ROLES.STAGIAIRE,
};


/** « AAAA-MM-JJ » en heure LOCALE du serveur. */
export function aujourdhui(maintenant = new Date()) {
  const mois = String(maintenant.getMonth() + 1).padStart(2, '0');
  const jour = String(maintenant.getDate()).padStart(2, '0');
  return `${maintenant.getFullYear()}-${mois}-${jour}`;
}

function presenter(annonce, { auteur } = {}) {
  return {
    id: String(annonce._id),
    texte: annonce.texte,
    importance: annonce.importance,
    lien: annonce.lien ?? '',
    lienTitre: annonce.lienTitre ?? '',
    cible: annonce.cible,
    debut: annonce.debut,
    fin: annonce.fin,
    retiree: Boolean(annonce.retireeLe),
    remise: Boolean(annonce.remiseLe),
    matricules: annonce.matricules ?? [],
    groupes: annonce.groupes ?? [],
    destinataires: annonce.destinataires ?? 0,
    creeLe: annonce.createdAt,
    ...(auteur ? { auteur } : {}),
  };
}

/**
 * Publie une annonce et la remet, en message, à chacun de ses destinataires.
 * @param {{id: string, role: string}} auteur
 * @param {string|null} etablissementId — celui de la requête ; ignoré pour l'admin.
 */
export async function publier(
  auteur,
  etablissementId,
  { texte, importance = 'info', debut, fin, etablissementIds = [], matricules = [], groupes = [], lien = '', lienTitre = '' },
  anneeScolaire = null
) {
  const cible = CIBLE_PAR_ROLE[auteur.role];
  if (!cible) throw forbidden('Ce rôle ne publie pas d’annonce', { code: 'ROLE_SANS_ANNONCE' });

  const premier = debut || aujourdhui();
  if (fin < premier) throw badRequest('La fin précède le début', { code: 'DATES_INVERSEES' });

  const estAdmin = auteur.role === ROLES.ADMIN;
  if (!estAdmin && !etablissementId) throw forbidden('Établissement requis', { code: 'ETABLISSEMENT_REQUIS' });
  const visees = estAdmin ? etablissementIds : [etablissementId];

  // Les destinataires : comptes ACTIFS du rôle visé, dans les établissements visés (tous si vide — admin seulement).
  const filtre = { role: cible, estActif: true };
  if (visees.length > 0) filtre.etablissementIds = { $in: visees };

  // ⚠️ Le resserrement ne vaut que pour SA cible : un directeur ne filtre pas par groupe.
  const formateursVises = cible === ROLES.FORMATEUR ? [...new Set(matricules)] : [];
  const groupesVises = cible === ROLES.STAGIAIRE ? [...new Set(groupes)] : [];
  if (formateursVises.length > 0) filtre.identifiant = { $in: formateursVises };
  if (groupesVises.length > 0) {
    filtre.identifiant = { $in: await matriculesDesGroupes(etablissementId, anneeScolaire, groupesVises) };
  }
  const comptes = await User.find(filtre).select('_id').lean();

  const annonce = await Annonce.create({
    auteurId: auteur.id,
    roleAuteur: auteur.role,
    cible,
    etablissementIds: visees,
    matricules: formateursVises,
    groupes: groupesVises,
    texte,
    importance,
    lien,
    lienTitre: lien ? lienTitre : '',
    debut: premier,
    fin,
    destinataires: comptes.length,
    destinatairesIds: comptes.map((c) => c._id),
  });

  // Programmée : la copie en messagerie attendra son jour (`remettreAnnoncesProgrammees`).
  const remis = premier <= aujourdhui() ? await remettre(annonce) : 0;
  return { annonce: presenter(annonce), remis, programmee: premier > aujourdhui() };
}

/**
 * La copie en messagerie d'une annonce. ⚠️ PAR LOTS : un gestionnaire écrit
 * d'un coup à plusieurs centaines de stagiaires ; un échec n'y perd qu'un lot.
 * `remiseLe` est posé AVANT l'envoi : une tâche relancée ne doublerait jamais
 * la remise, au pire elle en manquerait un lot.
 */
async function remettre(annonce) {
  const marquee = await Annonce.findOneAndUpdate(
    { _id: annonce._id, remiseLe: null },
    { $set: { remiseLe: new Date() } },
    { new: true }
  ).lean();
  if (!marquee) return 0;

  const ids = (marquee.destinatairesIds ?? []).map(String);
  /* ⚠️ PLUS DE « [Urgent] » DANS LE SUJET : l'importance voyage dans `annonce`,
     et la messagerie la dessine en icône devant le sujet. */
  const sujet = `Annonce — ${resume(marquee.texte)}`;
  const corps = `${marquee.texte}\n\n(Annonce affichée dans votre bandeau jusqu'au ${dateFr(marquee.fin)}.)`;
  let remis = 0;
  for (let i = 0; i < ids.length; i += 200) {
    try {
      const bilan = await envoyer(String(marquee.auteurId), {
        destinataires: ids.slice(i, i + 200),
        sujet,
        corps,
        annonce: {
          id: String(marquee._id),
          importance: marquee.importance,
          // Le bouton « Ouvrir la page » du message, s'il y a une page liée.
          lien: marquee.lien ?? '',
          lienTitre: marquee.lienTitre ?? '',
        },
      });
      remis += bilan.envoyes;
    } catch {
      // Lot refusé (aucun destinataire autorisé) : les autres partent quand même.
    }
  }
  // ⚠️ RETIRÉE PENDANT LA REMISE : `retirer` a effacé les lots déjà partis, pas ceux d'après.
  if (!(await Annonce.exists({ _id: marquee._id }))) {
    await Message.deleteMany({ 'annonce.id': String(marquee._id) });
    return 0;
  }
  return remis;
}

/**
 * Remet en messagerie les annonces programmées dont le jour est venu — appelée
 * par la tâche horaire (`avisPeriodes.service.js`). Une annonce retirée avant
 * son début ne part jamais.
 */
export async function remettreAnnoncesProgrammees(maintenant = new Date()) {
  const jour = aujourdhui(maintenant);
  const dues = await Annonce.find({ remiseLe: null, retireeLe: null, debut: { $lte: jour }, fin: { $gte: jour } })
    .select('_id')
    .lean();
  let remis = 0;
  for (const annonce of dues) remis += await remettre(annonce);
  return { annonces: dues.length, remis };
}

/** Les annonces EN COURS pour le compte connecté — celles de son bandeau. */
export async function mesAnnonces(utilisateur, etablissementId, maintenant = new Date(), anneeScolaire = null) {
  if (!CIBLES_LECTRICES.includes(utilisateur.role)) return [];
  const jour = aujourdhui(maintenant);

  /* Le resserrement : vide = tous ; sinon, mon matricule (formateur) ou l'un de
     mes groupes (stagiaire) doit y figurer. */
  const resserrement = [];
  if (utilisateur.role === ROLES.FORMATEUR) {
    resserrement.push({ $or: [{ matricules: { $size: 0 } }, { matricules: String(utilisateur.identifiant ?? '') }] });
  }
  if (utilisateur.role === ROLES.STAGIAIRE) {
    const mesGroupes = await groupesDuMatricule(etablissementId, anneeScolaire, utilisateur.identifiant);
    resserrement.push({ $or: [{ groupes: { $size: 0 } }, { groupes: { $in: mesGroupes } }] });
  }

  const annonces = await Annonce.find({
    cible: utilisateur.role,
    retireeLe: null,
    debut: { $lte: jour },
    fin: { $gte: jour },
    // Vide = tout le réseau (annonce de l'administrateur aux directeurs).
    $and: [{ $or: [{ etablissementIds: { $size: 0 } }, { etablissementIds: etablissementId }] }, ...resserrement],
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  const auteurs = await User.find({ _id: { $in: annonces.map((a) => a.auteurId) } })
    .select('nomComplet role')
    .lean();
  const nomDe = (id) => auteurs.find((a) => String(a._id) === String(id));

  return annonces.map((annonce) =>
    presenter(annonce, {
      auteur: { nom: nomDe(annonce.auteurId)?.nomComplet ?? '', role: annonce.roleAuteur },
    })
  );
}

const CIBLES_LECTRICES = [ROLES.DIRECTEUR, ROLES.FORMATEUR, ROLES.STAGIAIRE];

/** Les annonces que J'AI publiées, les plus récentes d'abord. */
export async function mesPublications(auteurId) {
  // Les anciennes annonces « retirées » (avant leur suppression) ne s'affichent plus.
  const annonces = await Annonce.find({ auteurId, retireeLe: null }).sort({ createdAt: -1 }).limit(100).lean();
  return annonces.map((annonce) => presenter(annonce));
}

/**
 * Retire une annonce : elle est SUPPRIMÉE DÉFINITIVEMENT, avec toutes les
 * copies qu'elle a remises en messagerie (2026-11-06, demande du porteur :
 * « les annonces retirées doivent disparaître complètement, de la base et de
 * la messagerie »). Elle ne laisse donc plus de ligne « Retirée » dans la
 * liste de l'auteur.
 *
 * ⚠️ LES MESSAGES SONT EFFACÉS AVANT L'ANNONCE : si la seconde écriture
 * échouait, l'auteur verrait encore l'annonce et pourrait relancer le retrait
 * — l'inverse laisserait des copies orphelines que plus rien ne retrouve.
 *
 * ⚠️ Les RÉPONSES qu'un destinataire a pu écrire à la copie RESTENT : ce sont
 * ses propres mots, pas l'annonce.
 */
export async function retirer(auteurId, id) {
  const annonce = await Annonce.findOne({ _id: id, auteurId }).lean();
  if (!annonce) throw notFound('Annonce introuvable', { code: 'ANNONCE_INTROUVABLE' });
  const { messagesSupprimes } = await effacerAnnonces([annonce._id]);
  return { ...presenter(annonce), retiree: true, messagesSupprimes };
}

/**
 * Efface des annonces ET leurs copies en messagerie (`Message.annonce.id`,
 * posé par `remettre`). Partagé par le retrait et par le nettoyage des
 * annonces retirées avant ce changement (`scripts/migrations/…`).
 */
export async function effacerAnnonces(ids) {
  const cles = ids.map(String);
  if (cles.length === 0) return { annoncesSupprimees: 0, messagesSupprimes: 0 };
  const messages = await Message.deleteMany({ 'annonce.id': { $in: cles } });
  const annonces = await Annonce.deleteMany({ _id: { $in: ids } });
  return { annoncesSupprimees: annonces.deletedCount, messagesSupprimes: messages.deletedCount };
}

/**
 * Le nettoyage des annonces RETIRÉES avant le 2026-11-06 — quand le retrait
 * ne faisait que poser `retireeLe` et laissait les messages remis.
 * `appliquer: false` ne fait que compter.
 */
export async function nettoyerAnnoncesRetirees({ appliquer = false } = {}) {
  const retirees = await Annonce.find({ retireeLe: { $ne: null } }).select('_id').lean();
  const ids = retirees.map((a) => a._id);
  const messages = await Message.countDocuments({ 'annonce.id': { $in: ids.map(String) } });
  if (!appliquer) return { annonces: ids.length, messages, applique: false };
  const bilan = await effacerAnnonces(ids);
  return { annonces: bilan.annoncesSupprimees, messages: bilan.messagesSupprimes, applique: true };
}

/**
 * Les choix proposés à l'auteur pour resserrer sa cible :
 *   - directeur → les formateurs de la base de l'année ;
 *   - gestionnaire → les groupes (avec leur mode, pour filtrer Alterné / Résidentiel).
 */
export async function choix(role, etablissementId, anneeScolaire) {
  const base = await Base.findOne({ etablissementId, anneeScolaire }).select('formateurs groupes groupeModes').lean();
  if (role === ROLES.DIRECTEUR) {
    return (base?.formateurs ?? [])
      .filter((f) => f.matricule)
      .map((f) => ({ valeur: String(f.matricule), libelle: f.nomComplet || String(f.matricule) }))
      .sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr'));
  }
  if (role === ROLES.GESTIONNAIRE) {
    const modes = base?.groupeModes ?? {};
    return (base?.groupes ?? []).map((g) => ({ valeur: g, libelle: g, mode: modes[g] || 'Résidentiel' }));
  }
  return [];
}

/** Les matricules des stagiaires inscrits à l'un des `groupes` (année consultée, sinon toutes). */
async function matriculesDesGroupes(etablissementId, anneeScolaire, groupes) {
  let fiches = anneeScolaire
    ? await Stagiaire.find({ etablissementId, anneeScolaire, groupes: { $in: groupes } }).select('matricule').lean()
    : [];
  if (fiches.length === 0) {
    fiches = await Stagiaire.find({ etablissementId, groupes: { $in: groupes } }).select('matricule').lean();
  }
  return [...new Set(fiches.map((f) => f.matricule).filter(Boolean))];
}

/** Les groupes d'un stagiaire, à partir de son matricule — la règle de `groupesDuStagiaire`. */
async function groupesDuMatricule(etablissementId, anneeScolaire, matricule) {
  if (!matricule) return [];
  const fiche =
    (anneeScolaire && (await Stagiaire.findOne({ etablissementId, anneeScolaire, matricule }).select('groupes').lean())) ||
    (await Stagiaire.findOne({ etablissementId, matricule }).sort({ anneeScolaire: -1 }).select('groupes').lean());
  return fiche?.groupes ?? [];
}

/**
 * Les établissements que l'administrateur peut viser.
 *
 * ⚠️ REGROUPÉS PAR NOM (2026-10-10, signalé par le porteur : « il s'affiche
 * l'établissement en double ») : un même établissement peut exister en
 * plusieurs fiches — un compte directeur par fiche, ou une fiche par année.
 * La liste n'en montre qu'UNE ligne, et la cocher vise TOUTES ses fiches
 * (`ids`) : sinon une annonce n'atteindrait que l'un de ses directeurs.
 */
export async function etablissementsVisables() {
  const liste = await Etablissement.find().select('nom region complexe').lean();
  const parNom = new Map();
  for (const etablissement of liste) {
    const nom = String(etablissement.nom ?? '').trim();
    if (!nom) continue;
    const cle = nom.toLocaleUpperCase('fr').replace(/\s+/g, ' ');
    if (!parNom.has(cle)) {
      parNom.set(cle, { cle, nom, ids: [], detail: [etablissement.complexe, etablissement.region].filter(Boolean).join(' · ') });
    }
    parNom.get(cle).ids.push(String(etablissement._id));
  }
  return [...parNom.values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

const resume = (texte) => {
  const ligne = String(texte).replace(/\s+/g, ' ').trim();
  return ligne.length > 60 ? `${ligne.slice(0, 57)}…` : ligne;
};

const dateFr = (jour) => {
  const [annee, mois, date] = String(jour).split('-');
  return `${date}/${mois}/${annee}`;
};
