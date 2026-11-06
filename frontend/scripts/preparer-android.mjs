/**
 * Prépare le projet Android généré par `tauri android init` (2026-10-30).
 *
 *   node scripts/preparer-android.mjs 0.3.0   (publication : la version est écrite)
 *   node scripts/preparer-android.mjs         (essai local : la version ne bouge pas)
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
/*
 * ⚠️ SANS VERSION, ON N'Y TOUCHE PAS (2026-11-06) : c'est le lancement LOCAL
 *    (`npm run android:dev`, `scripts/android-dev.mjs`) — réécrire `tauri.conf.json` et
 *    `Cargo.toml` laisserait deux fichiers modifiés dans le dépôt à chaque essai. La publication
 *    passe toujours la version.
 */
const version = process.argv[2];
if (version !== undefined) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) arreter(`Version invalide : « ${version} » (attendu : 1.2.3).`);
  const cheminConf = join(dossierTauri, 'tauri.conf.json');
  const conf = JSON.parse(readFileSync(cheminConf, 'utf8'));
  conf.version = version;
  writeFileSync(cheminConf, `${JSON.stringify(conf, null, 2)}\n`);
  const cheminCargo = join(dossierTauri, 'Cargo.toml');
  writeFileSync(cheminCargo, readFileSync(cheminCargo, 'utf8').replace(/^version = ".*"$/m, `version = "${version}"`));
}

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

/** Le canal des notifications — le MÊME identifiant que `backend/.../push.service.js`. */
const CANAL_ALERTES = 'edtpro_alertes';

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
  /*
   * Le canal des notifications reçues application fermée (2026-11-06) : celui, en importance
   * haute, que crée `MainActivity` — pour qu'elles surgissent en popup, comme sur WhatsApp.
   */
  greffer(
    join(dossierAndroid, 'app', 'src', 'main', 'AndroidManifest.xml'),
    /<application\b[^>]*>/,
    `\n        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="${CANAL_ALERTES}" />`,
    'la balise <application> du manifeste'
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

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.MimeTypeMap
import android.widget.Toast
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
    creerCanalAlertes()
    PontPlay.activite = this
    PontFichiers.activite = this
    gestionnairePlay.registerListener(ecouteurPlay)
  }

  /**
   * Le canal des notifications eDTpro, en importance HAUTE (2026-11-06, demande du porteur :
   * « un popup sur le téléphone même si l'application est fermée, comme Facebook ou WhatsApp »).
   * C'est l'importance du CANAL — pas la priorité du message — qui fait surgir la notification
   * en haut de l'écran. Sans canal à soi, Android rangeait tout dans « Divers », sans popup.
   * Le serveur l'envoie sur ce canal (\`push.service.js\`) ; Firebase le prend aussi par défaut
   * (méta-donnée du manifeste). Recréer un canal existant ne change rien : l'appel est sans risque.
   */
  private fun creerCanalAlertes() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val canal = NotificationChannel("${CANAL_ALERTES}", "Alertes eDTpro", NotificationManager.IMPORTANCE_HIGH)
    canal.description = "Emploi du temps publié ou modifié, absences à saisir, messages"
    canal.enableVibration(true)
    getSystemService(NotificationManager::class.java)?.createNotificationChannel(canal)
  }

  override fun onResume() {
    super.onResume()
    verifierPlay()
  }

  override fun onDestroy() {
    gestionnairePlay.unregisterListener(ecouteurPlay)
    if (PontPlay.activite === this) PontPlay.activite = null
    if (PontFichiers.activite === this) PontFichiers.activite = null
    super.onDestroy()
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    val cookies = CookieManager.getInstance()
    cookies.setAcceptCookie(true)
    cookies.setAcceptThirdPartyCookies(webView, true)
    webView.addJavascriptInterface(PontPlay, "EdtproPlay")
    // Les documents téléchargés : la WebView ignore les liens « download » (2026-11-06).
    webView.addJavascriptInterface(PontFichiers, "EdtproFichiers")${firebaseCode}
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
}

/**
 * Les documents téléchargés (2026-11-06, retour du porteur : « en mobile, les documents ne se
 * téléchargent pas »). La WebView ignore le lien « download » de la page : la page passe ici le
 * contenu (base64), et le fichier est écrit dans Téléchargements par le MediaStore — sans
 * permission de stockage depuis Android 10. Visible ensuite dans « Fichiers », comme tout
 * téléchargement. La page lit \`window.EdtproFichiers\` (\`src/lib/telechargementApplication.js\`).
 */
object PontFichiers {
  @Volatile var activite: MainActivity? = null

  /** Le canal des avis « Téléchargement terminé » — distinct des alertes. */
  private const val CANAL_TELECHARGEMENTS = "edtpro_telechargements"
  private var prochainAvis = 3000

  /**
   * Le TYPE d'un fichier, d'après son extension (2026-11-06, retour du porteur : « Ouvrir ne
   * marche pas »). Celui que donne la page peut porter un suffixe (« ; charset=utf-8 ») ou être
   * vide : Android ne trouvait alors aucune application pour l'ouvrir, et rien ne se passait.
   */
  private fun typeDe(nom: String, recu: String): String {
    val extension = nom.substringAfterLast('.', "").lowercase()
    return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
      ?: recu.substringBefore(';').trim().ifEmpty { "application/octet-stream" }
  }

  /** « Ouvrir avec… » ; le droit de lecture accordé à l'application choisie. */
  private fun intentionOuvrir(adresse: Uri, type: String): Intent {
    val voir = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(adresse, type)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    return Intent.createChooser(voir, "Ouvrir avec").apply { addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
  }

  /** Écrit le fichier ; rend son adresse (content://…), ou "" si l'écriture échoue. */
  @JavascriptInterface
  fun enregistrer(nom: String, mime: String, base64: String): String {
    val activite = activite ?: return ""
    // Avant Android 10, le dossier partagé demande une permission que l'application n'a pas.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return ""
    return try {
      val type = typeDe(nom, mime)
      val octets = Base64.decode(base64, Base64.DEFAULT)
      val valeurs = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, nom)
        put(MediaStore.MediaColumns.MIME_TYPE, type)
        put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
      }
      val resolveur = activite.contentResolver
      val adresse = resolveur.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, valeurs) ?: return ""
      val flux = resolveur.openOutputStream(adresse) ?: return ""
      flux.use { it.write(octets) }
      avertir(activite, nom, adresse, type)
      adresse.toString()
    } catch (e: Exception) {
      ""
    }
  }

  /** Ouvre le fichier avec l'application choisie par la personne (tableur, lecteur PDF…). */
  @JavascriptInterface
  fun ouvrir(adresse: String, mime: String): Boolean {
    val activite = activite ?: return false
    val uri = Uri.parse(adresse)
    // Le type ENREGISTRÉ par le MediaStore — celui que l'extension a donné à l'écriture.
    val type = activite.contentResolver.getType(uri) ?: typeDe("", mime)
    activite.runOnUiThread {
      try {
        activite.startActivity(intentionOuvrir(uri, type))
      } catch (e: Exception) {
        Toast.makeText(activite, "Aucune application de ce téléphone ne peut ouvrir ce fichier.", Toast.LENGTH_LONG).show()
      }
    }
    return true
  }

  /**
   * L'avis « Téléchargement terminé » dans le volet des notifications, comme un navigateur
   * (2026-11-06, demande du porteur) — le toucher ouvre le fichier. Rien si la personne a refusé
   * les notifications : le fichier est enregistré quand même, et la page l'annonce.
   */
  @android.annotation.TargetApi(Build.VERSION_CODES.Q) // appelée seulement par enregistrer(), Android 10+
  private fun avertir(activite: MainActivity, nom: String, adresse: Uri, type: String) {
    if (Build.VERSION.SDK_INT >= 33 &&
      activite.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return
    val gestionnaire = activite.getSystemService(NotificationManager::class.java) ?: return
    gestionnaire.createNotificationChannel(
      NotificationChannel(CANAL_TELECHARGEMENTS, "Téléchargements", NotificationManager.IMPORTANCE_DEFAULT)
    )
    val numero = prochainAvis++
    val toucher = PendingIntent.getActivity(
      activite, numero, intentionOuvrir(adresse, type),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    val avis = Notification.Builder(activite, CANAL_TELECHARGEMENTS)
      .setSmallIcon(android.R.drawable.stat_sys_download_done)
      .setContentTitle("Téléchargement terminé")
      .setContentText(nom)
      .setContentIntent(toucher)
      .setAutoCancel(true)
      .build()
    gestionnaire.notify(numero, avis)
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
  `✔ Android prêt : version ${version ?? 'inchangée (essai local)'}, ${activite.replace(racine, 'frontend')} (paquet ${paquet})` +
    (avecFirebase ? ', Firebase activé' : ', sans Firebase (pas de google-services.json)') +
    ', mise à jour Google Play' +
    `, thème appliqué à ${themes} fichier(s).`
);
