import mongoose from 'mongoose';
import { nettoyerAnnoncesRetirees } from '../../src/modules/annonces/annonces.service.js';

/**
 * Nettoyage : supprime les annonces RETIRÉES et leurs copies en messagerie.
 *
 *   node --env-file=.env scripts/migrations/2026-11-06-annonces-retirees.js
 *   node --env-file=.env scripts/migrations/2026-11-06-annonces-retirees.js --appliquer
 *
 * Sans `--appliquer`, le script ne fait que compter — aucune écriture.
 *
 * Contexte (2026-11-06, demande du porteur) : retirer une annonce ne faisait
 * que poser `retireeLe` — elle restait listée « Retirée » chez son auteur et
 * ses messages restaient dans les boîtes. Désormais le retrait SUPPRIME
 * l'annonce et ses messages ; ce script rattrape celles retirées avant.
 *
 * ⚠️ EN PRODUCTION : sauvegarde MongoDB d'abord (`/var/backups/mongo/`).
 */
const appliquer = process.argv.includes('--appliquer');
const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('✖ MONGODB_URI absent.');
  process.exit(1);
}

await mongoose.connect(uri);

const bilan = await nettoyerAnnoncesRetirees({ appliquer });
if (bilan.annonces === 0) {
  console.log('✔ Aucune annonce retirée : rien à faire.');
} else if (!appliquer) {
  console.log(`Annonces retirées : ${bilan.annonces} — messages remis à effacer : ${bilan.messages}`);
  console.log('\nSimulation. Relance avec --appliquer pour supprimer.');
} else {
  console.log(`✔ ${bilan.annonces} annonce(s) et ${bilan.messages} message(s) supprimé(s).`);
}

await mongoose.disconnect();
