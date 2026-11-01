import { readFileSync } from 'node:fs';
import { logger } from '../../lib/logger.js';
import { AbonnementPush } from '../../models/AbonnementPush.js';

/**
 * ═══ LES NOTIFICATIONS PUSH — MÊME FERMÉ (2026-11-01, demande du porteur : « comme Facebook,
 * dans Windows et Android, à l'extérieur ») ═══
 *   - NAVIGATEUR : Web Push. Le service worker du site (`frontend/public/sw-notifications.js`)
 *     affiche la notification, le site fermé tant que le navigateur tourne.
 *     Configuration : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUJET (mailto:…).
 *   - ANDROID : Firebase Cloud Messaging. Android affiche lui-même la notification, l'application
 *     fermée. Configuration : FIREBASE_COMPTE_SERVICE (chemin du JSON du compte de service).
 *   - L'application de BUREAU, elle, ne s'arrête plus (zone de notification) : la socket suffit.
 *
 * ⚠️ SANS CONFIGURATION, RIEN NE PART — ET RIEN NE CASSE : chaque canal se désactive seul.
 * ⚠️ UN APPAREIL DISPARU (désinstallé, permission retirée) est oublié au premier refus : 404 / 410
 *    pour le web, jeton non enregistré pour FCM.
 */

let webPush;
async function canalWeb() {
  const { VAPID_PUBLIC_KEY: publique, VAPID_PRIVATE_KEY: privee, VAPID_SUJET: sujet } = process.env;
  if (!publique || !privee) return null;
  if (!webPush) {
    webPush = (await import('web-push')).default;
    webPush.setVapidDetails(sujet || 'mailto:edtproservice@gmail.com', publique, privee);
  }
  return webPush;
}

let messagerieFcm;
async function canalFcm() {
  const chemin = process.env.FIREBASE_COMPTE_SERVICE;
  if (!chemin) return null;
  if (!messagerieFcm) {
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const { getMessaging } = await import('firebase-admin/messaging');
    const app = getApps()[0] ?? initializeApp({ credential: cert(JSON.parse(readFileSync(chemin, 'utf8'))) });
    messagerieFcm = getMessaging(app);
  }
  return messagerieFcm;
}

/** La clé publique VAPID — `null` si le Web Push n'est pas configuré. */
export const cleWebPublique = () => process.env.VAPID_PUBLIC_KEY || null;

/**
 * Enregistre — ou reprend pour cette personne — l'abonnement d'un appareil.
 * @param {{ type: 'web'|'fcm', abonnement?: object, jeton?: string, appareil?: string }} demande
 */
export async function enregistrer(utilisateurId, { type, abonnement = null, jeton = null, appareil = '' }) {
  const cle = type === 'web' ? abonnement?.endpoint : jeton;
  await AbonnementPush.findOneAndUpdate(
    { cle },
    { utilisateurId, type, cle, abonnement: type === 'web' ? abonnement : null, appareil: String(appareil).slice(0, 200) },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

/** Oublie l'abonnement d'un appareil — seulement s'il est bien à cette personne. */
export async function retirer(utilisateurId, cle) {
  await AbonnementPush.deleteOne({ utilisateurId, cle });
}

/**
 * Envoie `notification` aux appareils abonnés de ces personnes. Jamais d'exception : un échec
 * se journalise, un appareil disparu s'oublie.
 * @param {string[]} utilisateurIds
 * @param {{ genre: string, titre: string, corps?: string, lien?: string }} notification
 */
export async function envoyerPush(utilisateurIds, notification) {
  if (!utilisateurIds?.length) return;
  const abonnements = await AbonnementPush.find({ utilisateurId: { $in: utilisateurIds } }).lean();
  if (abonnements.length === 0) return;
  const oublier = [];

  const web = abonnements.filter((a) => a.type === 'web');
  const pushWeb = web.length ? await canalWeb() : null;
  if (pushWeb) {
    const charge = JSON.stringify({ titre: notification.titre, corps: notification.corps ?? '', lien: notification.lien ?? '/app' });
    await Promise.all(
      web.map((a) =>
        pushWeb.sendNotification(a.abonnement, charge, { TTL: 24 * 3600, urgency: 'high' }).catch((erreur) => {
          if (erreur?.statusCode === 404 || erreur?.statusCode === 410) oublier.push(a.cle);
          else logger.warn({ err: erreur }, 'Notification Web Push non remise');
        })
      )
    );
  }

  const jetons = abonnements.filter((a) => a.type === 'fcm').map((a) => a.cle);
  const fcm = jetons.length ? await canalFcm() : null;
  if (fcm) {
    for (let i = 0; i < jetons.length; i += 500) {
      const lot = jetons.slice(i, i + 500);
      const reponse = await fcm.sendEachForMulticast({
        tokens: lot,
        notification: { title: notification.titre, body: notification.corps ?? '' },
        data: { lien: notification.lien ?? '/app', genre: notification.genre ?? '' },
        android: { priority: 'high', notification: { sound: 'default' } },
      });
      reponse.responses.forEach((r, index) => {
        const code = r.error?.code ?? '';
        if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
          oublier.push(lot[index]);
        } else if (r.error) {
          logger.warn({ err: r.error }, 'Notification FCM non remise');
        }
      });
    }
  }

  if (oublier.length) await AbonnementPush.deleteMany({ cle: { $in: oublier } });
}
