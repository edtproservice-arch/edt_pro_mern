import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ecouterNotifications } from '@/lib/tempsReel';
import { estApplicationTauri } from '@/lib/miseAJourDesktop';
import { afficherNotificationSysteme, demanderPermissionNotifications } from '@/lib/notificationsSysteme';
import { activerPushWeb, pushWebPossible } from '@/lib/pushWeb';
import { activerPushAndroid } from '@/lib/pushAndroid';

/**
 * ═══ LES NOTIFICATIONS DE LA SESSION (2026-10-31, demande du porteur : « des notifications lors
 * de la publication et du changement de l'emploi, d'une annonce ou d'un message, en toutes
 * sessions ») ═══ Monté une fois dans la coquille de l'application, pour TOUS les rôles :
 *   - dans l'application, un toast avec « Voir », qui mène à la page concernée ;
 *   - fenêtre en arrière-plan (autre onglet, application réduite, téléphone verrouillé tant que
 *     l'application tourne), AUSSI la notification du système ;
 *   - un message ou une annonce relit aussitôt le compteur de la messagerie.
 * Le serveur les émet : voir `backend/src/modules/notifications/notifications.service.js`.
 *
 * ⚠️ LA PERMISSION DU NAVIGATEUR se demande au premier geste de l'utilisateur (un clic) : les
 *    navigateurs ignorent une demande faite sans geste. L'application la demande d'emblée.
 * ⚠️ MÊME FERMÉ (2026-11-01) : une fois la permission donnée, le navigateur s'abonne au Web Push
 *    (`lib/pushWeb.js`) — son service worker affiche alors la notification du système, site
 *    fermé compris ; cette page ne la redouble pas.
 */
export default function NotificationsSession() {
  const navigate = useNavigate();
  const cache = useQueryClient();
  // Le navigateur (Web Push) ou le téléphone (Firebase) est abonné : c'est le push qui affiche la
  // notification du système — cette page ne la redouble pas.
  const pushActif = useRef(false);

  useEffect(() => {
    if (estApplicationTauri()) {
      // Android : la permission (Android 13+), puis le jeton Firebase s'il y en a un.
      demanderPermissionNotifications().then(() =>
        activerPushAndroid().then((actif) => (pushActif.current = actif))
      );
      return undefined;
    }
    if (typeof window === 'undefined' || !('Notification' in window)) return undefined;
    const abonner = () => {
      if (pushWebPossible()) activerPushWeb().then((actif) => (pushActif.current = actif));
    };
    if (window.Notification.permission === 'granted') {
      abonner();
      return undefined;
    }
    if (window.Notification.permission !== 'default') return undefined;
    const auPremierGeste = () => demanderPermissionNotifications().then((accordee) => accordee && abonner());
    window.addEventListener('pointerdown', auPremierGeste, { once: true });
    return () => window.removeEventListener('pointerdown', auPremierGeste);
  }, []);

  useEffect(
    () =>
      ecouterNotifications((notification) => {
        const { genre, titre, corps, lien } = notification;
        const voir = lien ? () => navigate(lien) : null;

        if (genre === 'message' || genre === 'annonce') {
          cache.invalidateQueries({ queryKey: ['messages'] });
        }

        toast.info(titre, {
          description: corps || undefined,
          duration: 8000,
          ...(voir ? { action: { label: 'Voir', onClick: voir } } : {}),
        });

        const enArrierePlan = typeof document !== 'undefined' && (document.hidden || !document.hasFocus());
        if (enArrierePlan && !pushActif.current) afficherNotificationSysteme({ titre, corps }, { surClic: voir });
      }),
    [navigate, cache]
  );

  return null;
}
