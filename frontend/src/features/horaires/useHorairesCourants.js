import { useQuery } from '@tanstack/react-query';
import { HORAIRES_COURANTS_PAR_DEFAUT } from 'shared/domain';
import { chargerHorairesSeances } from './api';

/**
 * L'horaire EN VIGUEUR des créneaux — celui que l'administrateur a choisi (hiver, été ou
 * ramadan). (demande du porteur, 2026-09-20 : « ces changements s'appliquent dans toutes les
 * sessions ».) À passer à `agendaDuSujet` / `horaireCreneau`.
 *
 * ⚠️ TOUJOURS UNE TABLE UTILISABLE : le temps que la lecture réponde, ou si elle échoue, on
 * rend l'horaire d'hiver d'origine plutôt que `undefined` — un agenda ne doit pas se casser
 * parce qu'un réglage ne s'est pas chargé.
 *
 * ⚠️ CINQ MINUTES DE PÉREMPTION : ce réglage ne change que sur décision de l'administrateur.
 */
export function useHorairesCourants() {
  const requete = useQuery({
    queryKey: ['horaires-seances'],
    queryFn: chargerHorairesSeances,
    staleTime: 300_000,
    retry: false,
  });
  return requete.data?.courant ?? HORAIRES_COURANTS_PAR_DEFAUT;
}
