import { api } from '@/lib/apiClient';

/**
 * Messagerie interne (F10).
 * ← api/messaging/*.php
 */

/** Boîte de réception ou messages envoyés. */
export function chargerMessages({ boite = 'reception', page = 1 } = {}) {
  return api.get(`/api/v2/messages?boite=${boite}&page=${page}`);
}

/** Ouvre un message — et le marque lu si l'on en est le destinataire. */
export function ouvrirMessage(id) {
  return api.get(`/api/v2/messages/${encodeURIComponent(id)}`);
}

/** Le compteur du menu. */
export function compterNonLus() {
  return api.get('/api/v2/messages/non-lus');
}

/**
 * À qui je peux écrire.
 *
 * ⚠️ LA LISTE VIENT DU SERVEUR, qui applique la MÊME matrice que le contrôle
 * d'envoi. La recomposer côté écran ferait deux définitions d'une même règle —
 * et l'écran proposerait des destinataires que le serveur refuse.
 */
export function chargerCorrespondants() {
  return api.get('/api/v2/messages/correspondants');
}

export function envoyerMessage(message) {
  return api.post('/api/v2/messages', message);
}

/** ⚠️ Retire le message de SA vue : il reste chez le correspondant. */
export function supprimerMessage(id) {
  return api.delete(`/api/v2/messages/${encodeURIComponent(id)}`);
}

/** Ce que chaque boîte contient — les chiffres de la colonne de gauche. */
export function compterBoites() {
  return api.get('/api/v2/messages/boites');
}

/** Archive ou désarchive — de MON côté seulement. */
export function archiverMessage(id, archive = true) {
  return api.post(`/api/v2/messages/${encodeURIComponent(id)}/archive`, { archive });
}

/**
 * Remet un message reçu à l'état non lu.
 *
 * ⚠️ L'écran doit REFERMER le message ensuite : rouvrir le marque lu, et le
 * geste paraîtrait sans effet.
 */
export function marquerNonLu(id) {
  return api.post(`/api/v2/messages/${encodeURIComponent(id)}/non-lu`, {});
}

/** Sort un message de la corbeille. */
export function restaurerMessage(id) {
  return api.post(`/api/v2/messages/${encodeURIComponent(id)}/restaurer`, {});
}

/** Enregistre un brouillon — création si `id` est absent. */
export function enregistrerBrouillon(brouillon) {
  return api.post('/api/v2/messages/brouillons', brouillon);
}

/** ⚠️ Définitivement : un brouillon n'a jamais été envoyé, personne ne l'a vu. */
export function supprimerBrouillon(id) {
  return api.delete(`/api/v2/messages/brouillons/${encodeURIComponent(id)}`);
}
