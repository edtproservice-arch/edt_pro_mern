import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import ConfirmationAction from '@/components/common/ConfirmationAction';

import { reinitialiserTousLesChronogrammes } from './api';

/**
 * Réinitialiser TOUS les chronogrammes de l'année (2026-10-09, demande du
 * porteur).
 *
 * ═══ COMPTER, PUIS CONFIRMER ═══
 * Le clic ne vide rien : il demande d'abord au serveur ce qui serait vidé
 * (simulation), puis la confirmation l'annonce en chiffres. « Tout sera
 * effacé » ferait confirmer à l'aveugle ; « 18 groupes, 1 240 cases » est ce
 * sur quoi le directeur décide réellement.
 *
 * ⚠️ IRRÉVERSIBLE, à la différence de la réinitialisation d'une grille, qui
 *    reste annulable tant que rien d'autre n'est enregistré : celle-ci écrit
 *    directement en base, pour tous les groupes — même ceux qui ne sont pas
 *    affichés.
 */
export default function BoutonReinitialiserTout({ lectureSeule = false }) {
  const [apercu, setApercu] = useState(null);
  const cache = useQueryClient();

  const compter = useMutation({
    mutationFn: () => reinitialiserTousLesChronogrammes({ simulation: true }),
    onSuccess: (bilan) => {
      if (bilan.groupes.length === 0) {
        toast.info('Aucun chronogramme à réinitialiser : tous sont déjà vides.');
        return;
      }
      setApercu(bilan);
    },
    onError: (erreur) => toast.error('Réinitialisation impossible', { description: erreur.message }),
  });

  const vider = useMutation({
    mutationFn: () => reinitialiserTousLesChronogrammes({ simulation: false }),
    onSuccess: (bilan) => {
      cache.invalidateQueries({ queryKey: ['chronogrammes'] });
      cache.invalidateQueries({ queryKey: ['chronogramme'] });
      cache.invalidateQueries({ queryKey: ['chronogramme-formateur'] });
      cache.invalidateQueries({ queryKey: ['chronogramme-completude'] });
      cache.invalidateQueries({ queryKey: ['chronogramme-liaison'] });
      toast.success('Chronogrammes réinitialisés', {
        description: `${bilan.groupes.length} groupe(s) vidé(s), ${bilan.cellules} case(s) retirée(s).`,
      });
      setApercu(null);
    },
    onError: (erreur) => toast.error('Réinitialisation impossible', { description: erreur.message }),
  });

  const occupe = compter.isPending || vider.isPending;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
        disabled={lectureSeule || occupe}
        onClick={() => compter.mutate()}
        title="Vider les chronogrammes de tous les groupes de l’année"
      >
        {occupe ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
        Tout réinitialiser
      </Button>

      <ConfirmationAction
        ouvert={apercu !== null}
        onOpenChange={(ouvert) => !ouvert && setApercu(null)}
        titre="Réinitialiser tous les chronogrammes ?"
        libelleConfirmation="Tout réinitialiser"
        destructive
        onConfirmer={() => vider.mutate()}
        description={
          apercu && (
            <>
              <span className="block">
                Les chronogrammes de <strong>{apercu.groupes.length} groupe(s)</strong> seront
                vidés — <strong>{apercu.cellules} case(s)</strong> au total, y compris ceux qui ne
                sont pas affichés.
              </span>
              <span className="mt-2 block font-medium text-destructive">
                Cette action est irréversible.
              </span>
            </>
          )
        }
      />
    </>
  );
}
