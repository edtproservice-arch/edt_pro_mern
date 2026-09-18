import { z } from 'zod';
import { ROLES } from '../constants/index.js';
import { motDePasseSchema } from './auth.js';

/**
 * Gestion des comptes par le directeur (F12).
 * ← api/session/*.php
 *
 * Seuls ces trois rôles sont créables par un directeur. Un directeur ne peut
 * donc jamais fabriquer un autre directeur ni un administrateur — l'existant
 * s'appuyait sur un contrôle dispersé dans chaque endpoint.
 */
export const ROLES_GERABLES = [ROLES.FORMATEUR, ROLES.STAGIAIRE, ROLES.GESTIONNAIRE];

export const creationCompteSchema = z.object({
  nomComplet: z.string().trim().min(3, 'Nom complet requis'),
  role: z.enum(ROLES_GERABLES),

  /**
   * Matricule (formateur), CEF (stagiaire) ou identifiant choisi (gestionnaire).
   * C'est avec lui que ces comptes se connectent — l'e-mail est souvent absent.
   */
  /*
   * ⚠️ L'ARROBASE EST AUTORISÉE, et ce n'est pas un détail cosmétique.
   *
   * Un GESTIONNAIRE n'a pas de matricule : `create_user_account.php:54` posait
   * `login = email`. Le motif d'origine, taillé pour des matricules, refusait
   * donc toute création de gestionnaire — « Lettres, chiffres, point, tiret et
   * souligné uniquement » sur une adresse parfaitement valide.
   */
  identifiant: z
    .string()
    .trim()
    .min(2, 'Identifiant requis')
    .max(100)
    .regex(
      /^[A-Za-z0-9._@-]+$/,
      'Lettres, chiffres, point, tiret, souligné et arobase uniquement'
    ),

  /** Facultatif : beaucoup de stagiaires n'ont pas d'adresse professionnelle. */
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide').optional().or(z.literal('')),

  motDePasse: motDePasseSchema,
});

export const listeComptesSchema = z.object({
  role: z.enum(ROLES_GERABLES).optional(),
  recherche: z.string().trim().max(120).optional(),
  actif: z.enum(['oui', 'non']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  parPage: z.coerce.number().int().min(1).max(200).default(50),
});

export const activationCompteSchema = z.object({
  actif: z.boolean(),
});

/**
 * Suppression en lot : par identifiants explicites, ou par rôle entier.
 * ← delete_bulk_users.php, qui acceptait les deux formes.
 */
export const suppressionLotSchema = z
  .object({
    ids: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).min(1).max(500).optional(),
    role: z.enum([...ROLES_GERABLES, 'tous']).optional(),
  })
  .refine((v) => Boolean(v.ids) !== Boolean(v.role), {
    message: 'Fournir soit une liste d\'identifiants, soit un rôle — pas les deux',
  });

/**
 * Création de comptes EN MASSE depuis la base de l'établissement.
 * ← api/session/create_user_account.php:58-135
 *
 * ═══ POURQUOI ELLE N'EST PAS UN CONFORT ═══
 * Depuis la décision du 2026-08-15 — démarrage sur une base vide, comptes
 * compris — c'est le seul moyen praticable de créer les comptes formateurs et
 * stagiaires. Les créer un à un n'est pas une option à cette échelle.
 *
 * On envoie des IDENTIFIANTS (matricules), pas des identifiants de documents :
 * le serveur relit la base lui-même. L'existant envoyait les `id` de lignes SQL
 * et recopiait ensuite l'`etablissement_id` DE LA LIGNE — un compte pouvait donc
 * atterrir dans un autre établissement que celui du directeur.
 */
export const creationLotSchema = z.object({
  role: z.enum([ROLES.FORMATEUR, ROLES.STAGIAIRE]),

  matricules: z
    .array(z.string().trim().min(1).max(100))
    .min(1, 'Sélectionnez au moins une personne')
    .max(2000),

  motDePasse: motDePasseSchema,
});

/** Personnes de la base pour lesquelles un compte peut être créé. */
export const candidatsSchema = z.object({
  role: z.enum([ROLES.FORMATEUR, ROLES.STAGIAIRE]),
});
