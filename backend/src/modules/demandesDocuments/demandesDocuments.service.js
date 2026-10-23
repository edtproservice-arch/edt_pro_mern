import mongoose from 'mongoose';
import { ROLES } from 'shared/constants';
import { DemandeDocument, STATUTS_OUVERTS } from '../../models/DemandeDocument.js';
import { User } from '../../models/User.js';
import { badRequest, conflict, notFound } from '../../lib/httpError.js';
import { logger } from '../../lib/logger.js';
import { envoyer as envoyerMessage } from '../messagerie/messagerie.service.js';

/**
 * Les demandes de documents des stagiaires (2026-10-23) — voir `DemandeDocument`.
 * Le stagiaire demande ; le gestionnaire (ou le directeur) accepte ou rejette,
 * puis signale le document prêt, puis remis.
 */

/** Les demandes d'UN stagiaire, les plus récentes d'abord. */
export function demandesDuStagiaire(etablissementId, matricule) {
  return DemandeDocument.find({ etablissementId, matricule }).sort({ createdAt: -1 }).limit(50).lean();
}

/** Une nouvelle demande — refusée s'il en a déjà une ouverte du même type. */
export async function demander(etablissementId, anneeScolaire, { type, matricule, nomComplet, groupe }) {
  const ouverte = await DemandeDocument.exists({ etablissementId, matricule, type, statut: { $in: STATUTS_OUVERTS } });
  if (ouverte) throw conflict('Une demande de ce document est déjà en cours', { code: 'DEMANDE_EN_COURS' });
  return (await DemandeDocument.create({ etablissementId, anneeScolaire, type, matricule, nomComplet, groupe })).toObject();
}

/**
 * Les demandes à traiter par l'administration : les ouvertes, plus les rejetées et
 * remises des sept derniers jours — ce qui vient d'être fait reste visible.
 */
export async function demandesATraiter(etablissementId) {
  const recent = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const demandes = await DemandeDocument.find({
    etablissementId,
    $or: [{ statut: { $in: STATUTS_OUVERTS } }, { updatedAt: { $gte: recent } }],
  })
    .sort({ createdAt: 1 })
    .limit(500)
    .lean();

  /*
   * Combien de fois CE stagiaire a demandé CE document, toutes demandes confondues
   * (2026-10-23, demande du porteur) — une troisième attestation en un mois se voit.
   */
  const comptes = await DemandeDocument.aggregate([
    { $match: { etablissementId: new mongoose.Types.ObjectId(String(etablissementId)), matricule: { $in: [...new Set(demandes.map((d) => d.matricule))] } } },
    { $group: { _id: { matricule: '$matricule', type: '$type' }, nombre: { $sum: 1 } } },
  ]);
  const nombreDe = new Map(comptes.map((c) => [`${c._id.matricule}||${c._id.type}`, c.nombre]));
  return demandes.map((demande) => ({ ...demande, nombreDemandes: nombreDe.get(`${demande.matricule}||${demande.type}`) ?? 1 }));
}

/** D'où chaque geste peut partir. */
const TRANSITIONS = {
  accepter: { depuis: ['en_attente', 'rejetee'], vers: 'acceptee' },
  rejeter: { depuis: ['en_attente', 'acceptee'], vers: 'rejetee' },
  prete: { depuis: ['acceptee'], vers: 'prete' },
  remise: { depuis: ['prete'], vers: 'remise' },
};

/** @param {{id: string, nomComplet: string}} auteur — celui qui agit, et qui signe le message. */
export async function traiter(etablissementId, id, { action, motif = '' }, auteur) {
  const demande = await DemandeDocument.findOne({ _id: id, etablissementId });
  if (!demande) throw notFound('Demande introuvable', { code: 'DEMANDE_INTROUVABLE' });

  const transition = TRANSITIONS[action];
  if (!transition.depuis.includes(demande.statut)) {
    throw badRequest('Cette demande ne peut plus recevoir ce geste', { code: 'TRANSITION_INVALIDE' });
  }

  const maintenant = new Date();
  demande.statut = transition.vers;
  demande.traiteePar = auteur.nomComplet;
  demande.traiteeLe = maintenant;
  if (action === 'rejeter') demande.motif = motif;
  if (action === 'accepter') demande.motif = '';
  if (action === 'prete') demande.preteLe = maintenant;
  if (action === 'remise') demande.remiseLe = maintenant;
  await demande.save();
  if (action === 'prete') await prevenirStagiaire(etablissementId, demande, auteur);
  return demande.toObject();
}

/** « À retirer », par le libellé du document. */
const NOMS_DOCUMENTS = { 'attestation-poursuite': 'attestation de poursuite de formation' };

/**
 * ═══ « PRÊTE » ARRIVE AUSSI DANS SA MESSAGERIE (2026-10-23, demande du porteur) ═══
 * De celui qui l'a signalée prête. ⚠️ La matrice de la messagerie laisse le
 * GESTIONNAIRE écrire aux stagiaires, pas le directeur : signalée par lui, la
 * demande passe quand même « prête » (visible dans « Mes documents »), seul le
 * message est refusé. Un stagiaire sans compte n'a pas de messagerie.
 */
async function prevenirStagiaire(etablissementId, demande, auteur) {
  const compte = await User.findOne({
    role: ROLES.STAGIAIRE,
    identifiant: demande.matricule,
    etablissementIds: etablissementId,
  })
    .select('_id')
    .lean();
  if (!compte) return;

  const document = NOMS_DOCUMENTS[demande.type] ?? 'document demandé';
  try {
    await envoyerMessage(auteur.id, {
      destinataires: [String(compte._id)],
      sujet: `Votre ${document} est prête`,
      corps:
        `Bonjour ${demande.nomComplet || ''}, votre ${document}, demandée le ` +
        `${demande.createdAt.toLocaleDateString('fr-FR')}, est signée et prête : vous pouvez la retirer ` +
        `auprès de l'administration.\n\n${auteur.nomComplet}`,
    });
  } catch (erreur) {
    logger.warn({ err: erreur, demande: String(demande._id) }, 'Avis « document prêt » non envoyé');
  }
}
