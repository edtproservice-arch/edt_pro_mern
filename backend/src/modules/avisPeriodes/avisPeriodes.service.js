import { ROLES } from 'shared/constants';
import { anneeScolaire } from 'shared/domain';
import { Etablissement } from '../../models/Etablissement.js';
import { Message } from '../../models/Message.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { User } from '../../models/User.js';
import { logger } from '../../lib/logger.js';
import { envoyer } from '../messagerie/messagerie.service.js';
import { remettreAnnoncesProgrammees } from '../annonces/annonces.service.js';

/**
 * ═══ AVIS AUTOMATIQUE DES STAGES ET DES FORMATIONS ═══ (2026-10-10, demande
 * du porteur : « message automatique avant la période d'une semaine pour
 * stagiaire et formateur ».)
 *
 * Une semaine avant le début d'une période, chaque personne concernée reçoit un
 * message dans sa messagerie EDT Pro :
 *   - stage d'un groupe → les stagiaires INSCRITS à ce groupe (`Stagiaire.groupes`)
 *     qui ont un compte actif ;
 *   - formation → le formateur, apparié sur son MATRICULE.
 * L'expéditeur est le directeur propriétaire de l'établissement.
 *
 * ⚠️ UNE FENÊTRE, PAS UN JOUR EXACT : une période qui commence dans 0 à 7 jours
 * est avisée. Viser « J-7 pile » perdrait une période saisie à J-3, ou un
 * serveur arrêté ce jour-là.
 *
 * ⚠️ JAMAIS DEUX FOIS : chaque avis porte une `cle` (type, établissement,
 * sujet, dates) et l'on ne remet pas un avis dont la personne a déjà la clé.
 * La tâche peut donc tourner toutes les heures, redémarrer, ou rattraper un
 * oubli sans jamais doubler un message. Une période DÉPLACÉE change de clé :
 * l'avis nouveau, aux nouvelles dates, part — c'est voulu.
 */
export const HORIZON_JOURS = 7;
const UNE_HEURE = 60 * 60 * 1000;

/** « AAAA-MM-JJ » en heure LOCALE du serveur. */
function enTexte(date) {
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}

const midi = (jour) => new Date(`${jour}T12:00:00`);
const ecart = (a, b) => Math.round((midi(b) - midi(a)) / 86400000);
const dateLongue = (jour) =>
  midi(jour).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dateCourte = (jour) => midi(jour).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

/** Les comptes stagiaires actifs inscrits à `groupe`, pour l'année de la période. */
async function stagiairesDuGroupe(etablissementId, groupe, debut) {
  const annee = anneeScolaire(midi(debut));
  let fiches = await Stagiaire.find({ etablissementId, anneeScolaire: annee, groupes: groupe })
    .select('matricule')
    .lean();
  /* Repli : la base Konosys de cette année n'est pas encore importée — la plus
     récente où figure le groupe (même règle que `groupesDuStagiaire`). */
  if (fiches.length === 0) {
    const derniere = await Stagiaire.findOne({ etablissementId, groupes: groupe }).sort({ anneeScolaire: -1 }).select('anneeScolaire').lean();
    if (derniere) {
      fiches = await Stagiaire.find({ etablissementId, anneeScolaire: derniere.anneeScolaire, groupes: groupe })
        .select('matricule')
        .lean();
    }
  }
  const matricules = fiches.map((fiche) => fiche.matricule).filter(Boolean);
  if (matricules.length === 0) return [];
  return User.find({ role: ROLES.STAGIAIRE, identifiant: { $in: matricules }, etablissementIds: etablissementId, estActif: true })
    .select('_id')
    .lean();
}

function formateurs(etablissementId, matricule) {
  return User.find({ role: ROLES.FORMATEUR, identifiant: matricule, etablissementIds: etablissementId, estActif: true })
    .select('_id')
    .lean();
}

function redaction({ type, sujet, debut, fin }, aujourdhui, etablissement) {
  const dans = ecart(aujourdhui, debut);
  const quand = dans === 0 ? "aujourd'hui" : dans === 1 ? 'demain' : `dans ${dans} jours`;
  const duree = ecart(debut, fin) + 1;
  const periode = `du ${dateLongue(debut)} au ${dateLongue(fin)} (${duree} jour${duree > 1 ? 's' : ''})`;
  const signature = `La direction${etablissement.nom ? ` — ${etablissement.nom}` : ''}`;

  if (type === 'stage') {
    return {
      sujet: `Stage du groupe ${sujet} — du ${dateCourte(debut)} au ${dateCourte(fin)}`,
      corps:
        `Bonjour, votre groupe ${sujet} part en stage ${quand}, ${periode}. ` +
        `Aucune séance n'est prévue pour le groupe pendant cette période. ` +
        `Retrouvez vos dates dans « Stages ».\n\n${signature}\n\n(Message automatique — il n'appelle pas de réponse.)`,
    };
  }
  return {
    sujet: `Formation — du ${dateCourte(debut)} au ${dateCourte(fin)}`,
    corps:
      `Bonjour, votre formation commence ${quand}, ${periode}. ` +
      `Aucune séance ne vous est placée pendant cette période. ` +
      `Retrouvez vos dates dans « Formations ».\n\n${signature}\n\n(Message automatique — il n'appelle pas de réponse.)`,
  };
}

/**
 * Un passage : avise tout ce qui commence dans la fenêtre et ne l'a pas encore été.
 * @returns {Promise<{avis: number, messages: number}>}
 */
export async function envoyerAvisPeriodes(maintenant = new Date()) {
  const aujourdhui = enTexte(maintenant);
  const limite = enTexte(new Date(maintenant.getTime() + HORIZON_JOURS * 86400000));
  const dansLaFenetre = (periode) => periode.debut >= aujourdhui && periode.debut <= limite;

  const etablissements = await Etablissement.find({
    $or: [
      { stages: { $elemMatch: { debut: { $gte: aujourdhui, $lte: limite } } } },
      { formations: { $elemMatch: { debut: { $gte: aujourdhui, $lte: limite } } } },
    ],
  })
    .select('nom proprietaireId stages formations')
    .lean();

  let avis = 0;
  let messages = 0;

  for (const etablissement of etablissements) {
    const directeur = etablissement.proprietaireId
      ? await User.findOne({ _id: etablissement.proprietaireId, estActif: true }).select('_id').lean()
      : null;
    if (!directeur) continue;

    const periodes = [
      ...(etablissement.stages ?? []).filter(dansLaFenetre).map((p) => ({ type: 'stage', sujet: p.groupe, debut: p.debut, fin: p.fin })),
      ...(etablissement.formations ?? [])
        .filter(dansLaFenetre)
        .map((p) => ({ type: 'formation', sujet: p.matriculeFormateur, debut: p.debut, fin: p.fin })),
    ];

    for (const periode of periodes) {
      try {
        const cle = `${periode.type}|${etablissement._id}|${periode.sujet}|${periode.debut}|${periode.fin}`;
        const comptes =
          periode.type === 'stage'
            ? await stagiairesDuGroupe(etablissement._id, periode.sujet, periode.debut)
            : await formateurs(etablissement._id, periode.sujet);
        if (comptes.length === 0) continue;

        const dejaAvises = new Set(
          (await Message.find({ destinataireId: { $in: comptes.map((c) => c._id) }, 'avisPeriode.cle': cle }).distinct('destinataireId')).map(String)
        );
        const destinataires = comptes.map((c) => String(c._id)).filter((id) => !dejaAvises.has(id));
        if (destinataires.length === 0) continue;

        const { sujet, corps } = redaction(periode, aujourdhui, etablissement);
        const { envoyes } = await envoyer(String(directeur._id), {
          destinataires,
          sujet,
          corps,
          avisPeriode: { type: periode.type, cle, sujet: periode.sujet, debut: periode.debut, fin: periode.fin },
        });
        avis += 1;
        messages += envoyes;
      } catch (erreur) {
        // Une période en échec n'arrête pas les autres : on le consigne, la prochaine heure retentera.
        logger.warn({ err: erreur, etablissement: String(etablissement._id), periode }, 'Avis de période non envoyé');
      }
    }
  }

  return { avis, messages };
}

/**
 * La tâche de fond : un passage peu après le démarrage, puis toutes les heures.
 * ⚠️ PAS EN TEST : la suite appelle `envoyerAvisPeriodes` elle-même, à date fixe.
 * ⚠️ `unref()` : la minuterie ne retient pas le processus à l'arrêt.
 */
export function demarrerAvisPeriodes() {
  if (process.env.NODE_ENV === 'test') return () => {};

  const passer = () =>
    Promise.all([
      envoyerAvisPeriodes().then(({ avis, messages }) => {
        if (messages > 0) logger.info(`Avis de stages / formations : ${messages} message(s) pour ${avis} période(s)`);
      }),
      // Les annonces programmées dont le jour est venu (2026-10-10).
      remettreAnnoncesProgrammees().then(({ annonces, remis }) => {
        if (remis > 0) logger.info(`Annonces programmées : ${remis} message(s) pour ${annonces} annonce(s)`);
      }),
    ]).catch((erreur) => logger.error({ err: erreur }, 'Avis et annonces : passage en échec'));

  const premier = setTimeout(passer, 30 * 1000);
  const suivants = setInterval(passer, UNE_HEURE);
  premier.unref?.();
  suivants.unref?.();
  return () => {
    clearTimeout(premier);
    clearInterval(suivants);
  };
}
