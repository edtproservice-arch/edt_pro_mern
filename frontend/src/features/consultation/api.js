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

/** La page « Documents » du formateur (2026-10-23) : ses groupes, puis la feuille CC/EFM de ceux-ci. */
export const chargerDocumentsConsultation = () => api.get('/api/v2/consultation/documents');

/**
 * La page « Documents » du stagiaire (2026-10-23) : SA carte et SA demande de duplicata
 * se téléchargent ; l'attestation de poursuite se DEMANDE (signée et cachetée).
 */
export const chargerMesDocumentsStagiaire = () => api.get('/api/v2/consultation/mes-documents');

export const telechargerMaCarte = (format) =>
  api.telecharger('/api/v2/consultation/mes-documents/carte', { format, adresse: window.location.origin }, {
    nomParDefaut: `carte-stagiaire.${format}`,
  });

export const telechargerMonDuplicata = (format) =>
  api.telecharger('/api/v2/consultation/mes-documents/duplicata', { format }, {
    nomParDefaut: `demande-duplicata.${format}`,
  });

export const demanderDocument = (type) => api.post('/api/v2/consultation/demandes', { type });

export const exporterPresenceCcEfmConsultation = ({ format, groupes }) =>
  api.telecharger('/api/v2/consultation/documents/presence-cc-efm', { format, groupes }, {
    nomParDefaut: `feuille-presence-cc-efm.${format}`,
  });

/** Les groupes du stagiaire connecté — son groupe principal, plus une FQ éventuelle. */
export const chargerGroupesConsultation = () => api.get('/api/v2/consultation/groupes');

/**
 * Le programme du stagiaire connecté — « table des matières » de son année.
 * ← `tableMatieres.html`
 */
export const chargerProgrammeConsultation = () => api.get('/api/v2/consultation/programme');

/**
 * Les absences du compte connecté : son registre pour un formateur, sa fiche de
 * discipline (absences, retards, indisciplines, note) pour un stagiaire.
 */
export const chargerMesAbsences = () => api.get('/api/v2/consultation/absences');

/**
 * Ressources en ligne d'un module — vidéos, cours, exercices — cherchées sur le
 * web par le serveur avec les mots-clés « ofppt », « ofppt life », « ofppt info ».
 */
export const chargerRessourcesModule = ({ intitule, code = '', groupe = '' }) =>
  api.get(
    `/api/v2/consultation/programme/ressources?${new URLSearchParams({ intitule, code, groupe })}`
  );

/**
 * La fiche du compte connecté — matricule et groupes enseignés pour un
 * formateur ; CEF, filière, niveau et groupes pour un stagiaire.
 */
export const chargerFicheCompte = () => api.get('/api/v2/consultation/fiche');

/**
 * « Mes stages » (stagiaire) ou « Mes formations » (formateur) : les périodes
 * déclarées par la direction pour le compte connecté, avec le calendrier
 * (vacances, fériés) dont la frise a besoin.
 */
export const chargerMesPeriodes = () => api.get('/api/v2/consultation/periodes');
