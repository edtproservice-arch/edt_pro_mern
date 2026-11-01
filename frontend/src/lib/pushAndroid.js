import { api } from '@/lib/apiClient';
import { estApplicationAndroid } from '@/lib/miseAJourDesktop';

/**
 * ═══ ABONNER CE TÉLÉPHONE AUX NOTIFICATIONS FIREBASE (2026-11-01) ═══ Pour qu'Android affiche
 * les notifications d'EDT Pro même APPLICATION FERMÉE — « comme Facebook ». L'activité Android
 * (écrite par `scripts/preparer-android.mjs`) obtient le jeton Firebase de l'appareil et le
 * rend lisible ici (`window.EdtproAndroid.jetonFcm()`) ; on l'envoie au serveur.
 *
 * ⚠️ RIEN SI L'APK N'A PAS FIREBASE (pas de `google-services.json` à la compilation) : le pont
 *    n'existe pas, et l'application garde ses notifications « ouverte » seulement.
 */
const ATTENTE_MAX_MS = 15000;

/** Le jeton Firebase, dès que l'activité l'a reçu — `null` après 15 s ou sans pont. */
async function jetonFcm() {
  const pont = typeof window !== 'undefined' ? window.EdtproAndroid : null;
  if (!pont?.jetonFcm) return null;
  for (let attendu = 0; attendu <= ATTENTE_MAX_MS; attendu += 500) {
    const jeton = String(pont.jetonFcm() ?? '');
    if (jeton) return jeton;
    await new Promise((resoudre) => setTimeout(resoudre, 500));
  }
  return null;
}

/** Abonne ce téléphone. @returns {Promise<boolean>} abonné ou non. */
export async function activerPushAndroid() {
  if (!estApplicationAndroid()) return false;
  try {
    const jeton = await jetonFcm();
    if (!jeton) return false;
    await api.post('/api/v2/notifications/abonnements', { type: 'fcm', jeton, appareil: 'Android' });
    return true;
  } catch {
    return false;
  }
}
