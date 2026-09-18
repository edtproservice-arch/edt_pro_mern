import { api } from '@/lib/apiClient';
import { decrireAppareil } from '@/lib/appareil';

/** Tableau de bord administrateur (F15). ← api/admin/*.php */

export function chargerStatistiques() {
  return api.get('/api/v2/admin/statistiques');
}

/** Les établissements, pour le filtre du tableau d'activité. */
export function chargerEtablissements() {
  return api.get('/api/v2/admin/etablissements');
}

export function chargerUtilisateurs(filtres = {}) {
  const parametres = new URLSearchParams(
    Object.entries(filtres).filter(([, valeur]) => valeur !== '' && valeur != null)
  );
  return api.get(`/api/v2/admin/utilisateurs?${parametres}`);
}

export function changerStatut(id, corps) {
  return api.patch(`/api/v2/admin/utilisateurs/${id}/statut`, corps);
}

export function reinitialiserMotDePasseCompte(id) {
  return api.post(`/api/v2/admin/utilisateurs/${id}/mot-de-passe`);
}

/**
 * Ouvre une session à la place d'un utilisateur.
 * Les cookies de l'administrateur sont REMPLACÉS : après cet appel, le
 * navigateur agit au nom de la cible jusqu'au retour.
 */
export function connecterEnTantQue(id) {
  return api.post(`/api/v2/admin/utilisateurs/${id}/connexion`, { appareil: decrireAppareil() });
}

/**
 * Collaborer avec l'établissement d'un compte, EN SON NOM (2026-09-14) — les
 * pages collaboratives, avec le droit d'un invité « peut modifier ».
 */
export function collaborerAvec(id) {
  return api.post(`/api/v2/admin/utilisateurs/${id}/collaboration`, { appareil: decrireAppareil() });
}

/** Suppression définitive — le compte et ses établissements. */
export function supprimerCompte(id) {
  return api.delete(`/api/v2/admin/utilisateurs/${id}`);
}
