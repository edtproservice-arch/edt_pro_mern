import { api } from '@/lib/apiClient';

/**
 * Propositions d'emploi du temps (F10, Phase 9 b).
 * ← api/messaging/apply_proposition.php, get_proposals_conflicts.php
 */

/** Semaine suivante, emploi actuel, cases réservées, affectations. */
export function chargerNouvelleProposition() {
  return api.get('/api/v2/propositions/nouvelle');
}

export function envoyerProposition({ seances, motif }) {
  return api.post('/api/v2/propositions', { seances, motif });
}

/** Directeur — `jour` absent : toute la semaine. */
export function appliquerProposition(id, jour) {
  return api.post(`/api/v2/propositions/${encodeURIComponent(id)}/appliquer`, jour ? { jour } : {});
}

/** Directeur — restaure ce que l'application avait remplacé. */
export function retirerProposition(id, jour) {
  return api.post(`/api/v2/propositions/${encodeURIComponent(id)}/retirer`, jour ? { jour } : {});
}

export function refuserProposition(id) {
  return api.post(`/api/v2/propositions/${encodeURIComponent(id)}/refuser`, {});
}
