import { ZodError } from 'zod';
import { HttpError } from '../lib/httpError.js';
import { logger } from '../lib/logger.js';

/** Route inconnue → 404 JSON (jamais une page HTML d'erreur). */
export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, message: 'Route introuvable' });
}

/**
 * Gestionnaire d'erreurs — DERNIER middleware monté.
 *
 * Règle absolue : le message d'une erreur non prévue ne sort jamais vers le
 * client. Il est journalisé côté serveur, le client reçoit un message générique.
 */
// eslint-disable-next-line no-unused-vars -- Express identifie ce middleware à ses 4 arguments
export function errorHandler(error, req, res, next) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: 'Données invalides',
      code: 'VALIDATION_ERROR',
      details: error.issues.map((issue) => ({
        champ: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  if (error instanceof HttpError) {
    return res.status(error.status).json({
      success: false,
      message: error.message,
      code: error.code,
      details: error.details,
    });
  }

  logger.error({ err: error, url: req.originalUrl, method: req.method }, 'Erreur non gérée');

  return res.status(500).json({
    success: false,
    message: 'Une erreur interne est survenue.',
  });
}
