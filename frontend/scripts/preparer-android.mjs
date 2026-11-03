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
 * 4. Le thème : barre d'état blanche à icônes sombres, bleu de l'application au lieu du violet
 *    du modèle (2026-11-01).
 * 5. La mise à jour par Google Play (In-App Updates, 2026-11-03) : voir plus bas.
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
  if (!ancre.test(texte)) arreter(`Gradle : ${description} introuvable dans ${chemin}`);
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

// ── 5. Google Play In-App Updates (2026-11-03, demande du porteur) ─────────
/*
 * « Le message de mise à jour doit s'afficher tout seul quand la version est publiée sur le Play
 * Store. » Une application installée DEPUIS Play ne lit plus `android.json` : elle demande à
 * Google Play lui-même si une version plus récente existe POUR CE TÉLÉPHONE — une version encore en
 * examen, en déploiement progressif ou sur un test dont la personne n'est pas membre n'est donc
 * jamais annoncée. La page lit la réponse par `window.EdtproPlay` (`src/lib/miseAJourDesktop.js`).
 * Mise à jour « flexible » : Google télécharge pendant qu'on continue, puis l'application redémarre.
 *
 * ⚠️ INSTALLÉE HORS PLAY (l'APK du site) : Play ne peut pas la mettre à jour (Google re-signe les
 *    versions du Play Store) — `etat` vaut « indisponible », la page retombe sur `android.json`.
 */
greffer(
  join(dossierAndroid, 'app', 'build.gradle.kts'),
  /\ndependencies\s*\{/,
  '\n    implementation("com.google.android.play:app-update:2.1.0")',
  'le bloc dependencies'
);

const firebaseImports = avecFirebase ? '\nimport com.google.firebase.messaging.FirebaseMessaging' : '';
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

import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.result.contract.ActivityResultContracts
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import org.json.JSONObject${firebaseImports}

// Écrit par scripts/preparer-android.mjs : les cookies de session de edtpro.tech, sans
// lesquels la connexion échouerait (voir l'en-tête de ce script), et la mise à jour par Google Play.
class MainActivity : TauriActivity() {
  val gestionnairePlay by lazy { AppUpdateManagerFactory.create(this) }
  private var infoPlay: AppUpdateInfo? = null

  // La fenêtre de Google refermée sans accepter : la proposition reste (l'info est à usage unique).
  private val lanceurPlay = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { resultat ->
    if (resultat.resultCode != android.app.Activity.RESULT_OK) {
      PontPlay.etat = "disponible"
      PontPlay.progression = -1
      verifierPlay()
    }
  }

  private val ecouteurPlay = InstallStateUpdatedListener { suivi ->
    when (suivi.installStatus()) {
      InstallStatus.PENDING, InstallStatus.DOWNLOADING -> {
        PontPlay.etat = "telechargement"
        val total = suivi.totalBytesToDownload()
        PontPlay.progression = if (total > 0) (suivi.bytesDownloaded() * 100 / total).toInt() else -1
      }
      InstallStatus.DOWNLOADED -> {
        PontPlay.etat = "telechargee"
        PontPlay.progression = 100
      }
      InstallStatus.FAILED -> PontPlay.etat = "erreur"
      InstallStatus.CANCELED -> PontPlay.etat = "disponible"
      else -> {}
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    PontPlay.activite = this
    gestionnairePlay.registerListener(ecouteurPlay)
  }

  override fun onResume() {
    super.onResume()
    verifierPlay()
  }

  override fun onDestroy() {
    gestionnairePlay.unregisterListener(ecouteurPlay)
    if (PontPlay.activite === this) PontPlay.activite = null
    super.onDestroy()
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    val cookies = CookieManager.getInstance()
    cookies.setAcceptCookie(true)
    cookies.setAcceptThirdPartyCookies(webView, true)
    webView.addJavascriptInterface(PontPlay, "EdtproPlay")${firebaseCode}
  }

  /** Installée par le Play Store ? Sinon, Play ne peut pas la mettre à jour. */
  private fun installeeDepuisPlay(): Boolean = try {
    installateur() == "com.android.vending"
  } catch (e: Exception) {
    false
  }

  @Suppress("DEPRECATION")
  private fun installateur(): String? =
    if (Build.VERSION.SDK_INT >= 30) packageManager.getInstallSourceInfo(packageName).installingPackageName
    else packageManager.getInstallerPackageName(packageName)

  fun verifierPlay() {
    if (!installeeDepuisPlay()) {
      PontPlay.etat = "indisponible"
      return
    }
    gestionnairePlay.appUpdateInfo
      .addOnSuccessListener { info ->
        infoPlay = info
        PontPlay.versionCode = info.availableVersionCode()
        PontPlay.etat = when {
          info.installStatus() == InstallStatus.DOWNLOADED -> "telechargee"
          info.installStatus() == InstallStatus.DOWNLOADING || info.installStatus() == InstallStatus.PENDING -> "telechargement"
          info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE -> "disponible"
          else -> "aucune"
        }
      }
      .addOnFailureListener { PontPlay.etat = "indisponible" }
  }

  fun lancerPlay() {
    val info = infoPlay
    if (info == null || info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE) {
      verifierPlay()
      return
    }
    infoPlay = null
    val type = if (info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) AppUpdateType.FLEXIBLE else AppUpdateType.IMMEDIATE
    gestionnairePlay.startUpdateFlowForResult(info, lanceurPlay, AppUpdateOptions.newBuilder(type).build())
  }
}

/**
 * Ce que la page voit de Google Play. etat : inconnu (pas encore de réponse) | indisponible
 * (installée hors Play) | aucune | disponible | telechargement | telechargee | erreur.
 */
object PontPlay {
  @Volatile var etat: String = "inconnu"
  @Volatile var versionCode: Int = 0
  @Volatile var progression: Int = -1
  @Volatile var activite: MainActivity? = null

  @JavascriptInterface
  fun lire(): String =
    JSONObject().put("etat", etat).put("versionCode", versionCode).put("progression", progression).toString()

  @JavascriptInterface
  fun verifier() {
    val activite = activite ?: return
    etat = "inconnu"
    activite.runOnUiThread { activite.verifierPlay() }
  }

  @JavascriptInterface
  fun lancer() {
    val activite = activite ?: return
    etat = "telechargement"
    progression = -1
    activite.runOnUiThread { activite.lancerPlay() }
  }

  /** Installe la version téléchargée : l'application redémarre. */
  @JavascriptInterface
  fun terminer() {
    val activite = activite ?: return
    activite.runOnUiThread { activite.gestionnairePlay.completeUpdate() }
  }
}${firebasePont}
`
);

// ── 4. Thème : la barre d'état aux couleurs de l'application (2026-11-01) ─
/*
 * « Pourquoi la barre en haut s'affiche en violet ? » — le modèle de `tauri android init` donne
 * au thème Material ses couleurs d'exemple, VIOLETTES, et Android en peint la barre d'état. On
 * la met au fond de l'application (blanc, thème clair par défaut — `public/theme-init.js`), avec
 * des icônes sombres pour rester lisibles, et le bleu de l'application à la place du violet
 * partout ailleurs (sélection, effets de défilement).
 *
 * ⚠️ `values-night` AUSSI : l'application garde son thème clair même quand le téléphone est en
 *    mode sombre — une barre sombre au-dessus d'une page blanche jurerait.
 */
const COULEURS_THEME = {
  colorPrimary: '#0075DE', // --primary de globals.css
  colorPrimaryVariant: '#0075DE',
  'android:statusBarColor': '#FFFFFF', // --background
  'android:windowLightStatusBar': 'true', // icônes sombres sur fond clair (API 23+)
};
const dossierRes = join(dossierAndroid, 'app', 'src', 'main', 'res');
let themes = 0;
for (const entree of existsSync(dossierRes) ? readdirSync(dossierRes) : []) {
  const chemin = join(dossierRes, entree, 'themes.xml');
  if (!/^values(-|$)/.test(entree) || !existsSync(chemin)) continue;
  let texte = readFileSync(chemin, 'utf8');
  if (!/<style\b[^>]*>/.test(texte)) continue;
  for (const [nom, valeur] of Object.entries(COULEURS_THEME)) {
    const ligne = `<item name="${nom}">${valeur}</item>`;
    const existant = new RegExp(`<item name="${nom}"[^>]*>[^<]*</item>`);
    texte = existant.test(texte)
      ? texte.replace(existant, ligne)
      : texte.replace(/<style\b[^>]*>/, (style) => `${style}\n        ${ligne}`);
  }
  writeFileSync(chemin, texte);
  themes += 1;
}
// Un modèle Tauri qui changerait de forme ne doit pas bloquer la publication : on le signale.
if (themes === 0) console.warn(`⚠ Aucun themes.xml sous ${dossierRes} : la barre d'état garde les couleurs du modèle.`);

console.log(
  `✔ Android prêt : version ${version}, ${activite.replace(racine, 'frontend')} (paquet ${paquet})` +
    (avecFirebase ? ', Firebase activé' : ', sans Firebase (pas de google-services.json)') +
    ', mise à jour Google Play' +
    `, thème appliqué à ${themes} fichier(s).`
);
