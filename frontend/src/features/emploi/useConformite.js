import { useQuery } from '@tanstack/react-query';

import { chargerConformite } from './api';

/**
 * Publier et éditer une semaine exige 100 % du chronogramme, sauf emploi délié
 * (2026-10-10, demande du porteur). Le serveur refuse de toute façon ; ce hook
 * grise les boutons d'avance.
 *
 * ⚠️ LA CLÉ COMMENCE PAR `chronogramme-completude` : chaque geste sur la grille
 *    invalide déjà ce préfixe pour rafraîchir le badge du taux — le verdict
 *    suit donc sans une invalidation de plus à tenir.
 */
export function useConformite(semaine) {
  return useQuery({
    queryKey: ['chronogramme-completude', 'conformite', semaine],
    queryFn: () => chargerConformite(semaine),
    enabled: Boolean(semaine),
    retry: false,
  });
}

/** Le texte qui dit pourquoi c'est grisé. */
export const raisonBlocage = (conformite, action) =>
  conformite?.bloquee
    ? `${action} impossible : ${conformite.taux} % du chronogramme. Atteignez 100 % ou déliez l’emploi du temps.`
    : undefined;
