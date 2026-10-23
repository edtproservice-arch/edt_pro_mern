import mongoose from 'mongoose';

/**
 * Une DEMANDE DE DOCUMENT d'un stagiaire (2026-10-23, demande du porteur) — un
 * document qui ne se télécharge pas, parce qu'il doit être SIGNÉ ET CACHETÉ par
 * l'administration : d'abord l'attestation de poursuite de formation.
 *
 * Le circuit :
 *   en_attente → (gestionnaire) acceptee | rejetee (avec motif)
 *   acceptee   → (gestionnaire) prete : « prête à retirer à l'administration »
 *   prete      → (gestionnaire) remise : le stagiaire l'a retirée.
 *
 * Une demande ouverte (en attente, acceptée ou prête) par stagiaire et par type :
 * il en refait une après un rejet ou une remise.
 */
export const TYPES_DEMANDE = ['attestation-poursuite'];
export const STATUTS_DEMANDE = ['en_attente', 'acceptee', 'rejetee', 'prete', 'remise'];
export const STATUTS_OUVERTS = ['en_attente', 'acceptee', 'prete'];

const demandeDocumentSchema = new mongoose.Schema(
  {
    etablissementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Etablissement', required: true, index: true },
    anneeScolaire: { type: Number, required: true },
    type: { type: String, enum: TYPES_DEMANDE, required: true },
    // Le stagiaire, figé à la demande : un réimport Konosys ne la rend pas anonyme.
    matricule: { type: String, required: true, trim: true },
    nomComplet: { type: String, trim: true, default: '' },
    groupe: { type: String, trim: true, default: '' },
    statut: { type: String, enum: STATUTS_DEMANDE, default: 'en_attente' },
    motif: { type: String, trim: true, default: '', maxlength: 300 },
    // Le dernier geste de l'administration : qui, et quand.
    traiteePar: { type: String, trim: true, default: '' },
    traiteeLe: { type: Date, default: null },
    preteLe: { type: Date, default: null },
    remiseLe: { type: Date, default: null },
  },
  { timestamps: true, strict: true }
);

demandeDocumentSchema.index({ etablissementId: 1, anneeScolaire: 1, statut: 1 });
demandeDocumentSchema.index({ etablissementId: 1, matricule: 1, type: 1 });

export const DemandeDocument = mongoose.model('DemandeDocument', demandeDocumentSchema);
