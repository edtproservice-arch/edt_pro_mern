/**
 * ═══ ESSAYER LA DÉMO EN LOCAL, SANS TOUCHER À LA VRAIE BASE (2026-11-01) ═══
 * Démarre une base MongoDB EN MÉMOIRE, y construit l'établissement modèle de la démo
 * (`creer-modele-demo.js`), puis lance l'API dessus. Rien n'est écrit ailleurs : à l'arrêt,
 * tout disparaît.
 *
 *   node scripts/demo-locale.js            (API sur le port 4100 ; PORT=… pour un autre)
 *
 * ⚠️ OUTIL DE DÉVELOPPEMENT : les secrets ci-dessous sont factices, pour cette base jetable.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const base = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
process.env.MONGODB_URI = base.getUri('edtpro-demo-locale');
process.env.PORT ??= '4100';
process.env.NODE_ENV ??= 'development';
process.env.JWT_ACCESS_SECRET ??= 'secret-local-de-la-demo-access-assez-long-pour-zod';
process.env.JWT_REFRESH_SECRET ??= 'secret-local-de-la-demo-refresh-assez-long-pour-zod';

const { connectDatabase } = await import('../src/config/db.js');
const { retenirToutesLesRentrees } = await import('../src/modules/calendrierNational/calendrierNational.service.js');
const { construireModele } = await import('./creer-modele-demo.js');
await connectDatabase();
await retenirToutesLesRentrees();
console.log('Modèle de démo :', await construireModele());

// Le serveur lui-même (il se reconnecte à la même base, déjà ouverte).
await import('../src/server.js');

const arreter = async () => {
  await base.stop();
  process.exit(0);
};
process.on('SIGINT', arreter);
process.on('SIGTERM', arreter);
