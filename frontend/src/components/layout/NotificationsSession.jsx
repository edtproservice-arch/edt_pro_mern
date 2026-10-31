import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ecouterNotifications } from '@/lib/tempsReel';
import { estApplicationTauri } from '@/lib/miseAJourDesktop';
import { afficherNotificationSysteme, demanderPermissionNotifications } from '@/lib/notificationsSysteme';

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
 */
export default function NotificationsSession() {
  const navigate = useNavigate();
  const cache = useQueryClient();

  useEffect(() => {
    if (estApplicationTauri()) {
      demanderPermissionNotifications();
      return undefined;
    }
    if (typeof window === 'undefined' || !('Notification' in window) || window.Notification.permission !== 'default') {
      return undefined;
    }
    const auPremierGeste = () => demanderPermissionNotifications();
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
        if (enArrierePlan) afficherNotificationSysteme({ titre, corps }, { surClic: voir });
      }),
    [navigate, cache]
  );

  return null;
}
