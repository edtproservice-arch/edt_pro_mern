import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase } from './config/db.js';
import { logger } from './lib/logger.js';
import { attacherTempsReel } from './modules/tempsReel/serveur.js';

/** Point d'entrée : connexion base + écoute. Rien d'autre. */
async function demarrer() {
  await connectDatabase();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`API demarree sur http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  // La collaboration temps réel se branche sur le serveur HTTP, pas sur Express :
  // c'est lui qui reçoit la demande de changement de protocole.
  const tempsReel = attacherTempsReel(server);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      logger.info(`${signal} reçu — arrêt en cours`);
      // ⚠️ Les sockets d'abord : `server.close` attend la fin de TOUTES les
      // connexions, et une socket temps réel ne se ferme jamais d'elle-même.
      await tempsReel.fermer();
      server.close(() => process.exit(0));
    });
  }
}

demarrer().catch((error) => {
  logger.error({ err: error }, 'Échec du démarrage');
  process.exit(1);
});
