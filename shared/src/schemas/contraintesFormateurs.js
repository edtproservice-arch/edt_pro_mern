import { z } from 'zod';
import { JOURS, SEANCES } from '../constants/index.js';

/**
 * Disponibilité et salles attribuées d'un formateur (panneau « Formateurs »).
 * ← api/data/save_auto_gen_config.php (champs `spaces` et `unavailable`)
 *
 * ⚠️ ÉCRITURE PARTIELLE : un champ ABSENT n'est pas touché, un tableau VIDE est
 * une décision (« aucune salle », « toujours disponible ») — c'est la règle de
 * `agc_fusionnerConfig` de l'existant.
 */
export const creneauContrainteSchema = z
  .object({
    jour: z.enum(JOURS),
    // Le soir (S5) n'entre pas dans la grille de disponibilité.
    seance: z.enum(SEANCES.slice(0, 4)),
  })
  .strict();

export const contraintesFormateurSchema = z
  .object({
    /** Identifiant du formateur : son matricule, ou son nom s'il n'en a pas. */
    formateur: z.string().trim().min(1).max(150),
    espaces: z.array(z.string().trim().min(1).max(100)).max(200).optional(),
    indisponibilites: z.array(creneauContrainteSchema).max(24).optional(),
  })
  .strict();
