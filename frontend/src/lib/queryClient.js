import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

/**
 * ═══ ⚠️⚠️ TOUTE ÉCRITURE PÉRIME TOUTES LES LECTURES ═══
 * (2026-08-26, signalé par le porteur : « je marque une séance absente dans
 * l'emploi du temps, j'ouvre la page Absences, elle n'affiche rien — il faut
 * actualiser ».)
 *
 * ═══ LA CAUSE ═══
 * Chaque page déclarait à la main les clés que SES écritures périment — vingt-
 * deux fichiers le faisaient. Une écriture qui touche la donnée d'un AUTRE
 * écran n'y pensait pas : marquer une absence écrit une séance, le serveur
 * synchronise le registre des absences, et l'écran des absences continuait de
 * servir son cache. C'est la règle éparpillée du §4.2, appliquée au cache.
 *
 * ═══ POURQUOI L'INVALIDATION TOTALE, ET NON UNE TABLE DE DÉPENDANCES ═══
 * Une table « cette écriture périme ces clés » serait plus fine, mais elle est
 * une seconde source de vérité à tenir à jour : la prochaine fonctionnalité
 * l'oublierait comme les précédentes l'ont fait. Ici, il n'y a rien à déclarer.
 *
 * ⚠️ ET CE N'EST PAS AUSSI COÛTEUX QU'IL Y PARAÎT. `invalidateQueries()` sans
 * clé ne RECHARGE que les requêtes ACTIVES — celles des composants montés,
 * c'est-à-dire l'écran qu'on a sous les yeux, qui doit de toute façon refléter
 * ce qu'on vient d'écrire. Les autres sont seulement MARQUÉES périmées : elles
 * se rechargent à leur prochain montage, donc au moment où l'on ouvre l'écran.
 *
 * ⚠️ LES INVALIDATIONS DES PAGES RESTENT. Elles ne font plus double emploi par
 * hasard : certaines sont ATTENDUES avant de poursuivre — l'historique de
 * l'emploi du temps empile l'état d'après relecture, et le défaire écrivait un
 * état périmé quand la relecture n'était pas attendue. Ce filet-ci ne remplace
 * pas cette attente, il rattrape ce que personne n'a déclaré.
 */
/*
 * ═══ UN ACCÈS REFUSÉ FAIT RELIRE « MES PARTAGES » (Phase 5bis, étape d2) ═══
 * Quand le directeur retire une page à un invité qui n'est pas dessus, rien ne
 * le prévient : sa socket ne vit que sur les pages partagées ouvertes. Son menu
 * garde alors l'entrée, et la garde de route — qui lit le même cache — laisse
 * entrer. Le premier refus du serveur est donc le signal : on relit la liste,
 * le menu perd l'entrée, et la garde renvoie ailleurs.
 */
const CODES_ACCES = new Set(['PAGE_NON_PARTAGEE', 'DROIT_INSUFFISANT']);
const surErreur = (erreur) => {
  if (CODES_ACCES.has(erreur?.code)) queryClient.invalidateQueries({ queryKey: ['partages', 'moi'] });
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: surErreur }),
  mutationCache: new MutationCache({
    /*
     * ⚠️ UNE ÉCRITURE PEUT DEMANDER QU'ON NE RELISE RIEN (2026-09-19, signalé
     * par le porteur : « en local parfait, hébergé lent »).
     *
     * Le filet ci-dessus relit TOUTES les requêtes actives après chaque écriture
     * réussie. En local, où une requête coûte 1 ms, personne ne le voyait ;
     * hébergé, chaque relecture paie la latence du réseau — et l'emploi du temps
     * en déclenchait une dizaine (semaine, contexte, semaines, session, messages,
     * modifications…) après CHAQUE case déposée, alors que l'écran venait déjà de
     * se mettre à jour avec la réponse du serveur.
     *
     * Une mutation qui a déjà corrigé son propre cache se déclare
     * `meta: { invalidation: 'passive' }` : tout est alors seulement MARQUÉ
     * périmé (`refetchType: 'none'`) — les autres écrans se rechargent à leur
     * prochain montage, comme prévu plus haut, mais l'écran ouvert ne relit rien.
     * Sans cette déclaration, le comportement reste EXACTEMENT celui d'avant.
     *
     * ⚠️ LA MUTATION SE TROUVE PAR SA FORME, pas par sa position : ce callback a
     * changé de signature d'une version de TanStack Query à l'autre.
     */
    onSuccess: (...arguments_) => {
      const mutation = arguments_.find((a) => a && typeof a === 'object' && 'mutationId' in a);
      if (mutation?.options?.meta?.invalidation === 'passive') {
        queryClient.invalidateQueries({ refetchType: 'none' });
        return;
      }
      queryClient.invalidateQueries();
    },
    onError: surErreur,
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      /*
       * ⚠️ Le retour sur l'onglet NE recharge pas : sur une grille en cours de
       * saisie, un rechargement déclenché par un simple changement de fenêtre
       * ferait clignoter l'écran sans qu'on l'ait demandé. La péremption
       * ci-dessus suffit — elle agit au moment où l'on ouvre l'écran.
       */
      refetchOnWindowFocus: false,
    },
  },
});
