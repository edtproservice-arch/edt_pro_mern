import { afterAll, afterEach, beforeAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Base MongoDB en mémoire pour les tests.
 *
 * ⚠️ REPLICA SET, et non serveur autonome. Les transactions multi-collections
 * n'existent pas sur un nœud isolé : sans cela, tout code qui ouvre une session
 * transactionnelle — l'import e-note (Base + EnoteImport), la sauvegarde d'un
 * emploi du temps, l'application d'une proposition — échouerait en test alors
 * qu'il fonctionne sur Atlas, qui est un replica set par nature.
 *
 * Un nœud unique suffit : c'est le mode réplication qui compte, pas le nombre
 * de membres. Le démarrage coûte quelques secondes de plus, une fois par
 * fichier de test.
 *
 * Chaque exécution part d'une base vide : les tests ne dépendent pas de l'ordre
 * dans lequel ils s'exécutent.
 */
let serveur;

beforeAll(async () => {
  serveur = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(serveur.getUri());
}, 180_000);

afterEach(async () => {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await serveur?.stop();
});
