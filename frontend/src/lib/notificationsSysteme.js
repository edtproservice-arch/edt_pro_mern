import { estApplicationTauri } from '@/lib/miseAJourDesktop';

/**
 * ═══ LA NOTIFICATION DU SYSTÈME (2026-10-31) ═══ Celle qui s'affiche hors de l'application :
 * le centre de notifications de Windows, la barre d'Android, ou celle du navigateur.
 *   - Application (bureau ou Android) : le module Tauri `notification`.
 *   - Navigateur : l'API `Notification`, une fois la permission donnée.
 *
 * ⚠️ JAMAIS BLOQUANT : une notification refusée, ou un système qui n'en offre pas, ne
 *    change rien — l'application affiche de toute façon la sienne.
 */

/** Demande la permission si elle n'a encore été ni donnée ni refusée. @returns {Promise<boolean>} */
export async function demanderPermissionNotifications() {
  try {
    if (estApplicationTauri()) {
      const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
      if (await isPermissionGranted()) return true;
      return (await requestPermission()) === 'granted';
    }
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (window.Notification.permission === 'default') await window.Notification.requestPermission();
    return window.Notification.permission === 'granted';
  } catch {
    return false;
  }
}

/**
 * Affiche `{ titre, corps }` dans le système ; `surClic` (navigateur) ramène à la page concernée.
 * Rien si la permission manque.
 */
export async function afficherNotificationSysteme({ titre, corps = '' }, { surClic = null } = {}) {
  try {
    if (estApplicationTauri()) {
      const { isPermissionGranted, sendNotification } = await import('@tauri-apps/plugin-notification');
      if (await isPermissionGranted()) sendNotification({ title: titre, body: corps });
      return;
    }
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (window.Notification.permission !== 'granted') return;
    const notification = new window.Notification(titre, { body: corps, icon: '/favicon.png' });
    notification.onclick = () => {
      window.focus();
      surClic?.();
      notification.close();
    };
  } catch {
    // Notification du système indisponible : celle de l'application suffit.
  }
}
