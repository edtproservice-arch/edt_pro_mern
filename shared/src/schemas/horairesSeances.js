import { z } from 'zod';
import { SEANCES_JOUR } from '../domain/emploi/grille.js';
import { NOMS_HORAIRES, erreursHoraire } from '../domain/emploi/horaires.js';

/**
 * Les horaires des séances : le jeu en vigueur, et les trois jeux modifiables.
 * (demande du porteur, 2026-09-20.)
 *
 * ⚠️ LA RÈGLE DE COHÉRENCE EST CELLE DE L'ÉCRAN (`erreursHoraire`, dans le domaine) : le même
 * contrôle refuse la saisie avant l'envoi et la requête à l'arrivée. Une règle écrite deux
 * fois finirait par laisser passer, d'un côté, ce que l'autre refuse.
 */
const heure = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure attendue au format HH:MM');
const creneau = z.object({ debut: heure, fin: heure });

const tableau = z.object(Object.fromEntries(SEANCES_JOUR.map((c) => [c, creneau])));

const jeu = z
  .object({ semaine: tableau, vendredi: tableau })
  .superRefine((valeur, ctx) => {
    for (const { tableau: t, creneau: c, champ, message } of erreursHoraire(valeur)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [t, c, champ] });
    }
  });

export const horairesSeancesSchema = z.object({
  actif: z.enum(NOMS_HORAIRES),
  horaires: z.object(Object.fromEntries(NOMS_HORAIRES.map((nom) => [nom, jeu]))),
});
