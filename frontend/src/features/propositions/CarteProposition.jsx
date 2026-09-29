import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, RotateCcw, X } from 'lucide-react';
import { ROLES } from 'shared/constants';
import { libelleSemaine } from 'shared/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import ConfirmationAction from '@/components/common/ConfirmationAction';
import { recupererSession } from '@/features/auth/api';
import { cn } from '@/lib/utils';
import { appliquerProposition, refuserProposition, retirerProposition } from './api';
import CarteSeance, { CLASSE_DISTANCE, estADistance } from './CarteSeance';
import { CRENEAUX, JOURS, cleCase, grilleDepuis } from './grille';

const STATUTS = {
  en_attente: { libelle: 'En attente', classe: 'bg-muted text-muted-foreground' },
  partielle: { libelle: 'Appliquée en partie', classe: 'bg-primary/10 text-primary' },
  appliquee: { libelle: 'Appliquée', classe: 'bg-success/10 text-success' },
  refusee: { libelle: 'Refusée', classe: 'bg-destructive/10 text-destructive' },
  remplacee: { libelle: 'Remplacée par une plus récente', classe: 'bg-muted text-muted-foreground' },
};

/**
 * La proposition d'emploi du temps jointe à un message.
 * ← le tableau `prop-render-table` et `applyProposition()` de inbox.html
 *
 * Chez le DIRECTEUR destinataire : « Appliquer » / « Retirer » par jour, et
 * pour toute la semaine, plus « Refuser ». Chez le formateur : l'état de chaque
 * jour, pour savoir où en est sa demande — l'existant ne le lui disait pas.
 *
 * ⚠️ CHAQUE GESTE SE CONFIRME, comme dans l'existant : il écrit dans la grille
 * que tout l'établissement consulte.
 *
 * ═══ LE MÊME TABLEAU QUE CHEZ LE FORMATEUR (porteur, 2026-09-23) ═══
 * Bordures, en-tête grisé, cases de même hauteur, `CarteSeance` partagée (TEAMS
 * en violet), case vide en pointillés. Le directeur voit ce que le formateur a
 * composé, sous la même forme.
 */
export default function CarteProposition({ message }) {
  const cache = useQueryClient();
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  const [confirmation, setConfirmation] = useState(null);

  const p = message.proposition;
  const action = useMutation({
    mutationFn: ({ geste, jour }) =>
      geste === 'appliquer'
        ? appliquerProposition(message.id, jour)
        : geste === 'retirer'
          ? retirerProposition(message.id, jour)
          : refuserProposition(message.id),
    onSuccess: (_resultat, { geste }) => {
      toast.success(
        { appliquer: 'Proposition appliquée à l’emploi du temps', retirer: 'Séances d’origine restaurées', refuser: 'Proposition refusée' }[geste]
      );
      cache.invalidateQueries({ queryKey: ['message', message.id] });
      cache.invalidateQueries({ queryKey: ['messages'] });
    },
    // ⚠️ Le serveur nomme le jour et le créneau qui bloquent : on le montre tel quel.
    onError: (erreur) => toast.error(erreur.message),
  });

  if (!p) return null;

  const directeur =
    message.recu && session.data?.utilisateur?.role === ROLES.DIRECTEUR && p.statut !== 'remplacee';
  const grille = grilleDepuis(p.seances);
  const etat = (jour) => p.jours?.[jour] ?? 'en_attente';
  const auMoinsUn = (valeur) => JOURS.some((j) => etat(j) === valeur);
  const statut = STATUTS[p.statut] ?? STATUTS.en_attente;

  const demander = (geste, jour) => setConfirmation({ geste, jour });
  const texte = confirmation && libelleConfirmation(confirmation);

  return (
    <section className="mx-4 mb-4 shrink-0 space-y-3 rounded-lg border p-3 pb-4">
      <header className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">Proposition d’emploi du temps — {libelleSemaine(p.semaine, { court: true })}</p>
        <Badge variant="outline" className={cn('border-0', statut.classe)}>{statut.libelle}</Badge>
      </header>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[680px] table-fixed border-collapse text-xs">
          <thead>
            <tr className="bg-muted/50 text-muted-foreground">
              <th className="w-24 border-b p-2 text-left font-medium">Jour</th>
              {CRENEAUX.map((c) => (
                <th key={c} className="border-b border-l p-2 font-medium">{c}</th>
              ))}
              <th className="w-32 border-b border-l p-2 text-center font-medium">{directeur ? 'Action' : 'État'}</th>
            </tr>
          </thead>
          <tbody>
            {JOURS.map((jour) => (
              <tr key={jour} className={cn(etat(jour) === 'appliquee' && 'bg-success/5')}>
                <td className="border-b p-2 font-medium">{jour}</td>
                {CRENEAUX.map((c) => {
                  const s = grille[cleCase(jour, c)];
                  return (
                    <td key={c} className="h-20 border-b border-l p-1 align-top">
                      {s ? (
                        <CarteSeance seance={s} className={cn(estADistance(s) && CLASSE_DISTANCE)} />
                      ) : (
                        // Vide : la séance qui s'y trouvait sera libérée à l'application.
                        <div className="h-full rounded-md border border-dashed" />
                      )}
                    </td>
                  );
                })}
                <td className="border-b border-l p-1 text-center align-middle">
                  {directeur ? (
                    etat(jour) === 'appliquee' ? (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={action.isPending} onClick={() => demander('retirer', jour)}>
                        <RotateCcw className="size-3" /> Retirer
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={action.isPending} onClick={() => demander('appliquer', jour)}>
                        <Check className="size-3" /> Appliquer
                      </Button>
                    )
                  ) : (
                    <span className="text-muted-foreground">{STATUTS[etat(jour)]?.libelle}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Un créneau vide libère la séance qui s’y trouvait. Les EFM, absences et rattrapages ne sont jamais remplacés.
      </p>

      {directeur && (
        <footer className="flex flex-wrap justify-end gap-2">
          {auMoinsUn('en_attente') && (
            <Button size="sm" variant="ghost" className="text-destructive" disabled={action.isPending} onClick={() => demander('refuser')}>
              <X className="size-3.5" /> Refuser
            </Button>
          )}
          {auMoinsUn('appliquee') && (
            <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => demander('retirer')}>
              <RotateCcw className="size-3.5" /> Tout retirer
            </Button>
          )}
          {JOURS.some((j) => etat(j) !== 'appliquee') && (
            <Button size="sm" disabled={action.isPending} onClick={() => demander('appliquer')}>
              <Check className="size-3.5" /> Tout appliquer
            </Button>
          )}
        </footer>
      )}

      <ConfirmationAction
        ouvert={Boolean(confirmation)}
        onOpenChange={(ouvert) => !ouvert && setConfirmation(null)}
        titre={texte?.titre}
        description={texte?.description}
        libelleConfirmation={texte?.bouton}
        destructive={confirmation?.geste === 'refuser'}
        onConfirmer={() => {
          action.mutate(confirmation);
          setConfirmation(null);
        }}
      />
    </section>
  );
}

function libelleConfirmation({ geste, jour }) {
  const portee = jour ? `le ${jour}` : 'toute la semaine';
  if (geste === 'appliquer') {
    return {
      titre: `Appliquer ${portee} ?`,
      description:
        'Les séances du formateur sur ces jours seront remplacées par sa proposition. Si une seule séance est en conflit, rien n’est écrit.',
      bouton: 'Appliquer',
    };
  }
  if (geste === 'retirer') {
    return {
      titre: `Retirer ${portee} ?`,
      description: 'Les séances qui existaient avant l’application seront restaurées.',
      bouton: 'Retirer',
    };
  }
  return {
    titre: 'Refuser la proposition ?',
    description: 'Les jours non appliqués sont refusés. Les jours déjà appliqués restent en place.',
    bouton: 'Refuser',
  };
}
