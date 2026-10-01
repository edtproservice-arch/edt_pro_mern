import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Send } from 'lucide-react';
import { libelleSemaine } from 'shared/domain';
import { Button } from '@/components/ui/button';
import ConfirmationAction from '@/components/common/ConfirmationAction';
import { depublierSemaine, publierSemaine } from './api';

const court = (valeur) => libelleSemaine(valeur, { court: true });

/**
 * Publier la semaine affichée — elle devient VISIBLE des autres sessions.
 * ← le bouton « Publier » d'emploi.html (pilule verte) + `publish_timetable.php`
 * (2026-09-06, demande du porteur.)
 *
 * ═══ ⚠️ CE QUE PUBLIER FAIT (2026-10-01, demande du porteur) ═══
 * « L'emploi du temps ne doit pas être affiché aux sessions formateur,
 * stagiaire et gestionnaire si le directeur n'a pas cliqué sur Publier, pour
 * chaque semaine. » Chaque semaine se publie donc À PART : tant qu'elle ne
 * l'est pas, le gestionnaire, les formateurs et les stagiaires ne la voient
 * pas. Publier une semaine ne retire plus la publication des autres.
 *
 * @param {string}   semaine       la semaine affichée, « 2026-W12 »
 * @param {string[]} publications  les semaines déjà publiées de l'année
 */
export default function BoutonPublier({ semaine, publications = [] }) {
  const cache = useQueryClient();
  const [confirmation, setConfirmation] = useState(null);

  const rafraichir = () => {
    cache.invalidateQueries({ queryKey: ['emploi', 'semaines'] });
    cache.invalidateQueries({ queryKey: ['emploi', 'contexte'] });
  };

  const publier = useMutation({
    mutationFn: () => publierSemaine(semaine),
    onSuccess: () => {
      toast.success(`${court(semaine)} publiée`, {
        description: 'Gestionnaires, formateurs et stagiaires peuvent maintenant la consulter.',
      });
      rafraichir();
    },
    onError: (erreur) => toast.error('Publication impossible', { description: erreur.message }),
  });

  const depublier = useMutation({
    mutationFn: () => depublierSemaine(semaine),
    onSuccess: () => {
      toast.success('Publication retirée', {
        description: `${court(semaine)} est de nouveau masquée aux autres sessions.`,
      });
      rafraichir();
    },
    onError: (erreur) => toast.error('Retrait impossible', { description: erreur.message }),
  });

  if (!semaine) return null;

  const estPubliee = publications.includes(semaine);
  const enCours = publier.isPending || depublier.isPending;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={enCours}
        onClick={() => setConfirmation(estPubliee ? 'depublier' : 'publier')}
        title={
          estPubliee
            ? 'Visible du gestionnaire, des formateurs et des stagiaires'
            : 'Masquée au gestionnaire, aux formateurs et aux stagiaires tant qu’elle n’est pas publiée'
        }
        className={
          estPubliee
            ? 'h-8 gap-1.5 border-success/40 bg-success/10 text-xs text-success hover:bg-success/20 hover:text-success'
            : 'h-8 gap-1.5 text-xs'
        }
      >
        {estPubliee ? <Check className="size-3.5" /> : <Send className="size-3.5" />}
        {estPubliee ? 'Publiée' : 'Publier'}
      </Button>

      <ConfirmationAction
        ouvert={confirmation === 'publier'}
        onOpenChange={(ouvert) => !ouvert && setConfirmation(null)}
        titre={`Publier ${court(semaine)} ?`}
        description="Gestionnaires, formateurs et stagiaires pourront consulter l’emploi du temps de cette semaine. Les autres semaines publiées le restent."
        libelleConfirmation="Publier"
        onConfirmer={() => {
          setConfirmation(null);
          publier.mutate();
        }}
      />

      <ConfirmationAction
        ouvert={confirmation === 'depublier'}
        onOpenChange={(ouvert) => !ouvert && setConfirmation(null)}
        titre="Retirer la publication ?"
        description={`${court(semaine)} ne sera plus visible du gestionnaire, des formateurs ni des stagiaires.`}
        libelleConfirmation="Dépublier"
        onConfirmer={() => {
          setConfirmation(null);
          depublier.mutate();
        }}
      />
    </>
  );
}
