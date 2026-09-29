import mongoose from 'mongoose';

/**
 * Migration : libellé des espaces mutualisés — du nom OFFICIEL au nom ABRÉGÉ.
 *
 *   node --env-file=.env scripts/migrations/2026-09-21-libelles-espaces-mutualises.js
 *   node --env-file=.env scripts/migrations/2026-09-21-libelles-espaces-mutualises.js --appliquer
 *
 * Sans `--appliquer`, le script ne fait que compter — aucune écriture.
 *
 * Contexte : un espace prêté à un autre établissement s'y appelle « Salle 4 (NOM DU PRÊTEUR) ».
 * Les premières séances posées dans un tel espace portaient le nom OFFICIEL du prêteur — long
 * comme « INSTITUT SPECIALISE DE TECHNOLOGIE APPLIQUEE INDUSTRIEL BEN M'SIK CASABLANCA », qui
 * remplissait toute la case de la grille. Le libellé porte désormais le nom ABRÉGÉ (« ISTA
 * NTIC »). Sans cette réécriture, ces séances ne correspondent plus à la pièce : elles restent
 * affichées, mais le chevauchement avec le prêteur n'est plus vu.
 *
 * Un établissement sans nom abrégé garde son nom officiel : rien à réécrire pour lui.
 * L'écriture passe par le driver natif, comme les autres migrations.
 */
const appliquer = process.argv.includes('--appliquer');
const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('✖ MONGODB_URI absent.');
  process.exit(1);
}

const echapper = (texte) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

await mongoose.connect(uri);
const etablissements = mongoose.connection.db.collection('etablissements');
const seances = mongoose.connection.db.collection('seances');

let total = 0;
const preteurs = await etablissements
  .find({ 'espacesMutualises.0': { $exists: true } })
  .project({ nom: 1, nomAbrege: 1, espacesMutualises: 1 })
  .toArray();

for (const preteur of preteurs) {
  const court = (preteur.nomAbrege ?? '').trim();
  if (!court || court.toUpperCase() === String(preteur.nom).trim().toUpperCase()) continue;

  const vus = new Set();
  for (const partage of preteur.espacesMutualises) {
    const cle = `${partage.etablissementId}|${String(partage.espace).toUpperCase()}`;
    if (vus.has(cle)) continue;
    vus.add(cle);

    const filtre = {
      etablissementId: partage.etablissementId,
      salle: new RegExp(`^${echapper(`${partage.espace} (${preteur.nom})`)}$`, 'i'),
    };
    const nouveau = `${partage.espace} (${court})`;
    const nombre = await seances.countDocuments(filtre);
    if (nombre === 0) continue;

    console.log(`  « ${partage.espace} (${preteur.nom}) » → « ${nouveau} » : ${nombre} séance(s)`);
    total += nombre;
    if (appliquer) await seances.updateMany(filtre, { $set: { salle: nouveau } });
  }
}

if (total === 0) console.log('✔ Rien à faire.');
else if (!appliquer) console.log(`\n${total} séance(s) à réécrire. Relancer avec --appliquer pour les écrire.`);
else console.log(`\n✔ ${total} séance(s) réécrite(s).`);

await mongoose.disconnect();
