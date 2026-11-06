/*
 * ═══ LE SERVICE WORKER DES NOTIFICATIONS (2026-11-01) ═══
 * Reçoit les notifications Web Push d'EDT Pro et les affiche dans le système (centre de
 * notifications de Windows, barre d'Android…) — même SITE FERMÉ, tant que le navigateur tourne.
 * Le serveur les envoie : `backend/src/modules/notifications/push.service.js`.
 *
 * ⚠️ Un onglet EDT Pro AU PREMIER PLAN affiche déjà la notification dans la page (toast) :
 *    le système ne la redouble pas.
 * ⚠️ Rien d'autre ici — ni cache, ni hors-ligne : ce service worker ne fait que les notifications.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (evenement) => evenement.waitUntil(self.clients.claim()));

self.addEventListener('push', (evenement) => {
  let donnees = {};
  try {
    donnees = evenement.data ? evenement.data.json() : {};
  } catch {
    donnees = { titre: 'eDTpro', corps: evenement.data ? evenement.data.text() : '' };
  }

  evenement.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenetres) => {
      const auPremierPlan = fenetres.some((fenetre) => fenetre.visibilityState === 'visible' && fenetre.focused);
      if (auPremierPlan) return undefined;
      return self.registration.showNotification(donnees.titre || 'eDTpro', {
        body: donnees.corps || '',
        icon: '/favicon.png',
        badge: '/favicon.png',
        data: { lien: donnees.lien || '/app' },
        tag: `edtpro-${donnees.lien || 'app'}`,
        renotify: true,
      });
    })
  );
});

// Un clic : l'onglet EDT Pro déjà ouvert, mené à la page — sinon un nouvel onglet.
self.addEventListener('notificationclick', (evenement) => {
  evenement.notification.close();
  const lien = evenement.notification.data?.lien || '/app';
  const cible = new URL(lien, self.location.origin).href;

  evenement.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenetres) => {
      const ouverte = fenetres.find((fenetre) => new URL(fenetre.url).origin === self.location.origin);
      if (ouverte) {
        return ouverte.focus().then(() => ('navigate' in ouverte ? ouverte.navigate(cible) : undefined));
      }
      return self.clients.openWindow(cible);
    })
  );
});
