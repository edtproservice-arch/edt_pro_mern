#!/usr/bin/env node
/**
 * Reprise du réseau OFPPT depuis `public/data/etablissements.json`.
 *
 *   node --env-file=.env scripts/importer-reseau.js [--verifier] [chemin.json]
 *
 * ═══ ⚠️ L'ENCODAGE : LE FICHIER EST BIEN EN UTF-8 ═══
 * Je l'avais d'abord cru en Latin-1 — une console Windows qui n'affiche pas les
 * accents m'avait fait lire « F?s-Mekn?s » là où les octets disent `C3 A8`,
 * c'est-à-dire « è » en UTF-8 parfaitement valide. On lit donc en `utf8`.
 *
 * ⚠️ LE GARDE CI-DESSOUS RESTE, et c'est lui qui a rattrapé cette erreur : lu en
 * `latin1`, le fichier rendait « FÃ¨s-MeknÃ¨s », le script a REFUSÉ d'écrire et
 * a nommé la valeur fautive. Sans lui, une région abîmée serait entrée en base,
 * et ces établissements auraient disparu de la cascade d'inscription sans que
 * rien ne le signale.
 *
 * Idempotent : rejouable, il n'écrit que ce qui manque (index unique).
 */
import { readFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';
import { REGIONS_OFPPT } from 'shared/constants';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { EtablissementOfppt } from '../src/models/EtablissementOfppt.js';

const CHEMIN_DEFAUT = new URL(
  '../../frontend/public/data/etablissements.json',
  import.meta.url
);

/** `{ région: { complexe: [noms] } }` → une ligne par établissement. */
function aplatir(arbre) {
  const lignes = [];

  for (const [region, complexes] of Object.entries(arbre)) {
    for (const [complexe, noms] of Object.entries(complexes)) {
      for (const nom of noms) {
        lignes.push({
          region: String(region).trim(),
          complexe: String(complexe).trim(),
          nom: String(nom).trim(),
        });
      }
    }
  }

  return lignes;
}

async function principal() {
  await connectDatabase();

  if (argv.includes('--verifier')) {
    const total = await EtablissementOfppt.estimatedDocumentCount();
    const regions = await EtablissementOfppt.distinct('region');
    const complexes = await EtablissementOfppt.distinct('complexe');
    console.log(
      `Réseau en base : ${total} établissement(s), ${complexes.length} complexe(s), ` +
        `${regions.length} région(s) servie(s) sur ${REGIONS_OFPPT.length}`
    );
    console.log(regions.map((r) => `  · ${r}`).join('\n'));
    await disconnectDatabase();
    return;
  }

  const chemin = argv.find((valeur) => valeur.endsWith('.json')) ?? CHEMIN_DEFAUT;

  const brut = await readFile(chemin, 'utf8');
  const lignes = aplatir(JSON.parse(brut));

  if (lignes.length === 0) {
    console.error('Aucun établissement dans le fichier source.');
    exit(1);
  }

  /*
   * ⚠️ ON REFUSE UNE RÉGION INCONNUE PLUTÔT QUE DE L'ÉCRIRE : le modèle la
   * rejetterait de toute façon, mais un message ici NOMME la valeur fautive —
   * c'est le signe que l'encodage a été mal lu.
   */
  const inconnues = [...new Set(lignes.map((l) => l.region))].filter(
    (region) => !REGIONS_OFPPT.includes(region)
  );

  if (inconnues.length > 0) {
    console.error('Régions inconnues dans le fichier :');
    console.error(inconnues.map((r) => `  · ${r}`).join('\n'));
    console.error('\nSi elles paraissent abîmées (« FÃ¨s-MeknÃ¨s »), le fichier a été lu');
    console.error('dans le mauvais encodage — il est en UTF-8.');
    exit(1);
  }

  /*
   * `ordered: false` : une ligne déjà connue est refusée par l'index unique et
   * ne doit pas arrêter les suivantes — c'est ce qui rend le script rejouable.
   */
  let inseres = 0;
  try {
    const ecrits = await EtablissementOfppt.insertMany(lignes, { ordered: false });
    inseres = ecrits.length;
  } catch (erreur) {
    inseres = erreur.insertedDocs?.length ?? erreur.result?.nInserted ?? 0;
    const refusees = lignes.length - inseres;
    console.log(`${refusees} ligne(s) déjà présente(s), laissée(s) telles quelles.`);
  }

  const total = await EtablissementOfppt.estimatedDocumentCount();
  console.log(`${inseres} établissement(s) ajouté(s). Le réseau en compte ${total}.`);

  await disconnectDatabase();
}

principal().catch(async (erreur) => {
  console.error(erreur);
  await disconnectDatabase();
  exit(1);
});
