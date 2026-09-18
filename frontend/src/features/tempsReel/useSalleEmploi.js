import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useSalle } from './useSalle';
import { annonceDeModification } from './annonces';

/**
 * ⚠️ LES ANNONCES SONT REGROUPÉES AVANT RELECTURE. Un collage de vingt cases
 * chez un collègue produit vingt annonces en quelques centaines de
 * millisecondes : relire la semaine vingt fois ne servirait à rien, et
 * l'écran clignoterait. On attend que la rafale se calme.
 */
const REGROUPEMENT_MS = 250;

/**
 * La salle `emploi`, partagée par l'écran de saisie (« Emploi ») et l'écran de
 * lecture (« Édition »). Les deux lisent les mêmes clés de cache — une
 * modification annoncée doit donc rafraîchir l'un comme l'autre.
 *
 * @param {{ ecran: 'emploi'|'edition', semaine, periode, anneeScolaire }} options
 */
export function useSalleEmploi({ ecran, semaine, periode, anneeScolaire }) {
  const cache = useQueryClient();
  const enAttente = useRef({ minuteur: null, semaines: new Set(), toutes: false });

  const relire = useCallback(() => {
    const lot = enAttente.current;
    lot.minuteur = null;

    if (lot.toutes) cache.invalidateQueries({ queryKey: ['emploi', 'semaine'] });
    else for (const s of lot.semaines) cache.invalidateQueries({ queryKey: ['emploi', 'semaine', s] });

    /*
     * ⚠️ LE CONTEXTE AUSSI, QUELLE QUE SOIT LA SEMAINE MODIFIÉE : il porte les
     * heures posées de TOUTE l'année, donc les taux d'avancement des cases. Une
     * pose en S12 change le badge d'un module affiché en S3.
     */
    cache.invalidateQueries({ queryKey: ['emploi', 'contexte'] });
    cache.invalidateQueries({ queryKey: ['emploi', 'semaines'] });
    cache.invalidateQueries({ queryKey: ['emploi', 'module'] });
    // La date « Modifié … » de la barre du haut suit ce qu'un collègue écrit.
    cache.invalidateQueries({ queryKey: ['modifications', 'emploi'] });

    lot.semaines = new Set();
    lot.toutes = false;
  }, [cache]);

  const surModification = useCallback(
    (message) => {
      const lot = enAttente.current;
      // Sans semaine (effacement de l'année, retrait de publication), c'est
      // toute la grille qui est concernée.
      if (message.semaine) lot.semaines.add(message.semaine);
      else lot.toutes = true;

      clearTimeout(lot.minuteur);
      lot.minuteur = setTimeout(relire, REGROUPEMENT_MS);

      const annonce = annonceDeModification(message);
      if (annonce) toast.info(annonce);
    },
    [relire]
  );

  useEffect(() => () => clearTimeout(enAttente.current.minuteur), []);

  /*
   * ═══ UN ACCÈS RETIRÉ OU CHANGÉ PENDANT QU'ON EST SUR LA PAGE ═══
   * On relit « mes partages » : la garde de route et le menu se mettent à jour
   * d'eux-mêmes — l'invité retiré quitte la page, celui qui passe en lecture est
   * renvoyé vers « Édition ». Le dire, sans quoi l'écran changerait sous ses yeux
   * sans explication.
   */
  const surAcces = useCallback(
    (message) => {
      cache.invalidateQueries({ queryKey: ['partages', 'moi'] });
      if (message.type === 'acces-retire') {
        toast.warning('Le directeur a retiré votre accès à l’emploi du temps');
      } else {
        toast.info(
          message.droit === 'modifier'
            ? 'Vous pouvez désormais modifier l’emploi du temps'
            : 'Vous ne pouvez plus que consulter l’emploi du temps'
        );
      }
    },
    [cache]
  );

  return useSalle('emploi', {
    anneeScolaire,
    vue: { ecran, semaine: semaine ?? null, periode },
    surModification,
    surAcces,
  });
}
