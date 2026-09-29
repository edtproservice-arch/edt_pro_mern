import { z } from 'zod';
import { JOURS, SEANCES } from '../constants/index.js';

/**
 * Proposition d'emploi du temps d'un formateur (Phase 9 b).
 * ← le JSON collé entre `[PROPOSITION_JSON]…[/PROPOSITION_JSON]` dans le corps
 *   d'un message (`inbox.html#submitProposition`).
 *
 * ⚠️ LA GRILLE DE JOUR SEULEMENT : S1 à S4. La S5 est la séance du SOIR, qui a
 * sa propre grille — la proposition de l'existant ne l'a jamais portée.
 *
 * ⚠️ NI SEMAINE NI FORMATEUR DANS LE SCHÉMA : la semaine est TOUJOURS la
 * suivante (décision du 2026-09-23) et le formateur est celui qui est connecté.
 * Les accepter du client permettrait de proposer pour un collègue ou pour une
 * semaine déjà publiée.
 */
export const SEANCES_PROPOSABLES = SEANCES.slice(0, 4);

export const seanceProposeeSchema = z
  .object({
    jour: z.enum(JOURS),
    seance: z.enum(SEANCES_PROPOSABLES),
    groupe: z.string().trim().min(1, 'Groupe requis').max(200),
    module: z.string().trim().min(1, 'Module requis').max(100),
    salle: z.string().trim().max(100).default(''),
  })
  .strict();

export const propositionSchema = z
  .object({
    // 6 jours × 4 séances : au-delà, c'est forcément un doublon de créneau.
    // ← « Veuillez remplir au moins une séance » de submitProposition().
    seances: z
      .array(seanceProposeeSchema)
      .min(1, 'Remplissez au moins une séance')
      .max(JOURS.length * SEANCES_PROPOSABLES.length),
    motif: z.string().trim().max(2000).default(''),
  })
  .strict();

/** Appliquer, retirer : un jour précis, ou toute la semaine si absent. */
export const actionPropositionSchema = z
  .object({
    jour: z.enum(JOURS).optional(),
  })
  .strict();
