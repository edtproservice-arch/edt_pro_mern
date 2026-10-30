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
 */

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

/**
 * Ouvre la caméra en plein écran et rend le texte du QR scanné.
 * @returns {Promise<string>}
 * @throws {Error} `code` : `PERMISSION` (caméra refusée) — sinon l'erreur du scanner
 */
export async function scannerQr() {
  const { Format, checkPermissions, requestPermissions, scan } = await import('@tauri-apps/plugin-barcode-scanner');
  let permission = await checkPermissions();
  if (permission !== 'granted') permission = await requestPermissions();
  if (permission !== 'granted') {
    const erreur = new Error('L’accès à la caméra est refusé.');
    erreur.code = 'PERMISSION';
    throw erreur;
  }
  const resultat = await scan({ windowed: false, formats: [Format.QRCode] });
  return resultat?.content ?? '';
}

/** Les réglages de l'application, pour autoriser la caméra après un refus. */
export async function ouvrirReglagesApplication() {
  const { openAppSettings } = await import('@tauri-apps/plugin-barcode-scanner');
  await openAppSettings();
}
