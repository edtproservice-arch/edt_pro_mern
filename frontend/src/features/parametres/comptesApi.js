import { api } from '@/lib/apiClient';

/**
 * Comptes formateurs, stagiaires et gestionnaires (F12).
 * ← api/session/*.php
 */

/** Personnes de la base pouvant recevoir un compte. ← get_formateurs/get_stagiaires.php */
export function chargerCandidats(role) {
  return api.get(`/api/v2/comptes/candidats?role=${encodeURIComponent(role)}`);
}

/** Création en masse. ← create_user_account.php */
export function creerComptesEnLot(charge) {
  return api.post('/api/v2/comptes/lot', charge);
}

/** Création unitaire — c'est la voie des gestionnaires, saisis à la main. */
export function creerCompte(charge) {
  return api.post('/api/v2/comptes', charge);
}

export function chargerComptes({ role, recherche, page = 1, parPage = 50 } = {}) {
  const parametres = new URLSearchParams({ page: String(page), parPage: String(parPage) });
  if (role) parametres.set('role', role);
  if (recherche) parametres.set('recherche', recherche);

  return api.get(`/api/v2/comptes?${parametres}`);
}

export function definirActivationCompte(id, actif) {
  return api.patch(`/api/v2/comptes/${id}/activation`, { actif });
}

export function supprimerCompte(id) {
  return api.delete(`/api/v2/comptes/${id}`);
}

/**
 * Réinitialise le mot de passe. ← reset_user_password.php
 *
 * ⚠️ La réponse ne porte `motDePasse` que pour les comptes SANS adresse réelle
 * (`@placeholder.ofppt.ma`) : ailleurs il part par e-mail et n'apparaît jamais
 * dans une réponse HTTP, contrairement à l'existant qui l'affichait à l'écran.
 */
export function reinitialiserMotDePasse(id) {
  return api.post(`/api/v2/comptes/${id}/mot-de-passe`);
}
