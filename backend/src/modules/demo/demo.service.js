import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { JOURS, ROLES, STATUTS_COMPTE } from 'shared/constants';
import { SALLE_DISTANCIEL, anneeScolaireCourante, dateDuJour, jourFerie, semaineDansAnnee, vacances } from 'shared/domain';
import * as tousLesModeles from '../../models/index.js';
import { Annonce } from '../../models/Annonce.js';
import { HttpError, badRequest } from '../../lib/httpError.js';
import { logger } from '../../lib/logger.js';
import { DOMAINE_DEMO } from '../../lib/contexteDemo.js';
import { obtenirNationaux } from '../calendrier/joursFeries.service.js';
import { obtenir as obtenirCalendrierNational } from '../calendrierNational/calendrierNational.service.js';

/**
 * ═══ LA DÉMO PUBLIQUE : UN BAC À SABLE PAR VISITEUR (2026-11-01, demande du porteur) ═══
 * « Comme connecté, sans compte » : le visiteur choisit un rôle sur la page d'accueil, et
 * reçoit SA copie de l'établissement modèle (`modeleDemo`, données fictives — voir
 * `scripts/creer-modele-demo.js`). Il y fait tout ; la copie est effacée après 24 h.
 *
 * ⚠️ RIEN NE DOIT SE MÊLER AUX VRAIS ÉTABLISSEMENTS NI AUX AUTRES COPIES. Des requêtes
 *    retrouvent un formateur par son MATRICULE d'un établissement à l'autre : chaque copie
 *    reçoit donc ses propres matricules, identifiants, e-mails (`@demo.invalid`) et nom de
 *    complexe. Les e-mails et les notifications poussées sont coupés (`lib/contexteDemo`),
 *    les actions qui sortent de la copie fermées (`middleware/actionsDemo`).
 * ⚠️ LES SEMAINES SUIVENT LE CALENDRIER : le modèle a été construit autour d'une semaine
 *    de référence ; la copie décale semaines et dates pour tomber sur la semaine en cours.
 */

/** Les collections rattachées à UN établissement par `etablissementId`. ⚠️ Pas `Message` : un message
 *  appartient à ses comptes (expéditeur, destinataire) — il est traité à part. */
// `Annonce` n'est pas dans `models/index.js` : on l'ajoute ici.
const modeles = { ...tousLesModeles, Annonce };

const COLLECTIONS = [
  'Base',
  'Seance',
  'Stagiaire',
  'AbsenceFormateur',
  'AbsenceStagiaire',
  'IndisciplineStagiaire',
  'PvSanction',
  'AppelValidation',
  'AutoGenConfig',
  'Chronogramme',
  'DemandeDocument',
  'EnoteImport',
  'ModificationPage',
  'Partage',
  'Reaffectation',
  'TraceGeneration',
  'UnplacedSession',
];

export const ROLES_DEMO = [ROLES.DIRECTEUR, ROLES.FORMATEUR, ROLES.STAGIAIRE];
export const DUREE_DEMO_MS = 24 * 3600 * 1000;
/** Au-delà, on refuse plutôt que de remplir la base : une copie pèse un établissement entier. */
export const MAXIMUM_DEMOS_ACTIVES = 300;

const SEMAINE = /^(\d{4})-W(\d+)$/;
/** Une semaine écrite « S12 » (chronogrammes) : décalée comme les autres. */
const SEMAINE_COURTE = /^S(\d+)$/;
const JOUR_TEXTE = /^\d{4}-\d{2}-\d{2}$/;
/** Les champs qui portent une date en texte « AAAA-MM-JJ ». */
const DATES_TEXTE = new Set(['date', 'debut', 'fin']);
const JOUR_MS = 24 * 3600 * 1000;

/** La semaine scolaire en cours — celle sur laquelle la copie doit tomber. */
function semaineCourante(maintenant) {
  const annee = anneeScolaireCourante(maintenant);
  return { annee, numero: Math.max(1, semaineDansAnnee(annee, maintenant).numero) };
}

/**
 * Copie un document en remplaçant : les identifiants (nouveaux `_id`), les chaînes propres au
 * modèle (matricules, identifiants, adresses), les semaines « AAAA-Wn » (décalées) et les dates
 * (décalées d'autant de semaines). Les clés d'objet sont remplacées comme les valeurs : certains
 * `Map` sont indexés par matricule.
 */
function creerRemplacement({ ids, chaines, anneeModele, annee, decalage }) {
  const decalageMs = decalage * 7 * JOUR_MS;
  const remplacer = (valeur, cle) => {
    if (valeur instanceof mongoose.Types.ObjectId) return ids.get(String(valeur)) ?? valeur;
    if (valeur instanceof Date) return new Date(valeur.getTime() + decalageMs);
    if (Array.isArray(valeur)) return valeur.map((v) => remplacer(v, cle));
    if (valeur && typeof valeur === 'object') {
      const copie = {};
      for (const [k, v] of Object.entries(valeur)) copie[chaines.get(k) ?? k] = remplacer(v, k);
      return copie;
    }
    if (typeof valeur === 'string') {
      if (chaines.has(valeur)) return chaines.get(valeur);
      if (ids.has(valeur)) return String(ids.get(valeur));
      // Les dates écrites en texte (absences, annonces, périodes) suivent le même décalage.
      if (DATES_TEXTE.has(cle) && JOUR_TEXTE.test(valeur)) {
        return new Date(Date.parse(`${valeur}T12:00:00Z`) + decalageMs).toISOString().slice(0, 10);
      }
      const courte = cle === 'semaine' ? SEMAINE_COURTE.exec(valeur) : null;
      if (courte) return `S${Math.max(1, Number(courte[1]) + decalage)}`;
      const semaine = SEMAINE.exec(valeur);
      if (semaine && Number(semaine[1]) === anneeModele) return `${annee}-W${Math.max(1, Number(semaine[2]) + decalage)}`;
    }
    if (cle === 'anneeScolaire' && valeur === anneeModele) return annee;
    return valeur;
  };
  return remplacer;
}

/**
 * ═══ PAS DE COURS UN JOUR FÉRIÉ NI EN VACANCES (2026-11-02, signalé par le porteur : « il place
 * des séances en jour férié ») ═══ Les séances du modèle sont décalées vers la semaine du
 * visiteur : un jour ordinaire du modèle peut tomber, une fois décalé, sur la Marche verte ou en
 * vacances. Le tri se fait donc ICI, après décalage, avec le calendrier officiel de l'application
 * (fériés nationaux, vacances du calendrier national).
 *
 * ⚠️ UN CALENDRIER INJOIGNABLE NE BLOQUE PAS LA DÉMO : sans lui, on garde toutes les séances.
 */
async function jourSansCours(anneeScolaire) {
  const [feries, national] = await Promise.all([
    obtenirNationaux(anneeScolaire)
      .then((resultat) => resultat?.jours ?? [])
      .catch(() => []),
    obtenirCalendrierNational(anneeScolaire)
      .then((resultat) => resultat?.vacances ?? [])
      .catch(() => []),
  ]);
  return (date) => Boolean(date && (jourFerie(date, feries) || vacances(date, national)));
}

const CRENEAUX = ['S1', 'S2', 'S3', 'S4'];

/**
 * Les séances tombées un jour sans cours sont DÉPLACÉES, comme le ferait une direction : sur un
 * autre créneau de la même semaine où le formateur, le groupe et la salle sont libres. Ainsi le
 * volume de la semaine reste celui du chronogramme (« conforme »). Sa salle si elle est libre,
 * sinon une autre salle libre de l'établissement. Sans créneau libre, la séance est retirée. Le
 * samedi n'a que deux créneaux, comme dans le modèle.
 */
function deplacerHorsJoursSansCours(seances, sansCours) {
  const occupe = new Set();
  const salleReelle = (salle) => Boolean(salle) && salle.trim().toUpperCase() !== SALLE_DISTANCIEL;
  const prendre = (s, jour, seance, salle) =>
    [s.formateurMatricule, s.groupe, salleReelle(salle) ? salle : null]
      .filter(Boolean)
      .map((q) => `${s.semaine}|${jour}|${seance}|${q}`);
  const libre = (s, jour, seance, salle) => prendre(s, jour, seance, salle).every((cle) => !occupe.has(cle));
  // Les salles de l'établissement : celles qu'emploient ses séances.
  const salles = [...new Set(seances.map((s) => s.salle).filter(salleReelle))];

  const gardees = seances.filter((s) => !sansCours(s.date));
  for (const s of gardees) prendre(s, s.jour, s.seance, s.salle).forEach((c) => occupe.add(c));

  for (const s of seances.filter((x) => sansCours(x.date))) {
    let place = null;
    for (const jour of JOURS) {
      const date = dateDuJour(s.semaine, jour);
      if (sansCours(date)) continue;
      for (const creneau of CRENEAUX) {
        if (jour === 'Samedi' && creneau > 'S2') continue;
        // Sa salle si elle est libre, sinon une autre — à distance, pas de salle à trouver.
        const salle = !salleReelle(s.salle)
          ? s.salle
          : [s.salle, ...salles].find((candidate) => libre(s, jour, creneau, candidate));
        if (salle === undefined || !libre(s, jour, creneau, salle)) continue;
        place = { ...s, jour, seance: creneau, date, salle };
        break;
      }
      if (place) break;
    }
    if (!place) continue;
    prendre(place, place.jour, place.seance, place.salle).forEach((c) => occupe.add(c));
    gardees.push(place);
  }
  return gardees;
}

/** Le modèle et tout ce qui lui appartient, lu une fois. */
async function lireModele() {
  const etablissement = await modeles.Etablissement.findOne({ modeleDemo: true }).lean();
  if (!etablissement) return null;
  const parCollection = {};
  for (const nom of COLLECTIONS) {
    parCollection[nom] = await modeles[nom].find({ etablissementId: etablissement._id }).lean();
  }
  parCollection.Annonce = await modeles.Annonce.find({ etablissementIds: etablissement._id }).lean();
  const comptes = await modeles.User.find({ etablissementIds: etablissement._id, demo: true })
    .select('+motDePasse')
    .lean();
  const comptesIds = comptes.map((c) => c._id);
  parCollection.Message = await modeles.Message.find({
    $or: [{ expediteurId: { $in: comptesIds } }, { destinataireId: { $in: comptesIds } }],
  }).lean();
  return { etablissement, parCollection, comptes };
}

/**
 * Crée le bac à sable d'un visiteur et rend le compte du rôle choisi (document Mongoose).
 * @param {{role: string, maintenant?: Date}} options
 */
export async function creerBacASable({ role, maintenant = new Date() }) {
  if (!ROLES_DEMO.includes(role)) throw badRequest('Rôle de démonstration inconnu', { code: 'ROLE_DEMO_INCONNU' });

  const actives = await modeles.Etablissement.countDocuments({ demo: true });
  if (actives >= MAXIMUM_DEMOS_ACTIVES) {
    throw new HttpError(503, 'La démo est très demandée en ce moment. Réessayez dans quelques minutes.', {
      code: 'DEMO_SATUREE',
    });
  }

  const modele = await lireModele();
  if (!modele) {
    throw new HttpError(503, 'La démo n’est pas disponible pour le moment.', { code: 'DEMO_INDISPONIBLE' });
  }
  const { etablissement, parCollection, comptes } = modele;

  // ── Les correspondances ─────────────────────────────────────────────────
  const suffixe = crypto.randomBytes(3).toString('hex').toUpperCase();
  const ids = new Map();
  const nouvelId = (doc) => ids.set(String(doc._id), new mongoose.Types.ObjectId());
  nouvelId(etablissement);
  comptes.forEach(nouvelId);
  for (const docs of Object.values(parCollection)) docs.forEach(nouvelId);

  const chaines = new Map();
  const propre = (valeur) => `${valeur}-${suffixe}`;
  for (const base of parCollection.Base) {
    for (const f of base.formateurs ?? []) if (f.matricule) chaines.set(f.matricule, propre(f.matricule));
  }
  for (const s of parCollection.Stagiaire) if (s.matricule) chaines.set(s.matricule, propre(s.matricule));
  comptes.forEach((compte, i) => {
    if (compte.identifiant && !chaines.has(compte.identifiant)) chaines.set(compte.identifiant, propre(compte.identifiant));
    chaines.set(compte.email, `${compte.role}-${i + 1}-${suffixe.toLowerCase()}@${DOMAINE_DEMO}`);
  });

  const { annee, numero } = semaineCourante(maintenant);
  const reference = SEMAINE.exec(etablissement.demoSemaineReference ?? '');
  const decalage = reference ? numero - Number(reference[2]) : 0;
  const remplacer = creerRemplacement({ ids, chaines, anneeModele: etablissement.anneeScolaire, annee, decalage });
  const sansCours = await jourSansCours(annee);

  // ── L'établissement ─────────────────────────────────────────────────────
  const copieEtablissement = {
    ...remplacer(etablissement),
    complexe: `Démo ${suffixe}`,
    modeleDemo: false,
    demo: true,
    demoExpireLe: new Date(maintenant.getTime() + DUREE_DEMO_MS),
    demoSemaineReference: null,
    espacesMutualises: [],
  };
  const idEtablissement = copieEtablissement._id;

  try {
    await modeles.Etablissement.collection.insertOne(copieEtablissement);

    // ── Les comptes ───────────────────────────────────────────────────────
    const copiesComptes = comptes.map((compte) => ({
      ...remplacer(compte),
      demo: true,
      statut: STATUTS_COMPTE.APPROUVE,
      estVerifie: true,
      estActif: true,
      derniereConnexion: null,
      derniereActivite: null,
      tempsPasse: 0,
    }));
    if (copiesComptes.length) await modeles.User.collection.insertMany(copiesComptes);

    // ── Le reste ──────────────────────────────────────────────────────────
    for (const [nom, docs] of Object.entries(parCollection)) {
      let copies = docs.map((doc) => remplacer(doc));
      if (nom === 'Seance') copies = deplacerHorsJoursSansCours(copies, sansCours);
      // Une absence notée un jour férié n'a pas de sens : elle est retirée.
      if (nom === 'AbsenceStagiaire') copies = copies.filter((copie) => !sansCours(copie.date));
      if (copies.length) await modeles[nom].collection.insertMany(copies);
    }
  } catch (erreur) {
    await effacerBacASable(idEtablissement).catch(() => {});
    throw erreur;
  }

  const compte = await modeles.User.findOne({ etablissementIds: idEtablissement, role, demo: true }).sort({ _id: 1 });
  if (!compte) {
    await effacerBacASable(idEtablissement);
    throw new HttpError(503, 'La démo n’est pas disponible pour ce rôle.', { code: 'DEMO_INDISPONIBLE' });
  }
  logger.info({ etablissementId: String(idEtablissement), role }, 'Démo — bac à sable créé');
  return compte;
}

/**
 * Le compte d'un AUTRE rôle dans la copie que le visiteur a déjà (2026-11-02, signalé par le
 * porteur : « Essayer comme formateur et stagiaire ne marche pas » — chaque changement de rôle
 * créait une copie de plus et épuisait la limite par adresse). La copie contient déjà la
 * direction, les formateurs et le stagiaire : changer de rôle, c'est changer de compte, pas de
 * copie. Rien si le visiteur n'est pas en démo ou si sa copie a expiré.
 */
export async function compteDuMemeBac(utilisateur, role) {
  if (!utilisateur?.demo || !ROLES_DEMO.includes(role)) return null;
  const copie = await modeles.Etablissement.findOne({
    _id: { $in: utilisateur.etablissementIds ?? [] },
    demo: true,
    demoExpireLe: { $gt: new Date() },
  })
    .select('_id')
    .lean();
  if (!copie) return null;
  return modeles.User.findOne({ etablissementIds: copie._id, role, demo: true }).sort({ _id: 1 });
}

/** Efface une copie de démo et tout ce qui lui appartient. Ne touche JAMAIS à autre chose. */
export function effacerBacASable(etablissementId) {
  return effacerEtablissementDemo({ _id: etablissementId, demo: true });
}

/** Efface le modèle (avant de le reconstruire — `scripts/creer-modele-demo.js`). */
export function effacerModeleDemo() {
  return effacerEtablissementDemo({ modeleDemo: true });
}

/**
 * ⚠️ LE FILTRE PORTE TOUJOURS `demo` OU `modeleDemo` : un vrai établissement ne peut pas
 *    passer ici, et seuls ses comptes marqués `demo` sont effacés.
 */
async function effacerEtablissementDemo(filtre) {
  if (!filtre.demo && !filtre.modeleDemo) throw new Error('Effacement réservé aux établissements de démo');
  const etablissement = await modeles.Etablissement.findOne(filtre).select('_id').lean();
  if (!etablissement) return false;
  const id = etablissement._id;
  const comptes = await modeles.User.find({ etablissementIds: id, demo: true }).select('_id').lean();
  const comptesIds = comptes.map((c) => c._id);

  const desComptes = { $in: comptesIds };
  await Promise.all(COLLECTIONS.map((nom) => modeles[nom].deleteMany({ etablissementId: id })));
  await modeles.Annonce.deleteMany({ etablissementIds: id });
  await modeles.Message.deleteMany({ $or: [{ expediteurId: desComptes }, { destinataireId: desComptes }] });
  await modeles.RefreshToken.deleteMany({ utilisateurId: desComptes });
  await modeles.AbonnementPush.deleteMany({ utilisateurId: desComptes });
  await modeles.CodeVerification.deleteMany({ utilisateurId: desComptes });
  await modeles.AuditLog.deleteMany({ acteurId: desComptes });
  await modeles.User.deleteMany({ _id: { $in: comptesIds }, demo: true });
  await modeles.Etablissement.deleteOne({ _id: id, ...filtre });
  return true;
}

/** Efface les copies arrivées à échéance. */
export async function effacerBacsExpires(maintenant = new Date()) {
  const expires = await modeles.Etablissement.find({ demo: true, demoExpireLe: { $lte: maintenant } })
    .select('_id')
    .lean();
  for (const { _id } of expires) await effacerBacASable(_id);
  if (expires.length) logger.info({ nombre: expires.length }, 'Démo — bacs à sable expirés effacés');
  return expires.length;
}

/** Le ménage : au démarrage, puis toutes les heures. Renvoie de quoi l'arrêter. */
export function demarrerNettoyageDemo() {
  const tourner = () =>
    effacerBacsExpires().catch((erreur) => logger.error({ err: erreur }, 'Démo — échec du ménage'));
  tourner();
  const minuteur = setInterval(tourner, 3600 * 1000);
  minuteur.unref?.();
  return () => clearInterval(minuteur);
}
