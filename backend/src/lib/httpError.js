/**
 * Erreurs applicatives typées.
 *
 * Les endpoints PHP renvoyaient `$e->getMessage()` au client (api/auth/login.php:461,
 * api/data/save_timetable.php:347, config/database.php:92), exposant requêtes SQL
 * et nom d'hôte. Ici, seules les erreurs construites explicitement sont
 * montrées à l'utilisateur ; tout le reste devient un 500 générique.
 */
export class HttpError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (message, options) => new HttpError(400, message, options);
export const unauthorized = (message = 'Authentification requise', options) =>
  new HttpError(401, message, options);
export const forbidden = (message = 'Accès refusé', options) => new HttpError(403, message, options);
export const notFound = (message = 'Ressource introuvable', options) =>
  new HttpError(404, message, options);
export const conflict = (message, options) => new HttpError(409, message, options);
