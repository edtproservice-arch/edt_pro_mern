import { api } from '@/lib/apiClient';

/**
 * Les demandes de documents des stagiaires, côté administration (2026-10-23) :
 * l'attestation de poursuite, signée et cachetée — voir `DemandesDocuments.jsx`.
 */
export const chargerDemandesDocuments = () => api.get('/api/v2/demandes-documents');

/** `action` : `accepter`, `rejeter` (avec `motif`), `prete`, `remise`. */
export const traiterDemandeDocument = (id, action, motif = '') =>
  api.patch(`/api/v2/demandes-documents/${id}`, { action, motif });

/** Le libellé de chaque document demandable, et de chaque statut. */
export const LIBELLES_DEMANDE = { 'attestation-poursuite': 'Attestation de poursuite de formation' };

export const STATUTS = {
  en_attente: { libelle: 'En attente', classes: 'bg-warning/15 text-accent-orange-deep' },
  acceptee: { libelle: 'Acceptée — en préparation', classes: 'bg-primary/10 text-primary' },
  rejetee: { libelle: 'Rejetée', classes: 'bg-destructive/10 text-destructive' },
  prete: { libelle: 'Prête à retirer', classes: 'bg-success/10 text-success' },
  remise: { libelle: 'Remise', classes: 'bg-muted text-muted-foreground' },
};

export const STATUTS_OUVERTS = ['en_attente', 'acceptee', 'prete'];

/** « 23/10/2026 » */
export const dateCourte = (valeur) => (valeur ? new Date(valeur).toLocaleDateString('fr-FR') : '');
