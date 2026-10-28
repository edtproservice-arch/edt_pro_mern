import mongoose from 'mongoose';

/**
 * Journal d'audit — actions sensibles, tracées en base.
 *
 * Nouveau : l'existant n'avait rien d'équivalent. `secure_log()` écrivait dans
 * des fichiers plats (logs/security.log), non interrogeables, purgés
 * automatiquement au bout de 30 jours par `cleanup_old_logs()` — donc inutiles
 * pour reconstituer qui a fait quoi trois mois plus tôt.
 *
 * Ne journalise QUE les actions à conséquence : approbation, blocage,
 * suppression, usurpation de session. Pas les lectures.
 */
export const ACTIONS_AUDIT = {
  STATUT_CHANGE: 'compte.statut_change',
  MOT_DE_PASSE_REINITIALISE: 'compte.mot_de_passe_reinitialise',
  COMPTE_SUPPRIME: 'compte.supprime',
  USURPATION_DEBUT: 'session.usurpation_debut',
  USURPATION_FIN: 'session.usurpation_fin',
  /** L'administrateur collabore avec un établissement, en son nom (2026-09-14). */
  COLLABORATION_DEBUT: 'session.collaboration_debut',
  COLLABORATION_FIN: 'session.collaboration_fin',
  /** Invitation, changement de droit, retrait, accès général (Phase 5bis). */
  PARTAGE_MODIFIE: 'page.partage_modifie',
  /** Directeur de complexe (2026-10-27) : création, accès accordé ou retiré, suppression. */
  COMPLEXE_COMPTE_CREE: 'complexe.compte_cree',
  COMPLEXE_ACCES_ACCORDE: 'complexe.acces_accorde',
  COMPLEXE_ACCES_RETIRE: 'complexe.acces_retire',
  COMPLEXE_COMPTE_SUPPRIME: 'complexe.compte_supprime',
};

const auditLogSchema = new mongoose.Schema(
  {
    /** Qui a agi. */
    acteurId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    acteurEmail: { type: String, required: true },

    action: { type: String, required: true, enum: Object.values(ACTIONS_AUDIT), index: true },

    /** Sur qui / sur quoi. */
    cibleId: { type: mongoose.Schema.Types.ObjectId, index: true },
    cibleEmail: { type: String, default: null },

    /** Contexte libre : ancien et nouveau statut, durée d'essai… */
    details: { type: mongoose.Schema.Types.Mixed, default: {} },

    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: true }
);

auditLogSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);

/** Enregistre une entrée. Ne doit jamais faire échouer l'action métier. */
export async function tracer({ acteur, action, cible, details, ip }) {
  try {
    await AuditLog.create({
      acteurId: acteur.id,
      acteurEmail: acteur.email,
      action,
      cibleId: cible?.id ?? null,
      cibleEmail: cible?.email ?? null,
      details: details ?? {},
      ip: ip ?? null,
    });
  } catch {
    // Un journal indisponible ne doit pas empêcher d'approuver un compte.
  }
}
