/**
 * Propositions d'emploi du temps (F10, Phase 9 b).
 * ← public/inbox.html (grille de proposition) + api/messaging/apply_proposition.php
 */
export { semaineEstPubliee, semaineProposable } from './semaine.js';
export { conflitAvecCollegues, conflitsAvecCollegues } from './collegues.js';
export {
  estProtegee,
  identiques,
  joursVises,
  normaliserProposition,
  planDuJour,
  statutGlobal,
} from './application.js';
export { MODES_PROPOSITION, ecartsAuMode, modeDeProposition } from './mode.js';
