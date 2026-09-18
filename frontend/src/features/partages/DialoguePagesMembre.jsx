import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { libelleRole } from '@/features/admin/components/roles';
import { chargerPagesMembre, reglerPagesMembre } from './api';
import ListePagesDroits from './ListePagesDroits';

const PAR = { role: 'par son rôle', general: 'par l’accès général' };

/** Ce que la personne aurait SANS invitation — dit sous la page, pour ne pas l'inviter pour rien. */
function noteSans(sansInvitation) {
  if (!sansInvitation || !PAR[sansInvitation.source]) return null;
  const verbe = sansInvitation.droit === 'modifier' ? 'Modifie' : 'Consulte';
  return `${verbe} déjà ${PAR[sansInvitation.source]}`;
}

/**
 * « Gérer ses pages » — toutes les pages d'UN invité, réglées d'un coup
 * (2026-09-13, demande du porteur).
 *
 * La boîte « Partager » ne montre qu'une page : savoir ce qu'une personne voit
 * ailleurs obligeait à ouvrir la boîte de chacune. Ici, les quatorze pages, avec
 * son droit sur chacune.
 *
 * ⚠️ UN BROUILLON, PUIS « ENREGISTRER » — pas d'écriture à chaque clic : une
 * page ajoutée ENVOIE UN MESSAGE à la personne. Cinq clics en rafale en
 * enverraient cinq, là où un seul enregistrement n'en envoie qu'un, qui nomme
 * toutes les pages nouvelles.
 *
 * ⚠️ SEULES LES PAGES CHANGÉES PARTENT : une page non nommée n'est pas touchée
 * côté serveur — un brouillon ouvert avant qu'un autre écran ne change une page
 * ne l'écrase donc pas.
 */
export default function DialoguePagesMembre({ membre, ouvert, onOuvert }) {
  const requete = useQuery({
    queryKey: ['partages', 'membre', membre?.id],
    queryFn: () => chargerPagesMembre(membre.id),
    enabled: ouvert && Boolean(membre?.id),
    retry: false,
  });

  // Ce que le serveur dit, page par page : le droit par invitation, ou rien.
  const reference = useMemo(
    () => Object.fromEntries((requete.data?.pages ?? []).map((p) => [p.page, p.invitation?.droit ?? null])),
    [requete.data]
  );
  const [brouillon, setBrouillon] = useState(reference);
  // Chaque (ré)ouverture repart de ce que la base contient.
  useEffect(() => setBrouillon(reference), [reference, ouvert]);

  const changements = Object.fromEntries(
    Object.entries(brouillon).filter(([page, droit]) => (reference[page] ?? null) !== droit)
  );
  const nombre = Object.keys(changements).length;

  const notes = Object.fromEntries(
    (requete.data?.pages ?? []).map((p) => [
      p.page,
      [p.invitation?.statut === 'en_attente' && 'En attente', noteSans(p.sansInvitation)].filter(Boolean).join(' · '),
    ])
  );

  const enregistrer = useMutation({
    mutationFn: () => reglerPagesMembre(membre.id, changements),
    onSuccess: () => {
      const ajoutees = Object.entries(changements).filter(([page, droit]) => droit && !reference[page]).length;
      toast.success('Pages mises à jour', {
        description:
          ajoutees > 0
            ? `${membre.nom} est prévenu(e) des ${ajoutees} page(s) nouvelle(s) dans sa messagerie.`
            : 'Les accès retirés se referment aussitôt chez la personne.',
      });
      onOuvert(false);
    },
    onError: (erreur) => toast.error('Réglage impossible', { description: erreur.message }),
  });

  return (
    <Dialog open={ouvert} onOpenChange={onOuvert}>
      {/* ⚠️ `min-w-0` + `overflow-x-hidden` : `DialogContent` est une GRILLE, et un
          enfant de grille refuse sinon de devenir plus étroit que son contenu. */}
      <DialogContent className="flex max-h-[85vh] max-w-xl flex-col overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Pages de {membre?.nom}</DialogTitle>
          <DialogDescription>
            {membre ? `${libelleRole(membre.role)} · ${membre.email}. ` : ''}
            Choisissez, page par page, s’il peut consulter ou modifier. Une page ajoutée entre dans
            son menu dès qu’il accepte l’invitation.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
          {requete.isError ? (
            <p className="text-sm text-destructive">{requete.error.message}</p>
          ) : requete.isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : (
            <ListePagesDroits
              valeurs={brouillon}
              notes={notes}
              desactive={enregistrer.isPending}
              onChanger={(page, droit) => setBrouillon((avant) => ({ ...avant, [page]: droit }))}
            />
          )}
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {nombre === 0 ? 'Aucune modification' : `${nombre} page(s) modifiée(s)`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOuvert(false)}>
              Annuler
            </Button>
            <Button size="sm" disabled={nombre === 0 || enregistrer.isPending} onClick={() => enregistrer.mutate()}>
              Enregistrer
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
