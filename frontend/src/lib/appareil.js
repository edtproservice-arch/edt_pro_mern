/**
 * Signalement de l'appareil courant.
 *
 * Alimente le suivi « appareils connectés » et la détection de connexion depuis
 * un appareil inconnu. ← login.html envoyait déjà `device_name` / `browser` /
 * `os`, mais chaque page recalculait ces valeurs à sa façon.
 *
 * Volontairement grossier : il ne s'agit pas d'identifier un appareil de façon
 * unique — ce serait du pistage — mais de reconnaître « le PC Windows sous
 * Chrome habituel » pour éviter de redemander un code à chaque connexion.
 */
export function decrireAppareil() {
  const ua = navigator.userAgent;

  const navigateur =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'inconnu';

  const os =
    /Windows NT/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /(iPhone|iPad|iPod)/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'inconnu';

  const type =
    /(iPad|Tablet)/.test(ua) ? 'tablette'
    : /(Mobi|Android|iPhone)/.test(ua) ? 'mobile'
    : 'desktop';

  return { nom: `${navigateur} sur ${os}`, navigateur, os, type };
}
