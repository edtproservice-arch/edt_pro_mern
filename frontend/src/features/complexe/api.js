import { api } from '@/lib/apiClient';

/**
 * Vues du directeur de complexe (2026-10-27) — toutes en LECTURE, et toutes sur
 * ses établissements AUTORISÉS à la fois : le serveur n'y met que ceux de son
 * `etablissementIds`, jamais un autre.
 */
export const chargerTableauComplexe = () => api.get('/api/v2/complexe/tableau');
export const chargerFormateursComplexe = () => api.get('/api/v2/complexe/formateurs');
/** Sans `semaine`, la courante — ou la dernière remplie si elle est encore vide. */
export const chargerEspacesComplexe = (semaine = null) =>
  api.get(`/api/v2/complexe/espaces${semaine ? `?semaine=${semaine}` : ''}`);
export const chargerAbsencesComplexe = () => api.get('/api/v2/complexe/absences');
