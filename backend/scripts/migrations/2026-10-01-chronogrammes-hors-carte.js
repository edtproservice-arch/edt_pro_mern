import { writeFileSync } from 'node:fs';
import mongoose from 'mongoose';
import { Base } from '../../src/models/Base.js';
import { Chronogramme } from '../../src/models/Chronogramme.js';
import { Seance } from '../../src/models/Seance.js';
import { nomsDeLaCarte } from '../../src/modules/base/cascadeGroupes.js';

/**
 * Migration : retire les chronogrammes dont le groupe n'est plus dans la base.
 *
 *   node --env-file=.env scripts/migrations/2026-10-01-chronogrammes-hors-carte.js
 *   node --env-file=.env scripts/migrations/2026-10-01-chronogrammes-hors-carte.js --appliquer
 *
 * L'import e-note remplaçait la base SANS la cascade de la carte (corrigé le
 * 2026-10-01) : un groupe absent du nouveau fichier laissait son chronogramme,
 * et la conformité le signalait sans fin (« groupes absents de la carte »).
 * Constaté le jour même : 17 chronogrammes d'un autre jeu de groupes sur un
 * établissement, sans séance, sans stagiaire.
 *
 * ⚠️ CHRONOGRAMMES SEULEMENT. Un orphelin qui porte encore des séances n'est pas
 *    touché ici : il relève de la confirmation à l'écran, pas d'un script.
 * ⚠️ SANS `--appliquer`, RIEN N'EST ÉCRIT — et avec, une sauvegarde JSON de
 *    chaque document supprimé est écrite d'abord.
 */

const appliquer = process.argv.includes('--appliquer');

await mongoose.connect(process.env.MONGODB_URI);

const chronogrammes = await Chronogramme.find({}).lean();
const bases = new Map();
const vises = [];

for (const chrono of chronogrammes) {
  const cle = `${chrono.etablissementId}|${chrono.anneeScolaire}`;
  if (!bases.has(cle)) {
    bases.set(
      cle,
      await Base.findOne({ etablissementId: chrono.etablissementId, anneeScolaire: chrono.anneeScolaire })
        .select('groupes affectations')
        .lean()
    );
  }
  const base = bases.get(cle);
  // Sans base, on ne sait pas ce qui est « hors carte » : on ne touche à rien.
  if (!base) continue;
  if (nomsDeLaCarte(base).has(String(chrono.groupe).trim().toUpperCase())) continue;

  const seances = await Seance.countDocuments({
    etablissementId: chrono.etablissementId,
    anneeScolaire: chrono.anneeScolaire,
    groupe: chrono.groupe,
  });
  if (seances > 0) {
    console.log(`  (épargné : ${chrono.groupe}, ${seances} séance(s) — à traiter depuis la carte)`);
    continue;
  }
  vises.push(chrono);
}

console.log(`${vises.length} chronogramme(s) hors carte :`);
for (const chrono of vises) {
  console.log(`  ${chrono.etablissementId} · ${chrono.anneeScolaire} · ${chrono.groupe}`);
}

if (!appliquer) {
  console.log('\nSimulation — relancer avec --appliquer pour supprimer.');
} else if (vises.length > 0) {
  const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
  const fichier = `sauvegarde-chronogrammes-hors-carte-${horodatage}.json`;
  writeFileSync(fichier, JSON.stringify(vises, null, 2));
  console.log(`\nSauvegarde : ${fichier}`);

  const resultat = await Chronogramme.deleteMany({ _id: { $in: vises.map((chrono) => chrono._id) } });
  console.log(`${resultat.deletedCount} chronogramme(s) supprimé(s).`);
}

await mongoose.disconnect();
