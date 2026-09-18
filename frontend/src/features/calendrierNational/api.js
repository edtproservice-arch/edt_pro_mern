import { api } from '@/lib/apiClient';

/**
 * Calendrier national — vacances du réseau et dates de rentrée.
 * (demande du porteur, 2026-09-02.)
 *
 * ⚠️ DEUX CHEMINS, DEUX DROITS : la lecture est ouverte à tout compte connecté
 * — le calendrier d'un établissement s'en alimente — l'écriture est réservée à
 * l'administrateur.
 */
export function chargerCalendrierNational(annee) {
  return api.get(`/api/v2/calendrier-national/${annee}`);
}

export function chargerPourAdmin(annee) {
  return api.get(`/api/v2/admin/calendrier-national/${annee}`);
}

export function enregistrerCalendrierNational(annee, corps) {
  return api.put(`/api/v2/admin/calendrier-national/${annee}`, corps);
}

/**
 * Jours fériés NATIONAUX, sans ajustement d'établissement.
 *
 * ⚠️ L'écran d'administration ne peut PAS interroger
 * `/api/v2/calendrier/jours-feries` : ce chemin est réservé aux directeurs et
 * se résout sur un établissement, qu'un administrateur n'a pas. Il en revenait
 * un 403 que la page rendait par « le service des jours fériés n'a pas
 * répondu » — un message qui accusait l'API à la place des droits.
 */
export function chargerJoursFeriesNationaux(annee) {
  return api.get(`/api/v2/calendrier-national/${annee}/jours-feries`);
}
