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
 * Publier la semaine affichée — elle devient celle qui FAIT FOI.
 * ← le bouton « Publier » d'emploi.html (pilule verte) + `publish_timetable.php`
 * (2026-09-06, demande du porteur.)
 *
 * ═══ ⚠️ CE QUE PUBLIER FAIT, ET CE QU'IL NE FAIT PAS ═══
 * La semaine publiée devient celle qui S'OUVRE par défaut chez le gestionnaire,
 * le formateur et le stagiaire. Elle ne masque RIEN : ils gardent accès à toutes
 * les semaines. C'est la sémantique de l'ancien EDT Pro, confirmée par le
 * porteur — et c'est pourquoi le libellé dit « publiée », jamais « visible ».
 *
 * ⚠️ UNE SEULE SEMAINE PAR ANNÉE : publier REMPLACE. Le bouton le dit quand une
 * autre est déjà en place, sans quoi on croirait en ajouter une seconde.
 */
export default function BoutonPublier({ semaine, publication }) {
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
        description: 'Gestionnaires, formateurs et stagiaires l’ouvriront par défaut.',
      });
      rafraichir();
    },
    onError: (erreur) => toast.error('Publication impossible', { description: erreur.message }),
  });

  const depublier = useMutation({
    mutationFn: depublierSemaine,
    onSuccess: () => {
      toast.success('Publication retirée', {
        description: 'Chacun revient à la semaine du moment.',
      });
      rafraichir();
    },
    onError: (erreur) => toast.error('Retrait impossible', { description: erreur.message }),
  });

  if (!semaine) return null;

  const publiee = publication?.semaine ?? null;
  const estPubliee = publiee === semaine;
  const enCours = publier.isPending || depublier.isPending;

  return (
    <>
      {/*
        ⚠️ TROIS ÉTATS, PAS DEUX — c'est le libellé de l'existant, et il est
        juste : « Publier », « Publiée », et « Publier (actuel : S12) ». Le
        troisième est celui qui compte : sans lui, on publie en croyant ajouter,
        alors qu'on REMPLACE la référence de tout l'établissement.
      */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={enCours}
        onClick={() => setConfirmation(estPubliee ? 'depublier' : 'publier')}
        className={
          estPubliee
            ? 'h-8 gap-1.5 border-success/40 bg-success/10 text-xs text-success hover:bg-success/20 hover:text-success'
            : 'h-8 gap-1.5 text-xs'
        }
      >
        {estPubliee ? <Check className="size-3.5" /> : <Send className="size-3.5" />}
        {estPubliee ? 'Publiée' : publiee ? `Publier (actuel : ${court(publiee)})` : 'Publier'}
      </Button>

      <ConfirmationAction
        ouvert={confirmation === 'publier'}
        onOpenChange={(ouvert) => !ouvert && setConfirmation(null)}
        titre={`Publier ${court(semaine)} ?`}
        description={
          publiee
            ? `Elle REMPLACERA ${court(publiee)}, publiée jusqu’ici. Gestionnaires, formateurs et stagiaires ouvriront celle-ci par défaut — les autres semaines restent consultables.`
            : 'Gestionnaires, formateurs et stagiaires l’ouvriront par défaut. Les autres semaines restent consultables.'
        }
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
        description={`${court(semaine)} ne fera plus référence. Gestionnaires, formateurs et stagiaires ouvriront de nouveau la semaine du moment.`}
        libelleConfirmation="Dépublier"
        onConfirmer={() => {
          setConfirmation(null);
          depublier.mutate();
        }}
      />
    </>
  );
}
