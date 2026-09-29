import { writeFileSync } from 'node:fs';
import mongoose from 'mongoose';

import { Base } from '../../src/models/Base.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Repartition } from '../../src/models/Repartition.js';

/**
 * Migration : les cartes qui stockent un code DRIF passent au code CARTE.
 *
 *   node --env-file=.env scripts/migrations/2026-09-26-codes-filiere-carte.js
 *   node --env-file=.env scripts/migrations/2026-09-26-codes-filiere-carte.js --appliquer
 *
 * Sans `--appliquer`, le script mesure et sauvegarde — aucune écriture.
 *
 * ═══ CONTEXTE ═══ (2026-09-26, demande du porteur)
 * Les routes qui servent le référentiel à la carte cherchent désormais sur
 * `codeFiliereCarte` (voir l'en-tête de `repartitions.routes.js`). Une carte qui
 * aurait gardé un code DRIF ne retrouverait plus ses modules — exactement le défaut
 * que la bascule corrige, transposé à l'envers.
 *
 * ⚠️ AUCUN CRITÈRE, AUCUNE DEVINETTE : on ne convertit un code que si la
 *    répartition le connaît comme `codeFiliereDrif` ET qu'elle donne un
 *    `codeFiliereCarte` **différent et non vide**. Tout le reste est laissé tel
 *    quel — un code déjà « carte », un code inconnu des deux colonnes.
 *
 * ⚠️ RIEN N'EST RENOMMÉ. Le code de filière sert aussi à fabriquer le nom d'un
 *    NOUVEAU groupe ; les groupes existants gardent le leur. Mesuré sur les 135
 *    couples divergents : 67 produiraient un préfixe différent — aucun n'est en
 *    usage aujourd'hui, et ce script ne touche pas aux noms de toute façon.
 *
 * Mesuré avant écriture : **2 groupes** concernés (CFP MGD HASSANIA · RVA101 et
 * RVA201, `MA_RVA_Q` → `REM_RVA_Q`).
 */
const appliquer = process.argv.includes('--appliquer');
const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('✖ MONGODB_URI absent.');
  process.exit(1);
}

await mongoose.connect(uri);

/** `CODE DRIF` → `codeFiliereCarte`, quand les deux diffèrent. */
const versCarte = new Map();
const codesCarte = new Set();

for (const paire of await Repartition.aggregate([
  { $group: { _id: { drif: '$codeFiliereDrif', carte: '$codeFiliereCarte' } } },
])) {
  const { drif, carte } = paire._id;
  if (carte) codesCarte.add(String(carte).trim().toUpperCase());
  if (drif && carte && String(drif).trim() !== String(carte).trim()) {
    versCarte.set(String(drif).trim().toUpperCase(), String(carte).trim());
  }
}

const aEcrire = [];
const laisses = [];

for (const base of await Base.find().select('etablissementId anneeScolaire groupeFilieres').lean()) {
  const table = base.groupeFilieres ?? {};
  const suivante = {};
  let change = 0;

  for (const [groupe, code] of Object.entries(table)) {
    const brut = String(code ?? '').trim();
    const cle = brut.toUpperCase();

    /*
     * ⚠️ UN CODE DÉJÀ « CARTE » NE BOUGE PAS, même s'il existe aussi comme code
     *    DRIF ailleurs : les 868 couples identiques sont dans ce cas, et les
     *    « convertir » serait une écriture pour rien.
     */
    if (codesCarte.has(cle) || !versCarte.has(cle)) {
      suivante[groupe] = code;
      if (!codesCarte.has(cle) && brut !== '') laisses.push({ base: base._id, groupe, code: brut });
      continue;
    }

    suivante[groupe] = versCarte.get(cle);
    change += 1;
  }

  if (change > 0) {
    const etablissement = await Etablissement.findById(base.etablissementId)
      .select('nomAbrege')
      .lean();
    aEcrire.push({
      _id: base._id,
      etablissement: etablissement?.nomAbrege ?? String(base.etablissementId),
      anneeScolaire: base.anneeScolaire,
      avant: table,
      apres: suivante,
      change,
    });
  }
}

console.log(`Cartes à convertir : ${aEcrire.length}`);
for (const carte of aEcrire) {
  console.log(`\n  ${carte.etablissement} · ${carte.anneeScolaire} — ${carte.change} groupe(s) :`);
  for (const [groupe, code] of Object.entries(carte.avant)) {
    const suivant = carte.apres[groupe];
    if (suivant !== code) console.log(`    ${groupe.padEnd(16)} ${code}  →  ${suivant}`);
  }
}

/*
 * ⚠️ CE QUI RESTE INTROUVABLE EST DIT, PAS TU. Un code que ni l'une ni l'autre
 *    colonne ne connaît ne se répare pas ici — mais le taire laisserait croire
 *    la bascule complète.
 */
if (laisses.length > 0) {
  console.log(`\n⚠️ ${laisses.length} code(s) inconnus des deux colonnes, LAISSÉS tels quels :`);
  for (const l of laisses.slice(0, 20)) console.log(`    ${l.groupe} → ${l.code}`);
}

if (aEcrire.length === 0) {
  console.log('\nRien à convertir.');
  await mongoose.disconnect();
  process.exit(0);
}

const horodatage = new Date().toISOString().replace(/[:.]/gu, '-');
const fichier = `sauvegarde-codes-filiere-${horodatage}.json`;
writeFileSync(fichier, JSON.stringify(aEcrire, null, 2), 'utf8');
console.log(`\nSauvegarde écrite (tables avant / après) : ${fichier}`);

if (!appliquer) {
  console.log('\nSimulation — rien n’a été écrit. Relancer avec --appliquer.');
  await mongoose.disconnect();
  process.exit(0);
}

for (const carte of aEcrire) {
  await Base.updateOne({ _id: carte._id }, { $set: { groupeFilieres: carte.apres } });
}
console.log(`\n✔ ${aEcrire.length} carte(s) mise(s) à jour.`);

await mongoose.disconnect();
