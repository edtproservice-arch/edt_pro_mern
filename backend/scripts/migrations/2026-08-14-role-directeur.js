import mongoose from 'mongoose';

/**
 * Migration : rôle `director` → `directeur`.
 *
 *   node --env-file=.env scripts/migrations/2026-08-14-role-directeur.js
 *   node --env-file=.env scripts/migrations/2026-08-14-role-directeur.js --appliquer
 *
 * Sans `--appliquer`, le script ne fait que compter — aucune écriture.
 *
 * Contexte : `ROLES.DIRECTEUR` valait `director`, seule valeur anglaise du lot,
 * héritée de l'enum MySQL. Les comptes créés avant ce changement portent encore
 * l'ancienne valeur, que le schéma Mongoose refuse désormais : sans cette
 * conversion, ils ne peuvent plus être enregistrés.
 *
 * L'écriture passe par le driver natif, pas par le modèle : la validation
 * Mongoose rejetterait précisément les documents qu'on vient corriger.
 */
const appliquer = process.argv.includes('--appliquer');
const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('✖ MONGODB_URI absent.');
  process.exit(1);
}

await mongoose.connect(uri);
const utilisateurs = mongoose.connection.db.collection('users');

const concernes = await utilisateurs.countDocuments({ role: 'director' });
console.log(`Comptes portant l'ancien rôle « director » : ${concernes}`);

if (concernes === 0) {
  console.log('✔ Rien à faire.');
} else if (!appliquer) {
  const apercu = await utilisateurs
    .find({ role: 'director' }, { projection: { email: 1, statut: 1 } })
    .limit(10)
    .toArray();
  apercu.forEach((u) => console.log(`  - ${u.email} (${u.statut})`));
  console.log('\nSimulation. Relance avec --appliquer pour écrire.');
} else {
  const resultat = await utilisateurs.updateMany({ role: 'director' }, { $set: { role: 'directeur' } });
  console.log(`✔ ${resultat.modifiedCount} compte(s) converti(s) en « directeur ».`);

  const restants = await utilisateurs.countDocuments({ role: 'director' });
  if (restants > 0) console.error(`⚠ ${restants} compte(s) non converti(s).`);
}

await mongoose.disconnect();
