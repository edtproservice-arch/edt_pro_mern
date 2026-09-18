import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';
import { EnoteImport } from '../backend/src/models/EnoteImport.js';
for (const l of readFileSync('backend/.env', 'utf8').split(/\r?\n/u)) {
  const i = l.indexOf('=');
  if (i > 0 && !l.trimStart().startsWith('#')) process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
}
await mongoose.connect(process.env.MONGODB_URI);
const d = await EnoteImport.findOne().sort({ importeLe: -1 }).lean();
const [G, F, M, MHP, MHS, RP, RS] = [8, 12, 16, 35, 36, 38, 39];
const fusionnees = d.lignes.filter((l) => String(l[F] ?? '').trim() !== '');
console.log('lignes totales :', d.lignes.length, '| avec FusionGroupe :', fusionnees.length);
console.log('\n— échantillon de lignes FUSIONNÉES —');
for (const l of fusionnees.slice(0, 6))
  console.log(`  groupe=${String(l[G]).padEnd(14)} fusion=${String(l[F]).padEnd(22)} module=${String(l[M]).padEnd(9)} MHP=${l[MHP]} MHS=${l[MHS]} réalisé P=${l[RP]} S=${l[RS]}`);
console.log('\n— une ligne NON fusionnée, pour comparaison —');
const simple = d.lignes.find((l) => String(l[F] ?? '').trim() === '' && Number(l[MHP]) > 0);
console.log(`  groupe=${simple[G]} module=${simple[M]} MHP=${simple[MHP]} MHS=${simple[MHS]} réalisé P=${simple[RP]} S=${simple[RS]}`);
await mongoose.disconnect();
