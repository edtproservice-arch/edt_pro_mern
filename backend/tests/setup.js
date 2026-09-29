import { afterAll, afterEach, beforeAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { oublierRentrees } from 'shared/domain';

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
  /*
   * ⚠️ DEUX RÉGLAGES POUR LES TRANSACTIONS (F9, l'appel attesté, 2026-09-27) :
   *
   *  - `bufferTimeoutMS` ÉLARGI : un réplica-set à un seul nœud reste parfois
   *    brièvement hors service — le temps d'une élection, sous une machine
   *    chargée — et Mongoose n'attend par défaut que 10 s avant d'abandonner
   *    une commande mise en tampon. `mongoose.startSession()` y est plus
   *    sensible que les requêtes ordinaires.
   *  - `heartbeatFrequencyMS` ABAISSÉ : par défaut (10 s), le pilote met à
   *    jour son idée de l'état du nœud bien plus lentement que deux
   *    transactions rapprochées ne s'enchaînent dans un test — la seconde
   *    ouvre alors une session en croyant le nœud encore dans l'état
   *    transitoire d'après la première, et bute sur le même délai
   *    d'abandon. Une surveillance plus fréquente resserre cette fenêtre.
   *
   * Sans l'un ou l'autre, un test entier peut tomber en 500 ou en timeout
   * pour cette seule raison, sans le moindre bogue applicatif.
   */
  await mongoose.connect(serveur.getUri(), { bufferTimeoutMS: 30_000, heartbeatFrequencyMS: 200 });
}, 180_000);

afterEach(async () => {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
  // ⚠️ L'ancre de S1 vit en mémoire (`ancres.js`) : vider la base ne l'efface
  //    pas, et un test hériterait sinon des rentrées du précédent.
  oublierRentrees();
});

afterAll(async () => {
  await mongoose.disconnect();
  await serveur?.stop();
});
