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
  renoncer,
  saisir,
} from './brouillonVersionne';

export const estVersionPerimee = (erreur) => erreur?.code === 'VERSION_PERIMEE';

/** Le serveur demande un oui avant de supprimer des séances (`modules/fermetures`). */
export const demandeConfirmation = (erreur) => erreur?.code === 'PERIODES_SUPPRESSIONS';

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
 * ═══ SUR UN 409 « PERIODES_SUPPRESSIONS » (2026-09-23) ═══
 * Rien n'a été écrit : l'enregistrement supprimerait des séances. Le crochet
 * garde la saisie et les chiffres dans `suppressionsAConfirmer` ; la page
 * affiche la question, puis `confirmerSuppressions()` renvoie la MÊME saisie
 * avec le drapeau, ou `renoncerSuppressions()` revient à ce qui est en base.
 * ⚠️ Tant que la question est posée, l'enregistrement automatique est suspendu :
 * il se relancerait sinon à chaque pause, et reposerait la même question.
 *
 * @param {(valeur: unknown, version: number, options: { confirmerSuppressions?: boolean }) =>
 *   Promise<{ valeur?: unknown, version: number }>} options.enregistrer
 * @param {() => Promise<unknown>} options.relire  relit la requête et rend ses données
 * @param {(resultat: object, envoye: unknown) => void} [options.onSucces]
 */
export function useBrouillonVersionne({ donnees, extraire, enregistrer, relire, onSucces }) {
  const [etat, setEtat] = useState(BROUILLON_VIDE);
  const [aConfirmer, setAConfirmer] = useState(null);
  /*
   * ⚠️ LA QUESTION EN ATTENTE VIT AUSSI DANS UNE RÉFÉRENCE, lue et vidée de
   * façon SYNCHRONE. La boîte de dialogue appelle `onOpenChange(false)` juste
   * APRÈS « Confirmer » : lu dans l'état, `aConfirmer` y vaudrait encore la
   * question, et le renoncement suivrait la confirmation — la page reviendrait
   * à l'ancienne liste pendant l'envoi, puis la renverrait.
   */
  const attente = useRef(null);

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
    mutationFn: ({ valeur, confirmer = false }) =>
      enregistrer(valeur, etatCourant.current.version, { confirmerSuppressions: confirmer }),
    onSuccess: (resultat, { valeur: envoye }) => {
      setEtat((courant) =>
        enregistre(courant, { envoye, retour: resultat?.valeur, version: resultat?.version }, egaliteJson)
      );
      rappels.current.onSucces?.(resultat, envoye);
    },
    onError: async (erreur, { valeur }) => {
      if (demandeConfirmation(erreur)) {
        attente.current = { valeur, details: erreur.details ?? {} };
        setAConfirmer(attente.current);
        return;
      }

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
  const lancer = useCallback(() => {
    if (attente.current) return;
    mutation.mutate({ valeur: etatCourant.current.brouillon });
  }, [mutation]);

  const confirmerSuppressions = useCallback(() => {
    const question = attente.current;
    if (!question) return;
    attente.current = null;
    setAConfirmer(null);
    mutation.mutate({ valeur: question.valeur, confirmer: true });
  }, [mutation]);

  const renoncerSuppressions = useCallback(() => {
    if (!attente.current) return;
    attente.current = null;
    setAConfirmer(null);
    setEtat((courant) => renoncer(courant));
  }, []);

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
    suppressionsAConfirmer: aConfirmer?.details ?? null,
    confirmerSuppressions,
    renoncerSuppressions,
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
