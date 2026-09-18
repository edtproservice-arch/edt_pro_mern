import { api } from '@/lib/apiClient';

/**
 * Partage des pages collaboratives (Phase 5bis, étape c).
 * ⚠️ `/api/v2` écrit EN ENTIER : `api.get` ne préfixe rien — l'oubli a déjà coûté
 * deux diagnostics dans ce projet (`comptesApi.js`, avancement).
 */
const BASE = '/api/v2/partages';

export const chargerMesPartages = () => api.get(`${BASE}/moi`).then((r) => r.pages);

export const chargerPartage = (page) => api.get(`${BASE}/${page}`).then((r) => r.partage);

/**
 * `droits` : le droit de CHAQUE page ouverte du même geste — `{ emploi:
 * 'modifier', absences: 'consulter' }` (2026-09-13). La page de la boîte y
 * figure toujours.
 */
export const inviterSurPage = (page, utilisateurIds, droits) =>
  api.post(`${BASE}/${page}/membres`, { utilisateurIds, droits }).then((r) => r.partage);

/** Toutes les pages d'un invité — son droit par invitation, et ce qu'il aurait sans. */
export const chargerPagesMembre = (utilisateurId) => api.get(`${BASE}/membres/${utilisateurId}`);

/** Règle ses pages d'un coup : `{ page: 'modifier' | 'consulter' | null }`. */
export const reglerPagesMembre = (utilisateurId, droits) =>
  api.put(`${BASE}/membres/${utilisateurId}`, { droits });

export const changerDroitMembre = (page, utilisateurId, droit) =>
  api.patch(`${BASE}/${page}/membres/${utilisateurId}`, { droit }).then((r) => r.partage);

export const retirerMembre = (page, utilisateurId) =>
  api.delete(`${BASE}/${page}/membres/${utilisateurId}`).then((r) => r.partage);

export const changerAccesGeneral = (page, portee, droit) =>
  api.patch(`${BASE}/${page}/general`, { portee, droit }).then((r) => r.partage);

/** L'invité répond à l'invitation portée par un message : `accepter` ou `refuser`. */
export const repondreInvitation = (messageId, reponse) =>
  api.post(`${BASE}/invitations/${messageId}/${reponse}`);

/**
 * Dernière modification d'une page — quand, et par qui (2026-09-13). `null`
 * tant que rien n'y a été écrit depuis la mise en place du suivi.
 */
export const chargerModificationPage = (page) =>
  api.get(`/api/v2/modifications/${page}`).then((r) => r.modification);
