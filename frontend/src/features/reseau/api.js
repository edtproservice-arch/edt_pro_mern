import { api } from '@/lib/apiClient';

/**
 * Réseau OFPPT — le référentiel région → complexe → établissement.
 * ← public/data/etablissements.json, supprimé le 2026-09-02.
 *
 * ⚠️ LE PRÉFIXE `/api/v2` EST OBLIGATOIRE : sans lui, Vite répond 200 avec
 * `index.html` (repli d'application à page unique), la réponse n'est pas du JSON
 * et le garde `REPONSE_NON_JSON` du client lève. Piège déjà payé trois fois sur
 * ce projet.
 */
const BASE = '/api/v2/admin/reseau';

const parametres = (filtres = {}) =>
  new URLSearchParams(
    Object.entries(filtres).filter(([, valeur]) => valeur !== '' && valeur != null)
  );

export function chargerReseau(filtres = {}) {
  return api.get(`${BASE}?${parametres(filtres)}`);
}

export function chargerResume() {
  return api.get(`${BASE}/resume`);
}

export function chargerComplexes(region) {
  return api.get(`${BASE}/complexes?${parametres({ region })}`);
}

export function creerEtablissement(corps) {
  return api.post(BASE, corps);
}

export function modifierEtablissement(id, corps) {
  return api.patch(`${BASE}/${id}`, corps);
}

export function supprimerEtablissement(id) {
  return api.delete(`${BASE}/${id}`);
}

/** Renomme un complexe — tous ses établissements suivent, d'un seul geste. */
export function renommerComplexe(corps) {
  return api.patch(`${BASE}/complexes`, corps);
}

export function supprimerComplexe(region, complexe) {
  return api.delete(`${BASE}/complexes?${parametres({ region, complexe })}`);
}
