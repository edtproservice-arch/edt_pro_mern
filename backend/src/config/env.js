import { z } from 'zod';

/**
 * Variables d'environnement — validées au démarrage.
 *
 * Remplace config/environment.php de l'application PHP, qui portait les secrets
 * EN CLAIR dans le dépôt et retombait silencieusement sur des valeurs par
 * défaut. Ici, une variable manquante ou invalide arrête le serveur
 * immédiatement, avec un message explicite.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI est requis'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET : 32 caractères minimum'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET : 32 caractères minimum'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('30d'),

  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  // SMTP facultatif : sans configuration, les e-mails sont journalisés au lieu
  // d'être envoyés (cf. config/mailer.js). Le serveur doit pouvoir démarrer sur
  // un poste de développement sans identifiants de messagerie.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  // Expéditeur affiché. Séparé de SMTP_USER pour pouvoir authentifier avec un
  // compte et écrire au nom d'un autre (alias vérifié) sans toucher au code.
  SMTP_FROM: z.string().optional(),
  SMTP_FROM_NAME: z.string().default('EDT Pro'),

  // Adresse de réponse réelle. Un message transactionnel auquel on ne peut pas
  // répondre est un signal négatif pour les filtres anti-spam.
  SMTP_REPLY_TO: z.string().optional(),

  // Utilisée dans le pied des e-mails, pour que le destinataire puisse relier
  // le message au service qu'il connaît.
  APP_URL: z.string().default('https://edtpro.ma'),

  // ═══ SOLVEUR PYTHON (Phase 6) ═══
  // Interpréteur qui exécute `ai/generateur`. « python » sur Windows,
  // « python3 » sur la plupart des distributions Linux : la valeur par défaut
  // ne peut donc pas convenir partout, et une variable vaut mieux qu'un essai
  // en cascade qui masquerait un interpréteur mal installé.
  PYTHON_BIN: z.string().default('python'),

  // Borne le temps d'une résolution AU GLOUTON. Mesuré : ~27 ms par semaine,
  // plus ~200 ms de démarrage de l'interpréteur. Un dépassement n'est donc
  // jamais une lenteur normale — c'est un blocage, et il doit rendre la main.
  //
  // ⚠️ CE N'EST PLUS UN PLAFOND, C'EST UN PLANCHER (2026-09-22). Avec CP-SAT,
  //    le délai effectif est calculé par `solveur.client.js` à partir du budget
  //    demandé : un budget de 20 s sous un délai de 30 s tenait, mais passer le
  //    budget à 30 s aurait fait TUER le solveur en pleine recherche, et le
  //    symptôme aurait été « le solveur n'a pas répondu » — jamais « le budget
  //    dépasse le délai ». Le délai suit désormais le budget de lui-même.
  GENERATEUR_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  // Temps laissé à CP-SAT pour chercher, par semaine, quand le directeur le
  // demande. ⚠️ MESURÉ, PAS CHOISI : sur l'année réelle (38 semaines, 35 544
  // variables booléennes par semaine), à 5 s CP-SAT ne rend RIEN — aucune
  // séance, `UNKNOWN` sur les 37 semaines. À 20 s il rend 99,19 % contre
  // 98,70 % au glouton. Baisser cette valeur ne rend pas la génération plus
  // rapide : elle la rend inutile, et le repli reprendra la grille du glouton
  // après avoir attendu pour rien.
  GENERATEUR_BUDGET_CPSAT_MS: z.coerce.number().int().positive().default(20_000),

  // Origines admises à ouvrir une socket temps réel, séparées par des virgules,
  // EN PLUS de celle d'APP_URL (et de Vite en développement). Voir
  // `originesAutorisees()` : sans contrôle d'origine, n'importe quel site
  // pourrait ouvrir une socket avec le cookie de la victime.
  WS_ORIGINES: z.string().optional(),
  HTTP_ORIGINES: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')} : ${issue.message}`)
    .join('\n');
  console.error(`Configuration d'environnement invalide :\n${details}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
