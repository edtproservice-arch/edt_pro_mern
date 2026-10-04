import { writeFileSync } from 'node:fs';
import mongoose from 'mongoose';
import { User } from '../../src/models/User.js';
import { purgerComptes, trouverComptesOrphelins } from '../../src/modules/admin/admin.service.js';

/**
 * Migration : supprime les comptes formateur, stagiaire et gestionnaire orphelins.
 *
 *   node --env-file=.env scripts/migrations/2026-10-04-comptes-orphelins.js
 *   node --env-file=.env scripts/migrations/2026-10-04-comptes-orphelins.js --appliquer
 *
 * Même opération que le bouton « Supprimer les comptes orphelins » de l'écran
 * d'administration — voir `trouverComptesOrphelins` pour la définition.
 *
 * ⚠️ SANS `--appliquer`, RIEN N'EST ÉCRIT — et avec, une sauvegarde JSON de
 *    chaque compte supprimé (sans mot de passe) est écrite d'abord.
 */

const appliquer = process.argv.includes('--appliquer');

await mongoose.connect(process.env.MONGODB_URI);

const vises = await trouverComptesOrphelins();

console.log(`${vises.length} compte(s) orphelin(s) :`);
for (const compte of vises) {
  console.log(`  ${compte.role.padEnd(12)} ${compte.nomComplet} <${compte.email}>`);
}

if (!appliquer) {
  console.log('\nSimulation — relancer avec --appliquer pour supprimer.');
} else if (vises.length > 0) {
  const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
  const fichier = `sauvegarde-comptes-orphelins-${horodatage}.json`;
  const sauvegarde = await User.find({ _id: { $in: vises.map((compte) => compte.id) } }).lean();
  writeFileSync(fichier, JSON.stringify(sauvegarde, null, 2));
  console.log(`\nSauvegarde : ${fichier}`);

  console.log(`${await purgerComptes(vises.map((compte) => compte.id))} compte(s) supprimé(s).`);
}

await mongoose.disconnect();
