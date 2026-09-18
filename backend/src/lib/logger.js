import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Journalisation structurée.
 *
 * Remplace `secure_log()` (défini en double dans config/database.php et
 * config/security.php) et les fichiers plats de logs/. Les événements
 * d'audit métier vont dans la collection `auditLogs`, pas ici.
 */
const estDeveloppement = env.NODE_ENV === 'development';

const niveaux = { test: 'silent', production: 'info', development: 'debug' };

export const logger = pino({
  level: niveaux[env.NODE_ENV] ?? 'info',
  redact: [
    'req.headers.cookie',
    'req.headers.authorization',
    '*.motDePasse',
    '*.mot_de_passe',
    '*.password',
  ],
  // `pino-pretty` est une dépendance de développement : la charger en test ou
  // en production échouerait, elle n'y est pas installée.
  transport: estDeveloppement ? { target: 'pino-pretty' } : undefined,
});
