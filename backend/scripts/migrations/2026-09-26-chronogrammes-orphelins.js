import { writeFileSync } from 'node:fs';
import mongoose from 'mongoose';

/**
 * Migration : retire QUATRE chronogrammes orphelins, nommés un par un.
 *
 *   node --env-file=.env scripts/migrations/2026-09-26-chronogrammes-orphelins.js
 *   node --env-file=.env scripts/migrations/2026-09-26-chronogrammes-orphelins.js --appliquer
 *
 * Sans `--appliquer`, le script ne fait que mesurer et sauvegarder — aucune écriture
 * en base.
 *
 * ═══ POURQUOI CES QUATRE-LÀ, ET PAS UNE RÈGLE ═══
 * Ils ont été créés le **21 août 2026**, avant que la cascade de retrait de groupe
 * n'existe (2026-09-22, `cascadeGroupes.js`). Depuis, aucun orphelin n'est apparu :
 * `PIE101 (FQ)` et `PIE102 (FQ)`, créés le 25 septembre, sont correctement rattachés.
 * Ce sont donc des restes d'avant, pas le symptôme d'un défaut ouvert.
 *
 * ⚠️ UNE LISTE NOMMÉE, JAMAIS UN CRITÈRE. « Supprimer tout chronogramme dont le
 *    groupe n'est pas dans la carte » s'exécuterait un jour après un import e-note
 *    incomplet et effacerait une année de planification. C'est exactement ce que la
 *    décision du 2026-09-22 écarte : « retirer un groupe n'est pas un geste, c'est un
 *    ÉCART entre deux versions de la carte ».
 *
 * ═══ ⚠️⚠️ CE QUI EST DÉLIBÉRÉMENT ÉPARGNÉ ═══
 * `ACADA101 (FQ)` (30 h) porte **4 liens FQ déclarés** dans l'établissement : sa
 * composition a été saisie par quelqu'un. Il ne manque pas d'existence, il manque à
 * la CARTE — et le correctif est de l'y remettre, pas d'effacer sa planification.
 * Décision du porteur, 2026-09-26.
 *
 * Mesuré avant écriture (ISTA BEN M'SIK · 2026) : 0 séance, 0 stagiaire, 0 stage,
 * 0 séance non placée sur les quatre. Seules des heures de chronogramme partent.
 */
const appliquer = process.argv.includes('--appliquer');
const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('✖ MONGODB_URI absent.');
  process.exit(1);
}

/** ⚠️ La liste est ICI, en toutes lettres, et nulle part ailleurs. */
const ORPHELINS = ['ACADI101 (FQ)', 'PIE201 (FQ)', 'PIE202 (FQ)', 'PM102'];
const EPARGNES = ['ACADA101 (FQ)'];

await mongoose.connect(uri);
const db = mongoose.connection.db;

const chronogrammes = db.collection('chronogrammes');
const seances = db.collection('seances');
const stagiaires = db.collection('stagiaires');
const unplaced = db.collection('unplacedsessions');

const vises = await chronogrammes.find({ groupe: { $in: ORPHELINS } }).toArray();

console.log(`Épargnés à dessein : ${EPARGNES.join(', ')}`);
console.log(`Visés (${vises.length}/${ORPHELINS.length} trouvés) :`);

/*
 * ═══ ⚠️ LE GARDE : LA MESURE DATE, L'EXÉCUTION NON ═══
 * Entre le moment où ces chiffres ont été relevés et celui où ce script tourne, un
 * directeur a pu générer une semaine ou inscrire un stagiaire. Supprimer alors le
 * chronogramme laisserait des séances sans planification de référence.
 */
let bloquants = 0;

for (const chrono of vises) {
  const ou = {
    etablissementId: chrono.etablissementId,
    anneeScolaire: chrono.anneeScolaire,
    groupe: chrono.groupe,
  };
  const [nbSeances, nbStagiaires, nbNonPlacees] = await Promise.all([
    seances.countDocuments(ou),
    stagiaires.countDocuments({
      etablissementId: chrono.etablissementId,
      anneeScolaire: chrono.anneeScolaire,
      groupes: chrono.groupe,
    }),
    unplaced.countDocuments({ etablissementId: chrono.etablissementId, groupe: chrono.groupe }),
  ]);

  let heures = 0;
  for (const cellules of Object.values(chrono.planning ?? {})) {
    for (const cellule of cellules ?? []) heures += Number(cellule?.heures) || 0;
  }

  const gene = nbSeances + nbStagiaires + nbNonPlacees;
  if (gene > 0) bloquants += 1;

  console.log(
    `  ${gene > 0 ? '✖' : '·'} ${chrono.groupe.padEnd(16)} ${String(heures).padStart(7)} h` +
      ` · séances=${nbSeances} stagiaires=${nbStagiaires} nonPlacées=${nbNonPlacees}`
  );
}

const absents = ORPHELINS.filter((nom) => !vises.some((c) => c.groupe === nom));
if (absents.length > 0) console.log(`  (déjà absents : ${absents.join(', ')})`);

/*
 * ⚠️ LA SAUVEGARDE S'ÉCRIT MÊME EN SIMULATION, et AVANT toute suppression : c'est
 *    le seul moyen de rendre le geste réversible. Un planning perdu ne se retrouve
 *    pas, il se ressaisit.
 */
const horodatage = new Date().toISOString().replace(/[:.]/gu, '-');
const fichier = `sauvegarde-chronogrammes-orphelins-${horodatage}.json`;
writeFileSync(fichier, JSON.stringify(vises, null, 2), 'utf8');
console.log(`\nSauvegarde écrite : ${fichier}`);

if (bloquants > 0) {
  console.error(
    `\n✖ REFUS : ${bloquants} chronogramme(s) ont acquis des références depuis la mesure.` +
      ' Rien n’a été supprimé — reprendre la mesure avant de relancer.'
  );
  await mongoose.disconnect();
  process.exit(1);
}

if (!appliquer) {
  console.log('\nSimulation — rien n’a été supprimé. Relancer avec --appliquer pour écrire.');
  await mongoose.disconnect();
  process.exit(0);
}

const resultat = await chronogrammes.deleteMany({ _id: { $in: vises.map((c) => c._id) } });
console.log(`\n✔ ${resultat.deletedCount} chronogramme(s) supprimé(s).`);

await mongoose.disconnect();
