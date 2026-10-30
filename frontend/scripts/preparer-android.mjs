/**
 * Prépare le projet Android généré par `tauri android init` (2026-10-30).
 *
 *   node scripts/preparer-android.mjs 0.3.0
 *
 * Lancé par `.github/workflows/application-bureau.yml`, entre `tauri android init` et
 * `tauri android build` : le projet Android (`src-tauri/gen/android`) est régénéré à chaque
 * publication, il n'est pas dans le dépôt.
 *
 * 1. Écrit la version dans `src-tauri/tauri.conf.json` et `src-tauri/Cargo.toml` (Android en
 *    tire son `versionName` et son `versionCode`).
 * 2. Remplace `MainActivity.kt` : la WebView ACCEPTE les cookies de edtpro.tech.
 *
 * ⚠️ SANS (2), PAS DE CONNEXION : l'application sert ses écrans depuis
 *    `https://tauri.localhost` et appelle l'API sur `https://edtpro.tech` — un autre site. Sa
 *    session tient dans un cookie de ce site, qu'une WebView Android REFUSE par défaut
 *    (cookies « tiers »). L'application de bureau, elle, n'a pas ce blocage.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dossierTauri = join(racine, 'src-tauri');

const arreter = (message) => {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
};

// ── 1. Version ────────────────────────────────────────────────────────────
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) arreter(`Version invalide : « ${version} » (attendu : 1.2.3).`);
const cheminConf = join(dossierTauri, 'tauri.conf.json');
const conf = JSON.parse(readFileSync(cheminConf, 'utf8'));
conf.version = version;
writeFileSync(cheminConf, `${JSON.stringify(conf, null, 2)}\n`);
const cheminCargo = join(dossierTauri, 'Cargo.toml');
writeFileSync(cheminCargo, readFileSync(cheminCargo, 'utf8').replace(/^version = ".*"$/m, `version = "${version}"`));

// ── 2. MainActivity.kt ────────────────────────────────────────────────────
function chercher(dossier, nom) {
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) {
      const trouve = chercher(chemin, nom);
      if (trouve) return trouve;
    } else if (entree === nom) {
      return chemin;
    }
  }
  return null;
}

const dossierAndroid = join(dossierTauri, 'gen', 'android');
const activite = chercher(join(dossierAndroid, 'app', 'src', 'main'), 'MainActivity.kt');
if (!activite) arreter(`MainActivity.kt introuvable sous ${dossierAndroid} — « tauri android init » a-t-il tourné ?`);

const paquet = /^package\s+([\w.]+)/m.exec(readFileSync(activite, 'utf8'))?.[1];
if (!paquet) arreter(`Paquet introuvable dans ${activite}`);

writeFileSync(
  activite,
  `package ${paquet}

import android.webkit.CookieManager
import android.webkit.WebView

// Écrit par scripts/preparer-android.mjs : les cookies de session de edtpro.tech, sans
// lesquels la connexion échouerait (voir l'en-tête de ce script).
class MainActivity : TauriActivity() {
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    val cookies = CookieManager.getInstance()
    cookies.setAcceptCookie(true)
    cookies.setAcceptThirdPartyCookies(webView, true)
  }
}
`
);

console.log(`✔ Android prêt : version ${version}, ${activite.replace(racine, 'frontend')} (paquet ${paquet}).`);
