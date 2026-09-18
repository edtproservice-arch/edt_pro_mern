import { z } from 'zod';
import { SEANCES, TYPES_ABSENCE } from '../constants/index.js';

/**
 * Absences, retards et indisciplines des stagiaires (F9) — schémas partagés
 * front / back (§5bis règle 1).
 * ← api/data/save_absence_stagiaire.php · update_absence_stagiaire.php
 */

const jourSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const matriculeSchema = z.string().trim().min(1, 'CEF requis').max(50);

/*
 * ═══ L'APPEL D'UNE SÉANCE, D'UN SEUL ENVOI ═══
 * L'écran renvoie l'ÉTAT de toute la liste pour ce créneau : chaque stagiaire
 * est absent, en retard, ou présent (`null`). Un présent qui avait été marqué
 * est retiré — c'est ainsi qu'on corrige un appel.
 *
 * ⚠️ Ni nom, ni groupe, ni module, ni formateur : le serveur les relit dans la
 * séance et la base Konosys. Un appel direct ne peut pas marquer un stagiaire
 * hors du groupe, ni sur un cours qui n'existe pas.
 */
export const appelStagiairesSchema = z
  .object({
    date: jourSchema,
    seance: z.enum(SEANCES),
    periode: z.enum(['jour', 'soir']).default('jour'),
    /** Le libellé du groupe de la SÉANCE — une fusion « GM101 GM102 » comprise. */
    groupe: z.string().trim().min(1).max(200),
    marques: z
      .array(
        z
          .object({
            matricule: matriculeSchema,
            type: z.enum(Object.values(TYPES_ABSENCE)).nullable(),
          })
          .strict()
      )
      .max(300),
  })
  .strict();

export const justificationAbsenceSchema = z
  .object({
    justifiee: z.boolean().optional(),
    motif: z.string().trim().max(255).optional(),
    observation: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((corps) => Object.keys(corps).length > 0, 'Rien à modifier');

export const indisciplineSchema = z
  .object({
    matricule: matriculeSchema,
    date: jourSchema,
    motif: z.string().trim().min(1, 'Le motif est requis').max(255),
    observation: z.string().trim().max(1000).optional(),
  })
  .strict();
