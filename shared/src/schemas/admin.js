import { z } from 'zod';
import { ROLES, STATUTS_COMPTE } from '../constants/index.js';

/**
 * Schémas d'administration (F15) et de gestion de compte.
 * ← api/admin/*.php, api/auth/request_trial.php, api/auth/request_reset.php
 */

/** Demande de réinitialisation : un e-mail suffit. */
export const demandeResetSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide'),
});

/**
 * Réinitialisation effective. Le nouveau mot de passe suit la même politique
 * que l'inscription — la règle est définie une seule fois dans auth.js.
 */
export const reinitialisationSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Adresse e-mail invalide'),
    code: z
      .string()
      .trim()
      .regex(/^[0-9]{6}$/, 'Code à 6 chiffres attendu'),
    motDePasse: z
      .string()
      .min(8, '8 caractères minimum')
      .regex(/[A-Z]/, 'Au moins une majuscule')
      .regex(/[a-z]/, 'Au moins une minuscule')
      .regex(/[0-9]/, 'Au moins un chiffre'),
    confirmation: z.string(),
  })
  .refine((v) => v.motDePasse === v.confirmation, {
    message: 'Les mots de passe ne correspondent pas',
    path: ['confirmation'],
  });

/** Filtres de la liste des comptes du tableau de bord admin. */
export const listeUtilisateursSchema = z.object({
  statut: z.enum(Object.values(STATUTS_COMPTE)).optional(),
  role: z.enum(Object.values(ROLES)).optional(),
  recherche: z.string().trim().max(120).optional(),
  /*
   * ═══ LES FILTRES DU TABLEAU D'ACTIVITÉ ═══
   * ← la barre de `admin_dashboard.html` (2026-09-02).
   *
   * ⚠️ DES ÉNUMÉRATIONS, PAS DES CHAÎNES LIBRES : ce sont des listes déroulantes
   * fermées, et une valeur inattendue doit être REFUSÉE plutôt que silencieusement
   * ignorée — sinon le tableau rendrait tout le monde en prétendant filtrer.
   */
  activite: z.enum(['en_ligne', 'hors_ligne']).optional(),
  actif: z.enum(['oui', 'non']).optional(),
  connexion: z.enum(['aujourdhui', '7j', '30j', 'jamais']).optional(),
  /* Un seuil en SECONDES, comme `tempsPasse`. */
  tempsMin: z.coerce.number().int().min(0).optional(),
  tri: z.enum(['activite', 'temps', 'connexion', 'inscription']).optional(),
  /*
   * ⚠️ L'IDENTIFIANT, PAS LE NOM : deux établissements peuvent porter le même
   * intitulé à un mot près, et une recherche textuelle rendrait les deux. La
   * liste déroulante envoie donc ce que le serveur a lui-même publié.
   */
  etablissement: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Identifiant d’établissement invalide')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  parPage: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * Changement de statut par l'admin.
 *
 * `deleted` est absent volontairement : la suppression passe par une route
 * dédiée, pour ne pas la rendre atteignable par un simple changement de statut.
 */
export const changementStatutSchema = z.object({
  statut: z.enum([
    STATUTS_COMPTE.APPROUVE,
    STATUTS_COMPTE.REJETE,
    STATUTS_COMPTE.BLOQUE,
    STATUTS_COMPTE.EN_ATTENTE,
  ]),
  /** Durée d'essai en jours, applicable seulement à une approbation. */
  essaiJours: z.coerce.number().int().min(1).max(365).optional(),
});
