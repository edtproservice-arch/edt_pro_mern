/**
 * Modèles Mongoose — toutes les collections cibles (§6 du plan).
 *
 * Correspondance avec les 22 tables MySQL :
 *
 *   User             ← utilisateurs
 *   Etablissement    ← etablissements + espaces + calendrier + stages
 *                      + formations + fq_group_mappings   (sous-documents)
 *   Base             ← donnees_de_base                    (5 lignes → 1 doc)
 *   Seance         ★ ← emplois_du_temps                   (blob → documents)
 *   EnoteImport      ← donnees_avancement
 *   Chronogramme     ← chronogrammes
 *   AbsenceFormateur ← absences
 *   AbsenceStagiaire ← absences_stagiaires
 *   Stagiaire        ← stagiaires
 *   Message          ← messages            (+ sous-doc proposition)
 *   RefreshToken     ← sessions
 *   CodeVerification ← verification_codes + device_approvals + password_resets
 *   AutoGenConfig    ← configurations_auto_gen
 *   UnplacedSession  ← unplaced_sessions
 *   AuditLog         ← (nouveau, remplace logs/*.log)
 *   JoursFeriesNationaux ← (nouveau, remplace le cache fichier de
 *                      api/data/cache/holidays_*.json)
 *   Repartition      ← repartitions   (référentiel DRIF national — la seule
 *                      donnée reprise de MySQL, cf. Repartition.js)
 *
 * Sans équivalent : `migrations_appliquees` (remplacée par les scripts
 * versionnés de `backend/scripts/migrations/`) et la vue `vue_note_discipline`
 * (qui devient un pipeline d'agrégation, F9).
 */

export { User } from './User.js';
export { Etablissement } from './Etablissement.js';
export { Base } from './Base.js';
export { Seance } from './Seance.js';
export { EnoteImport } from './EnoteImport.js';
export { Chronogramme } from './Chronogramme.js';
export { AbsenceFormateur } from './AbsenceFormateur.js';
export { AbsenceStagiaire } from './AbsenceStagiaire.js';
/* Le comportement de la note de discipline (2026-09-14, sans équivalent MySQL). */
export { IndisciplineStagiaire } from './IndisciplineStagiaire.js';
export { Stagiaire } from './Stagiaire.js';
export { Message } from './Message.js';
export { RefreshToken } from './RefreshToken.js';
export { CodeVerification, TYPES_CODE, genererCode, empreinteCode } from './CodeVerification.js';
export { AutoGenConfig } from './AutoGenConfig.js';
export { UnplacedSession } from './UnplacedSession.js';
export { AuditLog, ACTIONS_AUDIT, tracer } from './AuditLog.js';
export { JoursFeriesNationaux } from './JoursFeriesNationaux.js';
export { Repartition } from './Repartition.js';
/* ⚠️ Le RÉSEAU OFPPT, pas le locataire : voir l'en-tête du modèle. */
export { EtablissementOfppt } from './EtablissementOfppt.js';
/* ⚠️ NATIONAL : vacances et dates de rentrée du réseau, à ne pas confondre avec
   `Etablissement.calendrier`, qui porte ce que le directeur saisit chez lui. */
export { CalendrierNational } from './CalendrierNational.js';
/* Qui a accès à une page collaborative (Phase 5bis) — la boîte « Partager ». */
export { Partage } from './Partage.js';
/* La dernière écriture de chaque page — « Modifié il y a… » (2026-09-13). */
export { ModificationPage } from './ModificationPage.js';
