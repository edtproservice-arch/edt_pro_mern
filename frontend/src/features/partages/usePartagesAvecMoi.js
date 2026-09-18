import { useQuery } from '@tanstack/react-query';
import { ROLES } from 'shared/constants';
import { recupererSession } from '@/features/auth/api';
import { chargerMesPartages } from './api';

/** Les rôles qui peuvent se voir partager une page (le directeur en est propriétaire). */
const ROLES_CONCERNES = [ROLES.FORMATEUR, ROLES.GESTIONNAIRE];

/**
 * Les pages partagées avec la personne connectée — pour le menu et les gardes.
 *
 * ⚠️ UNE SEULE CLÉ DE CACHE (`['partages', 'moi']`) pour tous les lecteurs :
 * la barre, la garde de route et l'écran de la page. Une invitation retirée
 * l'invalide (message `acces-retire` de la socket) : les trois se mettent à jour
 * ensemble, et l'écran ne peut pas montrer un menu que la garde refuse.
 *
 * @returns {{ pages, charge: boolean, droitSur: (page) => string|null }}
 */
export function usePartagesAvecMoi() {
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  const role = session.data?.utilisateur?.role;
  /*
   * ⚠️ ET L'ADMINISTRATEUR EN COLLABORATION (2026-09-14) : ses pages lui viennent
   * de là, comme à un invité. Oublié, sa liste restait vide — la garde renvoyait
   * `/app/emploi` vers `/app`, qui le renvoyait vers `/app/emploi` : une boucle
   * de redirections (« Maximum update depth exceeded »), trouvée à l'écran.
   */
  const concerne =
    ROLES_CONCERNES.includes(role) || (role === ROLES.ADMIN && Boolean(session.data?.collaboration));

  const partages = useQuery({
    queryKey: ['partages', 'moi'],
    queryFn: chargerMesPartages,
    enabled: concerne,
    retry: false,
    staleTime: 60_000,
  });

  const pages = partages.data ?? [];
  return {
    role,
    pages,
    // Tant que la session ou la liste n'a pas répondu, on ne sait pas — et une
    // garde qui redirigerait pendant ce temps renverrait un invité légitime.
    charge: !session.isLoading && (!concerne || !partages.isLoading),
    droitSur: (page) => {
      if (role === ROLES.DIRECTEUR) return 'proprietaire';
      return pages.find((p) => p.page === page)?.droit ?? null;
    },
  };
}
