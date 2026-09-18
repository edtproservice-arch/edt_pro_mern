import { useQuery } from '@tanstack/react-query';
import { chargerEtablissementCourant } from '@/features/configuration/api';
import { useBrouillonVersionne } from '@/lib/useBrouillonVersionne';

/**
 * Une liste de l'établissement — espaces, stages, formations, groupes FQ —
 * éditée en place, sous version optimiste (Phase 5bis, étape d3).
 *
 * Les quatre pages suivaient déjà le même schéma — état local initialisé une
 * fois, liste entière renvoyée à chaque pause — qu'elles recopiaient chacune.
 * Y ajouter la version et le 409 quatre fois, c'était quatre occasions d'en
 * oublier une moitié.
 *
 * @param {'espaces' | 'stages' | 'formations' | 'groupesFq'} champ
 * @param {(liste: unknown[], version: number) => Promise<object>} ecrire  la fonction d'API
 */
export function useListeEtablissement(champ, ecrire, { onSucces } = {}) {
  const contexte = useQuery({
    queryKey: ['etablissement-courant'],
    queryFn: chargerEtablissementCourant,
    retry: false,
  });

  const brouillon = useBrouillonVersionne({
    donnees: contexte.data,
    extraire: (donnees) =>
      donnees?.etablissement
        ? {
            valeur: donnees.etablissement[champ] ?? [],
            version: donnees.etablissement.versions?.[champ] ?? 0,
          }
        : null,
    enregistrer: async (liste, version) => {
      const reponse = await ecrire(liste, version);
      return { valeur: reponse[champ], version: reponse.version };
    },
    relire: async () => (await contexte.refetch()).data,
    onSucces,
  });

  return { contexte, ...brouillon };
}
