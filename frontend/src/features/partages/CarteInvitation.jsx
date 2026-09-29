import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, X } from 'lucide-react';
import IconeImmeubles from '@/components/common/IconeImmeubles';
import { Button } from '@/components/ui/button';
import { droitBorne, libellePage, urlDePage } from 'shared/domain';
import { cn } from '@/lib/utils';
import { repondreInvitation } from './api';

const ETATS = {
  acceptee: { texte: 'Accès accordé — la page est dans votre menu.', classe: 'text-success' },
  refusee: { texte: 'Invitation refusée.', classe: 'text-muted-foreground' },
  retiree: { texte: 'Le directeur a retiré cette invitation.', classe: 'text-muted-foreground' },
};

/**
 * Le partage porté par un message.
 *
 * ═══ DEPUIS LE 2026-09-23 : L'ACCÈS EST ACCORDÉ D'OFFICE ═══ (décision du porteur,
 * qui renverse celle du 2026-09-12.) Le message arrive « acceptée » et propose
 * d'OUVRIR la page. « Accepter » / « Refuser » ne paraissent plus que sur les
 * invitations envoyées avant ce changement, restées en attente.
 *
 * ⚠️ LES BOUTONS NE PARAISSENT QUE POUR LE DESTINATAIRE, ET TANT QU'ELLE ATTEND.
 * L'expéditeur relit son envoi sans pouvoir y répondre ; une invitation déjà
 * traitée dit ce qu'elle est devenue plutôt que d'offrir un bouton qui échouerait.
 *
 * ⚠️ L'ÉTAT SE RELIT APRÈS LA RÉPONSE — le filet global du cache invalide tout
 * après une écriture réussie : le message affiche « acceptée », le menu gagne
 * l'entrée de la page, sans rechargement.
 */
export default function CarteInvitation({ message }) {
  const invitation = message.invitation;

  const repondre = useMutation({
    mutationFn: (reponse) => repondreInvitation(message.id, reponse),
    onSuccess: (resultat) => {
      toast.success(
        resultat.statut === 'acceptee' ? 'Invitation acceptée' : 'Invitation refusée',
        resultat.statut === 'acceptee' ? { description: 'La page apparaît maintenant dans votre menu.' } : undefined
      );
    },
    onError: (erreur) => toast.error('Réponse impossible', { description: erreur.message }),
  });

  if (!invitation) return null;

  // Le libellé du REGISTRE partagé : une table locale n'aurait nommé que les pages qu'elle connaît.
  const pages = invitation.pages.map(libellePage).join(', ');
  const plusieurs = invitation.pages.length > 1;
  // « Peut modifier » ne vaut que « consulter » sur une page en lecture seule (Sessions).
  const lectureSeule = invitation.pages.some((page) => droitBorne(page, 'modifier') !== 'modifier');
  const enAttente = invitation.statut === 'en_attente';
  const etat = ETATS[invitation.statut];
  /*
   * Le droit de CHAQUE page (2026-09-13) — quand ils diffèrent, une seule phrase
   * mentirait sur la moitié d'entre elles. Les invitations antérieures n'en
   * portent pas : la phrase d'ensemble reste.
   */
  const detail =
    plusieurs && invitation.droits?.length > 1 && new Set(invitation.droits.map((d) => d.droit)).size > 1
      ? invitation.droits
      : null;

  return (
    <section
      aria-label="Invitation à collaborer"
      className="mx-4 mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 p-3"
    >
      {/* Gris et noir, comme l'accès général de la boîte « Partager » : l'immeuble
          y dit la même chose — la page appartient à l'établissement. */}
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
        <IconeImmeubles className="size-4 text-foreground" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{pages}</p>
        {detail && !etat ? (
          <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {detail.map(({ page, droit }) => (
              <li key={page}>
                {libellePage(page)} — {droit === 'modifier' ? 'vous pourrez modifier' : 'vous pourrez consulter'}
              </li>
            ))}
          </ul>
        ) : (
        <p className={cn('text-xs', etat?.classe ?? 'text-muted-foreground')}>
          {etat?.texte ??
            (invitation.droit === 'modifier'
              ? plusieurs
                ? lectureSeule
                  ? 'Vous pourrez modifier ces pages — certaines en lecture seule, le message les nomme.'
                  : 'Vous pourrez modifier ces pages.'
                : 'Vous pourrez modifier la page.'
              : plusieurs
                ? 'Vous pourrez consulter ces pages.'
                : 'Vous pourrez consulter la page.')}
        </p>
        )}
      </div>

      {message.recu && enAttente && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            disabled={repondre.isPending}
            onClick={() => repondre.mutate('refuser')}
          >
            <X className="size-3.5" />
            Refuser
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5"
            disabled={repondre.isPending}
            onClick={() => repondre.mutate('accepter')}
          >
            <Check className="size-3.5" />
            Accepter
          </Button>
        </div>
      )}

      {/*
        ═══ « OUVRIR » (2026-09-23) ═══ Le partage ouvre la page d'office : il n'y a plus rien
        à accepter, le message mène directement à la page — une entrée par page partagée.
        ⚠️ L'adresse vient du REGISTRE (`urlDePage`), celle que prend le menu « Partagé » :
        un chemin écrit ici divergerait au premier déplacement de la page.
      */}
      {message.recu && invitation.statut === 'acceptee' && (
        <div className="flex flex-wrap items-center gap-2">
          {invitation.pages.map((page) => {
            const droit = invitation.droits?.find((d) => d.page === page)?.droit ?? invitation.droit;
            const url = urlDePage(page, droitBorne(page, droit));
            if (!url) return null;
            return (
              <Button key={page} asChild variant="outline" size="sm" className="h-8 gap-1.5">
                <Link to={url}>
                  {plusieurs ? libellePage(page) : 'Ouvrir la page'}
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            );
          })}
        </div>
      )}

      {!message.recu && enAttente && (
        <span className="text-xs text-muted-foreground">En attente de réponse</span>
      )}
    </section>
  );
}
