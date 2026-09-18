import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { libellePage } from 'shared/domain';
import { useSalle } from './useSalle';

/** Même regroupement que la salle `emploi` : une rafale d'annonces, une relecture. */
const REGROUPEMENT_MS = 250;

/**
 * La salle d'une page partagée AUTRE que l'emploi du temps (Phase 5bis, étape d).
 *
 * `useSalleEmploi` sait quelles semaines relire ; une page de réglages n'a pas de
 * semaine — elle relit ses propres clés de cache (`clesARelire`), toutes, dès
 * qu'un collègue y écrit.
 *
 * ⚠️ `clesARelire` EST COMPARÉE PAR SA FORME, jamais par référence : un tableau
 * écrit en place change à chaque rendu.
 *
 * @param {string} page  une clé du registre `PAGES_PARTAGEABLES`
 * @param {{ anneeScolaire, clesARelire?: unknown[][] }} options
 */
/*
 * `appliquer(message)` (2026-09-13) : une page peut appliquer ELLE-MÊME une
 * annonce qui porte la donnée écrite — le chronogramme reçoit le planning du
 * groupe et le pose dans son cache, sans relire. S'il rend `true`, seules
 * `clesApresApplication` sont relues (ce qui en DÉRIVE : charges, listes).
 */
export function useSallePage(
  page,
  { anneeScolaire, clesARelire = [], anneeParDefaut = false, appliquer, clesApresApplication = [] }
) {
  const cache = useQueryClient();
  const minuteur = useRef(null);
  const cles = useRef(clesARelire);
  cles.current = clesARelire;
  const application = useRef({ appliquer, clesApresApplication });
  application.current = { appliquer, clesApresApplication };
  const toutRelire = useRef(false);

  const surModification = useCallback((message) => {
    // À l'instant, sans attendre le regroupement : c'est tout l'intérêt.
    const applique = Boolean(application.current.appliquer?.(message));
    if (!applique) toutRelire.current = true;

    clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => {
      const aRelire = toutRelire.current ? cles.current : application.current.clesApresApplication;
      toutRelire.current = false;
      for (const cle of aRelire) cache.invalidateQueries({ queryKey: cle });
      // La date « Modifié … » de la barre du haut suit aussi ce qu'un collègue écrit.
      cache.invalidateQueries({ queryKey: ['modifications', page] });
    }, REGROUPEMENT_MS);
  }, [cache, page]);

  useEffect(() => () => clearTimeout(minuteur.current), []);

  // Un accès retiré ou changé : on relit « mes partages » — menu et garde suivent.
  const surAcces = useCallback(
    (message) => {
      cache.invalidateQueries({ queryKey: ['partages', 'moi'] });
      const nom = `« ${libellePage(page)} »`;
      if (message.type === 'acces-retire') {
        toast.warning(`Le directeur a retiré votre accès à ${nom}`);
      } else {
        toast.info(
          message.droit === 'modifier'
            ? `Vous pouvez désormais modifier ${nom}`
            : `Vous ne pouvez plus que consulter ${nom}`
        );
      }
    },
    [cache, page]
  );

  return useSalle(page, { anneeScolaire, vue: {}, surModification, surAcces, anneeParDefaut });
}
