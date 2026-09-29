import { useQuery } from '@tanstack/react-query';
import { retenirRentrees } from 'shared/domain';

import { chargerCalendrier } from '@/features/configuration/api';

/**
 * Retient l'ancre de S1 de l'année scolaire active — AVANT que les pages
 * s'affichent (2026-09-28, défaut signalé par le porteur : la barre annonçait
 * « S1 du 7 au 13 sept », la grille « lundi 31/08 »).
 *
 * S1 est la semaine de la rentrée (décision du 2026-09-25). Chaque calcul de
 * date de semaine du navigateur — navigation, calendriers, EFM, absences — lit
 * désormais cette ancre dans `shared/domain` (`ancres.js`) quand on ne lui
 * passe rien : il suffit de la retenir ICI, une fois.
 *
 * ⚠️ `['calendrier']` EST LA ROUTE que lisent déjà le sélecteur de semaine et
 *    le décor des calendriers : la même réponse, donc la même ancre partout.
 *    Clé propre (`ancre-rentrees`) pour que SON `queryFn` — celui qui retient —
 *    soit toujours celui qui s'exécute.
 *
 * @returns {{pret: boolean}} faux tant que l'ancre n'est pas connue
 */
export function useAncreRentrees(actif) {
  const requete = useQuery({
    queryKey: ['ancre-rentrees'],
    queryFn: async () => {
      const calendrier = await chargerCalendrier();
      if (Number.isInteger(calendrier?.anneeScolaire)) {
        retenirRentrees(calendrier.anneeScolaire, calendrier.rentrees ?? []);
      }
      return calendrier;
    },
    enabled: actif,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  /*
   * ⚠️ UN ÉCHEC NE BLOQUE PAS L'APPLICATION : un compte sans établissement
   *    configuré n'a pas de calendrier. On retombe alors sur le 1er septembre,
   *    comme avant — mais on ne laisse jamais l'écran vide.
   */
  return { pret: !actif || !requete.isPending };
}
