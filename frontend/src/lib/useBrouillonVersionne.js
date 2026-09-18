import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BROUILLON_VIDE,
  adopter,
  egaliteJson,
  enregistre,
  estModifie,
  recevoirServeur,
  saisir,
} from './brouillonVersionne';

export const estVersionPerimee = (erreur) => erreur?.code === 'VERSION_PERIMEE';

/**
 * Le brouillon d'une page « tout ou rien », branché sur sa requête et son
 * écriture (Phase 5bis, étape d3). La RÈGLE vit dans `brouillonVersionne.js`,
 * testée ; ce crochet ne fait que la relier à React et à TanStack.
 *
 * ═══ SUR UN 409 ═══
 * Le serveur a refusé : un collègue a enregistré entre-temps. On le DIT (toast),
 * on RELIT, et la page reprend la version en place — la saisie refusée est
 * abandonnée. C'est la décision du porteur (« refus, puis rechargement ») : la
 * fusionner en silence ferait croire enregistré ce qui ne l'est pas.
 *
 * @param {object} options
 * @param {unknown} options.donnees  `requete.data` — référence stable d'un rendu à l'autre
 * @param {(donnees: unknown) => ({ valeur: unknown, version: number } | null)} options.extraire
 * @param {(valeur: unknown, version: number) => Promise<{ valeur?: unknown, version: number }>} options.enregistrer
 * @param {() => Promise<unknown>} options.relire  relit la requête et rend ses données
 * @param {(resultat: object, envoye: unknown) => void} [options.onSucces]
 */
export function useBrouillonVersionne({ donnees, extraire, enregistrer, relire, onSucces }) {
  const [etat, setEtat] = useState(BROUILLON_VIDE);

  // La mutation lit la version AU MOMENT de l'envoi, pas celle du rendu qui l'a créée.
  const etatCourant = useRef(etat);
  etatCourant.current = etat;

  // Écrites en place par l'appelant, ces fonctions changent à chaque rendu : les
  // mettre en dépendance relancerait l'effet sans fin.
  const rappels = useRef({ extraire, relire, onSucces });
  rappels.current = { extraire, relire, onSucces };

  useEffect(() => {
    if (donnees === undefined) return;
    setEtat((courant) => recevoirServeur(courant, rappels.current.extraire(donnees), egaliteJson));
  }, [donnees]);

  const mutation = useMutation({
    mutationFn: (valeur) => enregistrer(valeur, etatCourant.current.version),
    onSuccess: (resultat, envoye) => {
      setEtat((courant) =>
        enregistre(courant, { envoye, retour: resultat?.valeur, version: resultat?.version }, egaliteJson)
      );
      rappels.current.onSucces?.(resultat, envoye);
    },
    onError: async (erreur) => {
      if (!estVersionPerimee(erreur)) {
        toast.error('Enregistrement impossible', { description: erreur.message });
        return;
      }

      toast.warning('Modifiée entre-temps par quelqu’un d’autre', {
        description:
          'Votre dernière modification n’a pas été enregistrée : la page affiche maintenant la version en place.',
      });

      const frais = rappels.current.extraire(await rappels.current.relire());
      if (frais) setEtat((courant) => adopter(courant, frais));
    },
  });

  const setBrouillon = useCallback((valeur) => setEtat((courant) => saisir(courant, valeur)), []);
  const lancer = useCallback(() => mutation.mutate(etatCourant.current.brouillon), [mutation]);

  return {
    charge: etat.charge,
    brouillon: etat.brouillon,
    setBrouillon,
    version: etat.version,
    modifie: estModifie(etat, egaliteJson),
    enCours: mutation.isPending,
    /*
     * ⚠️ UN 409 RESTE UN ÉCHEC À L'ÉCRAN, jusqu'à la prochaine saisie. Il n'y a
     * plus rien en attente — la page vient d'être rechargée — mais l'indicateur
     * annoncerait sinon « Enregistré » juste sous le toast qui dit le contraire :
     * vérifié à l'écran, les deux se contredisaient. « Non enregistré » est vrai.
     */
    echec: mutation.isError,
    enregistrer: lancer,
  };
}

/**
 * Ce que `CadreReglage` attend pour enregistrer seul, et offrir « Défaire ».
 *
 * ⚠️ RIEN EN LECTURE SEULE : ni indicateur d'enregistrement (il annoncerait une
 * écriture qui n'aura jamais lieu), ni « Défaire » (il n'y a rien à défaire).
 */
export function proprietesEnregistrement(brouillon, lectureSeule) {
  if (lectureSeule) return {};
  return {
    modifie: brouillon.modifie,
    enCours: brouillon.enCours,
    echec: brouillon.echec,
    onEnregistrer: brouillon.enregistrer,
    valeur: brouillon.brouillon,
    onRestaurer: brouillon.setBrouillon,
  };
}
