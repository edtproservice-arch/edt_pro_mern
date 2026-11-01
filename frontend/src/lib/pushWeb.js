import { api } from '@/lib/apiClient';
import { estApplicationTauri } from '@/lib/miseAJourDesktop';

/**
 * ═══ ABONNER CE NAVIGATEUR AUX NOTIFICATIONS PUSH (2026-11-01) ═══ Pour qu'un message, une
 * annonce ou l'emploi du temps s'annoncent dans le système même SITE FERMÉ — « comme Facebook ».
 * Le service worker `public/sw-notifications.js` les affiche ; le serveur garde l'abonnement
 * (`POST /api/v2/notifications/abonnements`).
 *
 * ⚠️ NAVIGATEUR SEULEMENT : l'application de bureau reste ouverte dans la zone de notification
 *    (sa socket suffit), l'application Android passe par Firebase.
 * ⚠️ RIEN SANS PERMISSION, ni sans clé VAPID côté serveur : l'abonnement est simplement sauté.
 */
const SERVICE_WORKER = '/sw-notifications.js';

/** `Uint8Array` de la clé publique VAPID (base64url), comme l'attend `pushManager.subscribe`. */
function versOctets(base64url) {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export const pushWebPossible = () =>
  !estApplicationTauri() &&
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

/**
 * Abonne ce navigateur, si la permission est donnée. @returns {Promise<boolean>} abonné ou non.
 */
export async function activerPushWeb() {
  if (!pushWebPossible() || window.Notification.permission !== 'granted') return false;
  try {
    const { cle } = await api.get('/api/v2/notifications/cle-publique');
    if (!cle) return false;
    const enregistrement = await navigator.serviceWorker.register(SERVICE_WORKER);
    await navigator.serviceWorker.ready;
    const abonnement =
      (await enregistrement.pushManager.getSubscription()) ??
      (await enregistrement.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: versOctets(cle) }));
    await api.post('/api/v2/notifications/abonnements', {
      type: 'web',
      abonnement: abonnement.toJSON(),
      appareil: navigator.userAgent.slice(0, 200),
    });
    return true;
  } catch {
    return false;
  }
}
