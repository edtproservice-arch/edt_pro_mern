import { api } from '@/lib/apiClient';

/**
 * Les horaires des séances (hiver, été, ramadan). (demande du porteur, 2026-09-20.)
 *
 * ⚠️ DEUX CHEMINS, DEUX DROITS : la lecture est ouverte à tout compte connecté — chacun en a
 * besoin pour afficher l'heure de ses cours — l'écriture est réservée à l'administrateur.
 */
export function chargerHorairesSeances() {
  return api.get('/api/v2/horaires-seances');
}

export function enregistrerHorairesSeances(corps) {
  return api.put('/api/v2/admin/horaires-seances', corps);
}
