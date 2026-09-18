import { z } from 'zod';

/**
 * Schémas d'authentification — partagés front / back.
 *
 * Garde-fou n°1 du §5bis : ces schémas SONT le contrat. Le formulaire React les
 * utilise via `zodResolver`, la route Express via `validate()`. Une seule
 * définition, donc impossible que les deux côtés divergent.
 *
 * Origine PHP : api/auth/login.php, api/auth/register.php,
 * config/security.php (validate_password, validate_email).
 */

/**
 * Politique de mot de passe — reprise à l'identique de `validate_password()`
 * (config/security.php:160) : 8 caractères minimum, au moins une majuscule,
 * une minuscule et un chiffre.
 *
 * ═══ LES RÈGLES SONT DÉCLARÉES, PAS SEULEMENT VALIDÉES ═══
 * Un formulaire doit pouvoir MONTRER ces conditions et dire, à la frappe,
 * lesquelles sont déjà remplies. Les recopier dans l'interface les ferait
 * diverger du schéma au premier changement — c'est exactement la cause n°1
 * d'instabilité relevée au §4.2 du plan. Le schéma est donc CONSTRUIT à partir
 * de cette liste : une règle ajoutée ici s'applique et s'affiche du même coup.
 */
export const REGLES_MOT_DE_PASSE = [
  { cle: 'longueur', libelle: '8 caractères minimum', satisfaite: (v) => v.length >= 8 },
  { cle: 'majuscule', libelle: 'Au moins une majuscule', satisfaite: (v) => /[A-Z]/.test(v) },
  { cle: 'minuscule', libelle: 'Au moins une minuscule', satisfaite: (v) => /[a-z]/.test(v) },
  { cle: 'chiffre', libelle: 'Au moins un chiffre', satisfaite: (v) => /[0-9]/.test(v) },
];

export const motDePasseSchema = REGLES_MOT_DE_PASSE.reduce(
  (schema, regle) => schema.refine(regle.satisfaite, regle.libelle),
  z.string()
);

/** Toutes les règles sont-elles satisfaites ? Sert à activer un bouton d'envoi. */
export function motDePasseValide(valeur) {
  return REGLES_MOT_DE_PASSE.every((regle) => regle.satisfaite(String(valeur ?? '')));
}

/**
 * Connexion.
 *
 * Le champ accepte un e-mail OU un identifiant : `login.php:73` interroge
 * `WHERE email = ? OR login = ?`. Les formateurs se connectent avec leur
 * matricule, les gestionnaires avec un identifiant fourni par le directeur.
 */
/**
 * Signalement d'appareil, envoyé par le client à la connexion.
 *
 * Sert au suivi « appareils connectés » et à la détection d'une connexion
 * depuis un appareil inconnu. Entièrement facultatif : un client qui n'envoie
 * rien obtient les valeurs par défaut ci-dessous.
 *
 * ⚠️ Déclaré AVANT `connexionSchema`, qui le compose : un `const` référencé
 * trop tôt lève une ReferenceError à l'évaluation du module.
 */
export const appareilSchema = z.object({
  nom: z.string().trim().max(150).default('Appareil inconnu'),
  navigateur: z.string().trim().max(50).default('inconnu'),
  os: z.string().trim().max(80).default('inconnu'),
  type: z.enum(['desktop', 'mobile', 'tablette']).default('desktop'),
});

export const connexionSchema = z.object({
  identifiant: z.string().trim().min(1, 'Email ou identifiant requis'),
  motDePasse: z.string().min(1, 'Mot de passe requis'),
  appareil: appareilSchema.optional(),
});

/**
 * Renvoi d'un code. ← api/auth/resend_code.php
 *
 * Le renvoi INVALIDE le code précédent : il ne peut donc jamais y avoir deux
 * codes valides en circulation pour un même compte.
 */
export const renvoiCodeSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide'),
  type: z.enum(['email', 'appareil', 'motDePasse']).default('email'),
});

/** Validation d'un code à 6 chiffres (vérification d'e-mail ou d'appareil). */
export const verificationCodeSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide'),
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, 'Code à 6 chiffres attendu'),
  type: z.enum(['email', 'appareil']).default('email'),
  appareil: appareilSchema.optional(),
});

/** Téléphone marocain : 06/07/05 suivi de 8 chiffres. Facultatif. */
const telephoneSchema = z
  .string()
  .trim()
  .regex(/^0[5-7][0-9]{8}$/, 'Format attendu : 0612345678')
  .optional()
  .or(z.literal(''));

/**
 * Inscription — réservée aux directeurs d'EFP.
 *
 * Les formateurs, stagiaires et gestionnaires ne s'inscrivent pas : leurs
 * comptes sont créés par le directeur (module F12).
 */
export const inscriptionSchema = z
  .object({
    nomComplet: z.string().trim().min(3, 'Nom complet requis'),
    region: z.string().trim().min(1, 'Région requise'),
    complexe: z.string().trim().min(1, 'Complexe requis'),
    nomEtablissement: z.string().trim().min(1, 'Établissement requis'),
    email: z.string().trim().toLowerCase().email('Adresse e-mail invalide'),
    telephone: telephoneSchema,
    motDePasse: motDePasseSchema,
    confirmation: z.string(),
  })
  .refine((valeurs) => valeurs.motDePasse === valeurs.confirmation, {
    message: 'Les mots de passe ne correspondent pas',
    path: ['confirmation'],
  });

/**
 * Changement de mot de passe par un utilisateur connecté.
 *
 * Le mot de passe ACTUEL est exigé : sans lui, un poste laissé ouvert suffirait
 * à prendre le compte définitivement. La confirmation évite d'enfermer
 * quelqu'un dehors sur une faute de frappe qu'il ne peut plus relire.
 */
export const modificationProfilSchema = z.object({
  nomComplet: z.string().trim().min(3, 'Nom complet requis (3 caractères min)'),
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide'),
});

export const changementMotDePasseSchema = z
  .object({
    actuel: z.string().min(1, 'Mot de passe actuel requis'),
    nouveau: motDePasseSchema,
    confirmation: z.string().min(1, 'Confirmation requise'),
  })
  .refine((valeurs) => valeurs.nouveau === valeurs.confirmation, {
    message: 'Les deux mots de passe ne correspondent pas',
    path: ['confirmation'],
  });
