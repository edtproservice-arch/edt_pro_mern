/**
 * ═══ SE CONNECTER EN SCANNANT LA CARTE DE STAGIAIRE — APPLICATION MOBILE (2026-10-31) ═══
 * (demande du porteur : « seulement en application mobile, un bouton scan QR : si je scanne, se
 * connecte directement à ce compte sur l'app ».) Le QR de la carte porte le lien de connexion
 * directe `https://edtpro.tech/carte/<jeton>` (voir `backend/src/modules/auth/jetonCarte.js`) :
 * scanné DANS l'application, il n'ouvre pas le navigateur — l'application suit elle-même
 * `/carte/<jeton>`, dont la page ouvre la session (`PageConnexionCarte`).
 *
 * ⚠️ SEULS LES QR DE CONNEXION EDT PRO sont suivis : un autre lien, scanné par erreur, ne mène
 *    nulle part. Le jeton est de toute façon vérifié (signé) par le serveur.
 *
 * ═══ LE SCAN SE FAIT DANS L'APPLICATION, PAS PAR LE MODULE NATIF (même jour) ═══
 * `tauri-plugin-barcode-scanner` plantait dans son code Android (« null object reference »),
 * en plein écran comme en mode fenêtré. Il ne sert plus qu'à OBTENIR l'autorisation de la
 * caméra ; la caméra s'affiche dans la page (getUserMedia) et le QR est décodé ici — par le
 * détecteur d'Android quand la WebView l'offre (BarcodeDetector), sinon par jsQR.
 */
import jsQR from 'jsqr';

/** Les adresses dont un QR de carte peut venir : le site, et l'API visée par l'application. */
function hotesAdmis() {
  const hotes = new Set(['edtpro.tech', 'www.edtpro.tech']);
  try {
    const api = import.meta.env?.VITE_API_URL;
    if (api) hotes.add(new URL(api).hostname);
  } catch {
    // Adresse d'API absente ou illisible : les hôtes du site suffisent.
  }
  return hotes;
}

/**
 * Le jeton d'un QR de carte — `null` si ce n'est pas un lien de connexion EDT Pro.
 * @param {string} contenu  le texte lu dans le QR
 * @param {Set<string>} [hotes]
 */
export function jetonDuQr(contenu, hotes = hotesAdmis()) {
  let adresse;
  try {
    adresse = new URL(String(contenu ?? '').trim());
  } catch {
    return null;
  }
  if (!['https:', 'http:'].includes(adresse.protocol) || !hotes.has(adresse.hostname)) return null;
  const correspondance = /^\/carte\/([^/]+)\/?$/.exec(adresse.pathname);
  return correspondance ? decodeURIComponent(correspondance[1]) : null;
}

const erreurPermission = () => {
  const erreur = new Error('L’accès à la caméra est refusé.');
  erreur.code = 'PERMISSION';
  return erreur;
};

/**
 * L'autorisation Android de la caméra, par le module natif (cette partie-là fonctionne). Hors
 * de l'application — ou module absent —, getUserMedia demandera lui-même.
 * @throws {Error} `code: 'PERMISSION'` si elle est refusée
 */
export async function demanderCamera() {
  let module;
  try {
    module = await import('@tauri-apps/plugin-barcode-scanner');
  } catch {
    return;
  }
  let permission = await module.checkPermissions();
  if (permission !== 'granted') permission = await module.requestPermissions();
  if (permission !== 'granted') throw erreurPermission();
}

/**
 * La caméra arrière, dans un `<video>` de la page.
 * @returns {Promise<MediaStream>}
 */
export async function ouvrirCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Caméra indisponible sur cet appareil.');
  let flux;
  try {
    flux = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (erreur) {
    if (erreur?.name === 'NotAllowedError' || erreur?.name === 'SecurityError') throw erreurPermission();
    if (erreur?.name === 'NotFoundError') throw new Error('Aucune caméra trouvée sur cet appareil.');
    throw erreur;
  }
  video.srcObject = flux;
  await video.play();
  return flux;
}

/** Arrête la caméra (le voyant s'éteint). */
export function fermerCamera(flux) {
  for (const piste of flux?.getTracks?.() ?? []) piste.stop();
}

/**
 * Un décodeur : `(video) => Promise<string|null>`, le texte du QR visible dans l'image, s'il y en a.
 * BarcodeDetector quand la WebView sait lire les QR, sinon jsQR sur une image réduite.
 */
export async function creerDecodeur() {
  try {
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes('qr_code')) {
        const detecteur = new window.BarcodeDetector({ formats: ['qr_code'] });
        return async (video) => (await detecteur.detect(video))[0]?.rawValue ?? null;
      }
    }
  } catch {
    // Détecteur indisponible : jsQR prend le relais.
  }

  const toile = document.createElement('canvas');
  const contexte = toile.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    const largeurVideo = video.videoWidth;
    const hauteurVideo = video.videoHeight;
    if (!largeurVideo || !hauteurVideo) return null;
    // 720 px de large suffisent pour un QR qui remplit le cadre, et restent rapides à décoder.
    const echelle = Math.min(1, 720 / largeurVideo);
    toile.width = Math.round(largeurVideo * echelle);
    toile.height = Math.round(hauteurVideo * echelle);
    contexte.drawImage(video, 0, 0, toile.width, toile.height);
    const image = contexte.getImageData(0, 0, toile.width, toile.height);
    return jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

/** Les réglages de l'application, pour autoriser la caméra après un refus. */
export async function ouvrirReglagesApplication() {
  const { openAppSettings } = await import('@tauri-apps/plugin-barcode-scanner');
  await openAppSettings();
}
