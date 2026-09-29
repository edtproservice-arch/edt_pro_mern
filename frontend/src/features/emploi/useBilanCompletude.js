import { useQuery } from '@tanstack/react-query';

import { chargerCompletude } from '@/features/chronogramme/api';

/**
 * Le bilan de conformité d'une semaine — UNE requête, partagée par le bouton
 * de la barre d'outils et le panneau à droite de la grille (2026-09-28).
 *
 * ⚠️ PAS D'ÉCHEC BRUYANT. Ce bilan est un indicateur, pas une donnée dont la
 *    page dépend : s'il échoue, la grille doit rester utilisable et le bouton
 *    disparaître, comme le `catch` silencieux de l'ancien.
 */
export function useBilanCompletude(semaine) {
  return useQuery({
    queryKey: ['chronogramme-completude', semaine],
    queryFn: () => chargerCompletude(semaine),
    enabled: Boolean(semaine),
    retry: false,
  });
}
