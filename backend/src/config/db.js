import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../lib/logger.js';

/**
 * Connexion MongoDB.
 *
 * `strictQuery` et les schémas Mongoose en `strict: true` compensent l'absence
 * de contraintes d'intégrité (cf. réserve MongoDB, plan §5). Un replica set est
 * requis — même mono-nœud — pour les transactions multi-collections
 * (sauvegarde d'emploi du temps + absences, application d'une proposition).
 */
mongoose.set('strictQuery', true);

export async function connectDatabase() {
  await mongoose.connect(env.MONGODB_URI);
  logger.info('MongoDB connecte');

  mongoose.connection.on('error', (error) => {
    logger.error({ error }, 'Erreur de connexion MongoDB');
  });

  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
