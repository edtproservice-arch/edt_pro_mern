import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ensemblesAReconstruire,
  reconstruireFormateurs,
  reconstruireGroupes,
} from 'shared/domain';
import { chargerBase, chargerModulesEnsembles } from '@/features/configuration/api';

/**
 * Carte déjà enregistrée, rendue à la forme de l'écran d'affectation.
 * ← initAffectationLogic() de affectation-carte.js:72-160
 *
 * ═══ DEUX SOURCES, PAS UNE ═══
 * `Base.affectations` ne garde que les lignes POURVUES d'un formateur, et n'en
 * retient que le code du module. Les intitulés, les masses horaires, les métiers
 * et surtout les modules ENCORE SANS FORMATEUR viennent de la répartition DRIF.
 * L'existant procédait exactement ainsi — la carte n'a jamais été rechargeable
 * depuis la seule base.
 */
export function useCarteEnregistree() {
  const base = useQuery({ queryKey: ['base'], queryFn: chargerBase, retry: false });
  const document = base.data?.base ?? null;

  /*
   * ⚠️ MÉMORISÉ, et ce n'est pas une micro-optimisation.
   *
   * L'écran remonte chaque modification à `PageAffectations`, qui la met dans
   * son état : la page se rend donc à CHAQUE frappe. Sans mémorisation, elle
   * rejouait à chaque fois `ensemblesAReconstruire()` puis surtout
   * `reconstruireGroupes()` — le croisement complet de la base (250
   * affectations) avec la répartition DRIF, pour un résultat aussitôt jeté,
   * puisque la carte affichée vit dans l'état de `useCarte`. C'est la cause
   * principale de la lenteur de la page.
   *
   * Ces deux calculs ne dépendent que de ce qui vient du serveur : ils n'ont
   * aucune raison d'être refaits tant que la base ne change pas.
   */
  const { ensembles, groupesSansFiliere } = useMemo(
    () => (document ? ensemblesAReconstruire(document) : { ensembles: [], groupesSansFiliere: [] }),
    [document]
  );

  /*
   * UN SEUL appel pour tous les ensembles (filière, année).
   *
   * Il y en avait un par ensemble, lancés en parallèle — dix pour une carte de
   * seize groupes. Mais « en parallèle » ne veut pas dire « en même temps » : le
   * navigateur n'ouvre que six connexions par origine, et chaque appel repayait
   * la vérification du jeton et un aller-retour vers Atlas. Mesuré sur la base
   * réelle : 335 ms pour les dix requêtes, 128 ms pour celle-ci.
   */
  const referentiel = useQuery({
    queryKey: ['repartition-ensembles', ensembles],
    enabled: ensembles.length > 0,
    retry: false,
    queryFn: async () => new Map(Object.entries((await chargerModulesEnsembles(ensembles)).ensembles ?? {})),
  });

  const prete = base.isSuccess && (ensembles.length === 0 || referentiel.isSuccess);

  // `null` tant que tout n'est pas là : monter la carte à moitié garnie ferait
  // clignoter des groupes vides puis remplis.
  const carte = useMemo(
    () =>
      prete
        ? {
            groupes: reconstruireGroupes(document, referentiel.data ?? new Map()),
            formateurs: reconstruireFormateurs(document),
          }
        : null,
    [prete, document, referentiel.data]
  );

  return {
    chargement: base.isLoading || (ensembles.length > 0 && referentiel.isLoading),
    erreur: base.error?.message ?? referentiel.error?.message ?? null,
    carte,
    // Ces groupes n'ont pas de filière connue : leurs modules resteront vides,
    // et l'écran doit le dire plutôt que de laisser croire à une carte amputée.
    groupesSansFiliere,
    existe: Boolean(document),
    // La version de la base dont la carte est tirée (Phase 5bis, étape d3) : la
    // carte la renvoie, et le serveur refuse si un collègue a enregistré depuis.
    version: document?.version ?? 0,
    relire: () => base.refetch(),
  };
}
