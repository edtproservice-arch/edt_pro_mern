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
 * La page « Documents » du stagiaire (2026-10-23) : SA demande de duplicata
 * se télécharge ; l'attestation de poursuite se DEMANDE (signée et cachetée).
 */
export const chargerMesDocumentsStagiaire = () => api.get('/api/v2/consultation/mes-documents');

export const telechargerMonDuplicata = (format) =>
  api.telecharger('/api/v2/consultation/mes-documents/duplicata', { format }, {
    nomParDefaut: `demande-duplicata.${format}`,
  });

export const demanderDocument = (type) => api.post('/api/v2/consultation/demandes', { type });

/**
 * La feuille CC/EFM — depuis une séance (`seanceId`, avec l'`epreuve` cochée, 2026-10-26)
 * ou, comme avant, pour des `groupes`.
 */
/* L'en-tête d'une épreuve — contrôle continu ou EFM — depuis une séance, ou vierge (2026-10-26). */
export const telechargerEnteteExamen = ({ format, ...demande }) =>
  api.telecharger('/api/v2/consultation/documents/entete-examen', { format, ...demande }, {
    nomParDefaut: `entete-${demande.type}.${format}`,
  });

export const exporterPresenceCcEfmConsultation = ({ format, ...demande }) =>
  api.telecharger('/api/v2/consultation/documents/presence-cc-efm', { format, ...demande }, {
    nomParDefaut: `feuille-presence-cc-efm.${format}`,
  });

/**
 * La fiche de réclamation du formateur (2026-10-25) : la séance se choisit dans son
 * emploi du temps ; ici, ses stagiaires, puis la fiche remplie — une page par stagiaire.
 */
export const chargerStagiairesReclamation = (seanceId) =>
  api.get(`/api/v2/consultation/documents/reclamation/seances/${encodeURIComponent(seanceId)}/stagiaires`);

export const telechargerFicheReclamation = ({ format, ...demande }) =>
  api.telecharger('/api/v2/consultation/documents/reclamation', { format, ...demande }, {
    nomParDefaut: `fiche-reclamation.${format}`,
  });

/** La même fiche, envoyée au directeur et aux gestionnaires par la messagerie, pour impression (2026-10-26). */
export const envoyerFicheReclamation = (demande) =>
  api.post('/api/v2/consultation/documents/reclamation/envoyer', demande);

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
