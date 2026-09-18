import { api } from '@/lib/apiClient';

/**
 * Sessions consultatives — formateur & stagiaire (F14).
 * ← `emploiFormateur.html`, `emploiStagiaire.html`, `avancementFormateur.html`,
 *   `avancementStagiaire.html`, `affectationFormateur.html`
 */

export const chargerSemainesConsultation = () => api.get('/api/v2/consultation/emploi/semaines');

export const chargerSemaineConsultation = (semaine) =>
  api.get(`/api/v2/consultation/emploi/${encodeURIComponent(semaine)}`);

export const chargerAvancementConsultation = (date = null) =>
  api.get(`/api/v2/consultation/avancement${date ? `?date=${date}` : ''}`);

export const chargerAffectationsConsultation = () => api.get('/api/v2/consultation/affectations');

/** Les groupes du stagiaire connecté — son groupe principal, plus une FQ éventuelle. */
export const chargerGroupesConsultation = () => api.get('/api/v2/consultation/groupes');

/**
 * Le programme du stagiaire connecté — « table des matières » de son année.
 * ← `tableMatieres.html`
 */
export const chargerProgrammeConsultation = () => api.get('/api/v2/consultation/programme');
