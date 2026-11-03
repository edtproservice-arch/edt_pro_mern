import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase } from './config/db.js';
import { logger } from './lib/logger.js';
import { attacherTempsReel } from './modules/tempsReel/serveur.js';
import { retenirToutesLesRentrees } from './modules/calendrierNational/calendrierNational.service.js';
import { demarrerAvisPeriodes } from './modules/avisPeriodes/avisPeriodes.service.js';
import { demarrerNettoyageDemo } from './modules/demo/demo.service.js';
import { demarrerRappelsAppel } from './modules/notifications/rappelAppel.service.js';

/** Point d'entrée : connexion base + écoute. Rien d'autre. */
async function demarrer() {
  await connectDatabase();
  /*
   * ⚠️ L'ANCRE DE S1 AVANT D'ÉCOUTER (2026-09-28) : S1 est la semaine de la
   *    rentrée, et une requête servie avant ce chargement daterait ses
   *    semaines sur le 1er septembre.
   */
  const annees = await retenirToutesLesRentrees();
  logger.info(`Rentrées retenues pour ${annees} année(s) scolaire(s)`);

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`API demarree sur http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  // La collaboration temps réel se branche sur le serveur HTTP, pas sur Express :
  // c'est lui qui reçoit la demande de changement de protocole.
  const tempsReel = attacherTempsReel(server);

  // Avis automatique des stages et formations, une semaine avant (2026-10-10).
  const arreterAvis = demarrerAvisPeriodes();

  // Démo publique : les bacs à sable de plus de 24 h sont effacés (2026-11-01).
  const arreterMenageDemo = demarrerNettoyageDemo();

  // Le formateur, 30 min avant la fin de sa séance : saisir les absences (2026-11-03).
  const arreterRappels = demarrerRappelsAppel();

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      logger.info(`${signal} reçu — arrêt en cours`);
      // ⚠️ Les sockets d'abord : `server.close` attend la fin de TOUTES les
      // connexions, et une socket temps réel ne se ferme jamais d'elle-même.
      arreterAvis();
      arreterMenageDemo();
      arreterRappels();
      await tempsReel.fermer();
      server.close(() => process.exit(0));
    });
  }
}

demarrer().catch((error) => {
  logger.error({ err: error }, 'Échec du démarrage');
  process.exit(1);
});
