/**
 * Prépare une nouvelle version de l'application de bureau.
 *
 *   npm run desktop:release -- 0.2.0
 *
 * 1. Écrit la version dans `src-tauri/tauri.conf.json` et `src-tauri/Cargo.toml`.
 * 2. Compile et SIGNE les installeurs (`tauri build`) avec la clé privée
 *    `~/.tauri/edt-pro.key` (ou `TAURI_SIGNING_PRIVATE_KEY` si déjà défini).
 * 3. Rassemble dans `release/desktop-v<version>/` l'installeur, sa signature
 *    et le `latest.json` que lisent les installations existantes.
 *
 * Il reste à créer la release `v<version>` sur GitHub et à y déposer les
 * fichiers de ce dossier (voir le README, « Application de bureau »).
 *
 * ⚠️ SANS LA CLÉ PRIVÉE, PLUS AUCUNE MISE À JOUR : les installations refusent
 * tout fichier non signé par elle. Ne jamais la committer, la sauvegarder.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEPOT = 'edtproservice-arch/edt_pro_mern';
const racineFrontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dossierTauri = join(racineFrontend, 'src-tauri');
const cheminConf = join(dossierTauri, 'tauri.conf.json');
const cheminCargo = join(dossierTauri, 'Cargo.toml');

const arreter = (message) => {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
};

// ── 1. Version ────────────────────────────────────────────────────────────
const conf = JSON.parse(readFileSync(cheminConf, 'utf8'));
const version = process.argv[2] ?? conf.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) arreter(`Version invalide : « ${version} » (attendu : 1.2.3).`);
if (process.argv[2] && process.argv[2] === conf.version) {
  console.warn(`⚠ La version ${version} est déjà la version actuelle : les installations existantes ne verront rien de nouveau.`);
}
conf.version = version;
writeFileSync(cheminConf, `${JSON.stringify(conf, null, 2)}\n`);
writeFileSync(
  cheminCargo,
  readFileSync(cheminCargo, 'utf8').replace(/^version = ".*"$/m, `version = "${version}"`),
);

// ── 2. Build signé ────────────────────────────────────────────────────────
const env = { ...process.env };
if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  const cle = join(homedir(), '.tauri', 'edt-pro.key');
  if (!existsSync(cle)) arreter(`Clé de signature introuvable : ${cle}`);
  env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(cle, 'utf8');
}
env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= '';

console.log(`\n▶ Compilation d'EDT Pro ${version}…\n`);
execSync('npx tauri build', { cwd: racineFrontend, env, stdio: 'inherit' });

// ── 3. Fichiers de la release ─────────────────────────────────────────────
const cible = env.CARGO_TARGET_DIR ? resolve(env.CARGO_TARGET_DIR) : join(dossierTauri, 'target');
const dossierNsis = join(cible, 'release', 'bundle', 'nsis');
const installeur = readdirSync(dossierNsis).find((f) => f.includes(`_${version}_`) && f.endsWith('-setup.exe'));
if (!installeur || !existsSync(join(dossierNsis, `${installeur}.sig`))) {
  arreter(`Installeur signé introuvable dans ${dossierNsis} (la clé a-t-elle bien été prise en compte ?).`);
}

/*
 * ⚠️ PAS D'ESPACE DANS LE NOM PUBLIÉ : GitHub remplace les espaces par des
 * points au dépôt, et l'URL écrite dans `latest.json` ne pointerait plus sur
 * rien. La signature porte sur le contenu, renommer est sans effet sur elle.
 */
const nomPublie = `EDT-Pro_${version}_x64-setup.exe`;
const sortie = join(racineFrontend, '..', 'release', `desktop-v${version}`);
mkdirSync(sortie, { recursive: true });
copyFileSync(join(dossierNsis, installeur), join(sortie, nomPublie));

const plateforme = {
  signature: readFileSync(join(dossierNsis, `${installeur}.sig`), 'utf8').trim(),
  url: `https://github.com/${DEPOT}/releases/download/v${version}/${nomPublie}`,
};
const latest = {
  version,
  notes: `EDT Pro ${version}`,
  pub_date: new Date().toISOString(),
  platforms: { 'windows-x86_64': plateforme, 'windows-x86_64-nsis': plateforme },
};
writeFileSync(join(sortie, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`);

console.log(`
✔ Version ${version} prête dans ${sortie}
    ${nomPublie}
    latest.json

  Étape suivante : créer la release « v${version} » sur
  https://github.com/${DEPOT}/releases/new
  et y déposer ces DEUX fichiers (en la marquant « latest »).
`);
