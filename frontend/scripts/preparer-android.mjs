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
 * 3. Si `gen/android/app/google-services.json` existe : Firebase Cloud Messaging (2026-11-01).
 *
 * ⚠️ SANS (2), PAS DE CONNEXION : l'application sert ses écrans depuis
 *    `https://tauri.localhost` et appelle l'API sur `https://edtpro.tech` — un autre site. Sa
 *    session tient dans un cookie de ce site, qu'une WebView Android REFUSE par défaut
 *    (cookies « tiers »). L'application de bureau, elle, n'a pas ce blocage.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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

// ── 3. Firebase Cloud Messaging — si google-services.json est là (2026-11-01) ─
/*
 * Les notifications « application fermée » d'Android (demande du porteur : « comme Facebook »).
 * Le workflow dépose `app/google-services.json` (secret GOOGLE_SERVICES_JSON) ; sans lui, l'APK
 * se construit comme avant, sans Firebase. Avec lui :
 *   - Gradle : le greffon google-services et firebase-messaging ;
 *   - MainActivity : le jeton de l'appareil, lisible par la page (`window.EdtproAndroid`), qui
 *     l'envoie au serveur (`frontend/src/lib/pushAndroid.js`).
 * Application fermée, Android affiche LUI-MÊME la notification que le serveur envoie.
 */
const avecFirebase = existsSync(join(dossierAndroid, 'app', 'google-services.json'));

function greffer(chemin, ancre, ajout, description) {
  const texte = readFileSync(chemin, 'utf8');
  if (texte.includes(ajout.trim())) return;
  if (!ancre.test(texte)) arreter(`Firebase : ${description} introuvable dans ${chemin}`);
  writeFileSync(chemin, texte.replace(ancre, (trouve) => `${trouve}${ajout}`));
}

if (avecFirebase) {
  greffer(
    join(dossierAndroid, 'build.gradle.kts'),
    /classpath\("com\.android\.tools\.build:gradle:[^"]*"\)/,
    '\n        classpath("com.google.gms:google-services:4.4.2")',
    'la dépendance du greffon Android (buildscript)'
  );
  const gradleApp = join(dossierAndroid, 'app', 'build.gradle.kts');
  greffer(gradleApp, /id\("com\.android\.application"\)/, '\n    id("com.google.gms.google-services")', 'le bloc plugins');
  greffer(
    gradleApp,
    /\ndependencies\s*\{/,
    '\n    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))\n    implementation("com.google.firebase:firebase-messaging")',
    'le bloc dependencies'
  );
}

const firebaseImports = avecFirebase ? '\nimport android.webkit.JavascriptInterface\nimport com.google.firebase.messaging.FirebaseMessaging' : '';
const firebaseCode = avecFirebase
  ? `

    // Le jeton Firebase de l'appareil, que la page lit et envoie au serveur (2026-11-01).
    webView.addJavascriptInterface(PontAndroid, "EdtproAndroid")
    FirebaseMessaging.getInstance().token.addOnSuccessListener { jeton -> PontAndroid.jeton = jeton }`
  : '';
const firebasePont = avecFirebase
  ? `

/** Ce que la page voit de l'appareil : son jeton Firebase (vide tant qu'il n'est pas connu). */
object PontAndroid {
  @Volatile var jeton: String = ""

  @JavascriptInterface
  fun jetonFcm(): String = jeton
}`
  : '';

writeFileSync(
  activite,
  `package ${paquet}

import android.webkit.CookieManager
import android.webkit.WebView${firebaseImports}

// Écrit par scripts/preparer-android.mjs : les cookies de session de edtpro.tech, sans
// lesquels la connexion échouerait (voir l'en-tête de ce script).
class MainActivity : TauriActivity() {
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    val cookies = CookieManager.getInstance()
    cookies.setAcceptCookie(true)
    cookies.setAcceptThirdPartyCookies(webView, true)${firebaseCode}
  }
}${firebasePont}
`
);

console.log(
  `✔ Android prêt : version ${version}, ${activite.replace(racine, 'frontend')} (paquet ${paquet})` +
    (avecFirebase ? ', Firebase activé.' : ', sans Firebase (pas de google-services.json).')
);
