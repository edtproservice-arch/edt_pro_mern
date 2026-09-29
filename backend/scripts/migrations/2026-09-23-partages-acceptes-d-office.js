import mongoose from 'mongoose';

/**
 * Migration : les invitations EN ATTENTE deviennent des accès ACCORDÉS.
 *
 *   node --env-file=.env scripts/migrations/2026-09-23-partages-acceptes-d-office.js
 *   node --env-file=.env scripts/migrations/2026-09-23-partages-acceptes-d-office.js --appliquer
 *
 * Sans `--appliquer`, le script ne fait que compter — aucune écriture.
 *
 * Contexte (2026-09-23, décision du porteur) : un partage ouvre désormais la page
 * d'office, sans « Accepter » de l'invité (`membreAccepte`, partages.service.js).
 * Les invités d'avant ce changement resteraient sinon sans accès, derrière un bouton
 * que la nouvelle règle ne demande plus.
 *
 * ⚠️ LES INVITATIONS REFUSÉES OU RETIRÉES NE BOUGENT PAS : seul `en_attente` passe.
 * Une personne qui a refusé n'est plus membre du partage — elle ne regagne rien ici.
 *
 * Driver natif, pas les modèles : on met à jour des sous-documents en masse, et
 * `arrayFilters` n'a pas d'équivalent commode par Mongoose document par document.
 */
const appliquer = process.argv.includes('--appliquer');
const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('✖ MONGODB_URI absent.');
  process.exit(1);
}

await mongoose.connect(uri);
const db = mongoose.connection.db;
const partages = db.collection('partages');
const messages = db.collection('messages');

const [membres] = await partages
  .aggregate([{ $unwind: '$membres' }, { $match: { 'membres.statut': 'en_attente' } }, { $count: 'n' }])
  .toArray();
const nbMembres = membres?.n ?? 0;
const nbMessages = await messages.countDocuments({ 'invitation.statut': 'en_attente' });

console.log(`Accès en attente dans les partages : ${nbMembres}`);
console.log(`Messages d'invitation en attente   : ${nbMessages}`);

if (nbMembres === 0 && nbMessages === 0) {
  console.log('✔ Rien à faire.');
} else if (!appliquer) {
  console.log('\nSimulation. Relance avec --appliquer pour écrire.');
} else {
  const maintenant = new Date();
  const p = await partages.updateMany(
    { 'membres.statut': 'en_attente' },
    { $set: { 'membres.$[m].statut': 'accepte', 'membres.$[m].accepteLe': maintenant } },
    { arrayFilters: [{ 'm.statut': 'en_attente' }] }
  );
  const m = await messages.updateMany(
    { 'invitation.statut': 'en_attente' },
    { $set: { 'invitation.statut': 'acceptee', 'invitation.reponduLe': maintenant } }
  );
  console.log(`✔ ${p.modifiedCount} partage(s) mis à jour, ${m.modifiedCount} message(s) passé(s) à « acceptée ».`);
}

await mongoose.disconnect();
