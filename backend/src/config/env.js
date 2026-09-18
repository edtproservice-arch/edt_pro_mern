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
