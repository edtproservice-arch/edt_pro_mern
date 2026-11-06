/**
 * Lance l'application ANDROID EN LOCAL, sur un téléphone branché ou un émulateur (2026-11-06,
 * demande du porteur : « npx tauri android dev ne marche pas »).
 *
 *   npm run android:dev
 *
 * `tauri android dev` seul échouait pour quatre raisons, que ce script règle ou explique :
 *   1. `ANDROID_HOME` et `NDK_HOME` absents — Tauri ne trouve ni le SDK ni le NDK. On les déduit
 *      de l'installation d'Android Studio, pour CE lancement seulement (rien n'est écrit dans
 *      Windows).
 *   2. aucun appareil — on le dit, avec la marche à suivre, au lieu d'une erreur de Gradle.
 *   3. un Vite déjà lancé sur 5173 n'écoute que `localhost` : le téléphone ne le joindrait pas.
 *      Celui que lance Tauri écoute l'adresse du PC (`vite.config.js`, `TAURI_DEV_HOST`).
 *   4. le projet Android local est le modèle brut de Tauri : sans `preparer-android.mjs`, pas de
 *      cookies (pas de connexion), pas de téléchargements, pas de canal de notifications.
 *
 * ⚠️ L'API LOCALE DOIT TOURNER (port 4000) : en développement, les pages passent par le proxy
 *    de Vite, comme dans le navigateur.
 */
import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arreter = (message) => {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
};

// ── 1. SDK et NDK ─────────────────────────────────────────────────────────
const sdk = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
  process.env.HOME && join(process.env.HOME, 'Android', 'Sdk'),
].find((chemin) => chemin && existsSync(chemin));
if (!sdk) arreter('SDK Android introuvable : installez Android Studio (SDK Manager), ou définissez ANDROID_HOME.');

const versionPlusRecente = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return 0;
};
let ndk = process.env.NDK_HOME && existsSync(process.env.NDK_HOME) ? process.env.NDK_HOME : null;
if (!ndk) {
  const dossier = join(sdk, 'ndk');
  const versions = existsSync(dossier) ? readdirSync(dossier).sort(versionPlusRecente) : [];
  if (versions.length > 0) ndk = join(dossier, versions.at(-1));
}
if (!ndk) arreter('NDK Android introuvable : Android Studio → SDK Manager → SDK Tools → « NDK (Side by side) ».');

const env = { ...process.env, ANDROID_HOME: sdk, NDK_HOME: ndk };
console.log(`▶ SDK  ${sdk}\n▶ NDK  ${ndk}`);

// ── 2. Un appareil ────────────────────────────────────────────────────────
const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
if (!existsSync(adb)) arreter(`adb introuvable (${adb}) : Android Studio → SDK Manager → « Android SDK Platform-Tools ».`);
const lignes = execFileSync(adb, ['devices'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .slice(1)
  .map((ligne) => ligne.trim())
  .filter(Boolean);
const prets = lignes.filter((ligne) => /\tdevice$/.test(ligne));
if (prets.length === 0) {
  arreter(
    lignes.some((ligne) => /\tunauthorized$/.test(ligne))
      ? 'Le téléphone est branché mais n’a pas autorisé ce PC : acceptez « Autoriser le débogage USB » sur son écran, puis relancez.'
      : 'Aucun téléphone ni émulateur. Branchez le téléphone en USB avec le « Débogage USB » activé ' +
          '(Paramètres → À propos → toucher 7 fois « Numéro de version », puis Options pour les développeurs), ' +
          'ou démarrez un émulateur depuis Android Studio (Device Manager).'
  );
}
console.log(`▶ Appareil  ${prets.map((ligne) => ligne.split('\t')[0]).join(', ')}`);

// ── 3. Le port 5173 doit être libre ───────────────────────────────────────
const portOccupe = (port) =>
  new Promise((resoudre) => {
    const prise = net.connect({ port, host: 'localhost' });
    prise.once('connect', () => {
      prise.destroy();
      resoudre(true);
    });
    prise.once('error', () => resoudre(false));
  });
if (await portOccupe(5173)) {
  arreter(
    'Le port 5173 est déjà pris — sans doute un « npm run dev » ouvert : arrêtez-le (Ctrl+C). ' +
      'Tauri en lance un qui écoute l’adresse du PC, seule joignable par le téléphone.'
  );
}

// ── 4. Le projet Android, généré puis préparé ─────────────────────────────
const executer = (commande) => execSync(commande, { cwd: racine, env, stdio: 'inherit' });
if (!existsSync(join(racine, 'src-tauri', 'gen', 'android'))) executer('npx tauri android init');
executer('node scripts/preparer-android.mjs');

// ── 5. Lancement ──────────────────────────────────────────────────────────
console.log('\n▶ npx tauri android dev — la première compilation prend plusieurs minutes.\n');
const tauri = spawn('npx', ['tauri', 'android', 'dev'], { cwd: racine, env, stdio: 'inherit', shell: true });
tauri.on('exit', (code) => process.exit(code ?? 0));
