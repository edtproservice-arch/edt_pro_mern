import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Inbox, PackageCheck, Stamp, X } from 'lucide-react';
import BoutonTelecharger from '@/components/common/BoutonTelecharger';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { exporterFeuillePresence } from '@/features/absences/stagiaires/api';
import { cn } from '@/lib/utils';
import {
  LIBELLES_DEMANDE,
  STATUTS,
  STATUTS_OUVERTS,
  chargerDemandesDocuments,
  dateCourte,
  traiterDemandeDocument,
} from './api';

/**
 * ═══ LES DEMANDES DE DOCUMENTS DES STAGIAIRES (2026-10-23, demande du porteur) ═══
 * Sur l'accueil du gestionnaire : ce que les stagiaires ont demandé — l'attestation
 * de poursuite, qui doit être signée et cachetée.
 *   - en attente : Accepter, ou Rejeter avec un motif ;
 *   - acceptée   : télécharger l'attestation du stagiaire, l'imprimer, la faire
 *                  signer — puis « Prête » : il est prévenu de venir la retirer ;
 *   - prête      : « Remise » quand il l'a retirée.
 * Les demandes closes (rejetées, remises) restent visibles sept jours.
 *
 * ⚠️ UN BLOC MUET QUAND IL N'Y A RIEN : l'accueil ne se charge pas d'une liste vide.
 */
export default function DemandesDocuments() {
  const requete = useQuery({ queryKey: ['demandes-documents'], queryFn: chargerDemandesDocuments, retry: false });
  const [aRejeter, setARejeter] = useState(null);
  const [toutVoir, setToutVoir] = useState(false);

  /* ⚠️ CE QUI ATTEND UN GESTE D'ABORD : l'aperçu de l'accueil ne doit pas cacher
     une demande en attente derrière des demandes déjà remises. Tri stable : à
     statut égal, l'ordre du serveur est gardé. */
  const demandes = [...(requete.data?.demandes ?? [])].sort(
    (a, b) => Number(!STATUTS_OUVERTS.includes(a.statut)) - Number(!STATUTS_OUVERTS.includes(b.statut))
  );

  if (demandes.length === 0) return null;
  const ouvertes = demandes.filter((demande) => STATUTS_OUVERTS.includes(demande.statut));
  const enAttente = demandes.filter((demande) => demande.statut === 'en_attente').length;

  return (
    <section className="space-y-3">
      <header className="flex items-baseline gap-2">
        <Inbox className="size-4 self-center text-muted-foreground" />
        <h2 className="text-sm font-medium">Demandes de documents</h2>
        <span className="text-xs text-muted-foreground">
          {enAttente > 0 ? `${enAttente} en attente` : `${ouvertes.length} en cours`}
        </span>
        {/* ⚠️ « VOIR TOUT » AU-DELÀ DE L'APERÇU (2026-10-24, demande du porteur :
            « s'il y a beaucoup de demandes, un bouton voir tout qui ouvre un modal »). */}
        {demandes.length > APERCU && (
          <Button variant="link" size="sm" className="ml-auto h-auto p-0 text-xs" onClick={() => setToutVoir(true)}>
            Voir tout ({demandes.length})
          </Button>
        )}
      </header>
      <ul className="divide-y rounded-lg border">
        {demandes.slice(0, APERCU).map((demande) => (
          <LigneDemande key={demande._id} demande={demande} onRejeter={() => setARejeter(demande)} />
        ))}
      </ul>
      <DialogueRejet demande={aRejeter} onFermer={() => setARejeter(null)} />
      <DialogueToutes demandes={demandes} ouvert={toutVoir} onFermer={() => setToutVoir(false)} />
    </section>
  );
}

/** Combien de demandes l'accueil montre avant « Voir tout ». */
const APERCU = 5;

/**
 * Toutes les demandes, dans une fenêtre qui défile — avec les mêmes gestes que
 * l'aperçu, et une recherche par nom, matricule ou groupe.
 *
 * ⚠️ LE REJET S'OUVRE DANS CETTE FENÊTRE-CI : un second dialogue rendu à côté,
 * hors de son arbre, se disputerait le focus avec celui-ci.
 */
function DialogueToutes({ demandes, ouvert, onFermer }) {
  const [recherche, setRecherche] = useState('');
  const [aRejeter, setARejeter] = useState(null);

  const filtre = recherche.trim().toLowerCase();
  const visibles = filtre
    ? demandes.filter((demande) =>
        [demande.nomComplet, demande.matricule, demande.groupe].some((valeur) =>
          String(valeur ?? '').toLowerCase().includes(filtre)
        )
      )
    : demandes;

  return (
    <Dialog open={ouvert} onOpenChange={(etat) => !etat && onFermer()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Demandes de documents</DialogTitle>
          <DialogDescription>
            {demandes.length} demande(s) — les demandes closes restent visibles sept jours.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={recherche}
          onChange={(evenement) => setRecherche(evenement.target.value)}
          placeholder="Rechercher un stagiaire, un matricule ou un groupe…"
          aria-label="Rechercher une demande"
          className="h-8 text-sm"
        />
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto rounded-lg border scrollbar-fine">
          {visibles.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">Aucune demande ne correspond.</li>
          ) : (
            visibles.map((demande) => (
              <LigneDemande key={demande._id} demande={demande} onRejeter={() => setARejeter(demande)} />
            ))
          )}
        </ul>
        <DialogueRejet demande={aRejeter} onFermer={() => setARejeter(null)} />
      </DialogContent>
    </Dialog>
  );
}

function useTraiter() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, motif }) => traiterDemandeDocument(id, action, motif),
    onSuccess: () => client.invalidateQueries({ queryKey: ['demandes-documents'] }),
    onError: (erreur) => toast.error('Action impossible', { description: erreur.message }),
  });
}

function LigneDemande({ demande, onRejeter }) {
  const traiter = useTraiter();
  const geste = (action) => traiter.mutate({ id: demande._id, action });
  const telechargement = useMutation({
    mutationFn: (format) =>
      exporterFeuillePresence(demande.type)({ format, groupes: [demande.groupe], matricules: [demande.matricule] }),
    onError: (erreur) => toast.error('Téléchargement impossible', { description: erreur.message }),
  });

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      <span className="min-w-0">
        <span className="block font-medium">
          {demande.nomComplet || demande.matricule}
          <span className="ml-2 font-normal text-muted-foreground">{demande.groupe}</span>
          {/* Combien de fois il a demandé ce document (2026-10-23, demande du porteur). */}
          <span
            className={cn(
              'ml-2 rounded-full px-1.5 py-0.5 text-[0.65rem] font-medium',
              (demande.nombreDemandes ?? 1) > 1 ? 'bg-warning/15 text-accent-orange-deep' : 'bg-muted text-muted-foreground'
            )}
            title="Demandes de ce document par ce stagiaire, toutes confondues"
          >
            {demande.nombreDemandes ?? 1} demande{(demande.nombreDemandes ?? 1) > 1 ? 's' : ''}
          </span>
        </span>
        <span className="block text-xs text-muted-foreground">
          {LIBELLES_DEMANDE[demande.type] ?? demande.type} · demandée le {dateCourte(demande.createdAt)}
          {demande.statut === 'rejetee' && demande.motif && ` · motif : ${demande.motif}`}
        </span>
      </span>

      <span className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUTS[demande.statut]?.classes)}>
          {STATUTS[demande.statut]?.libelle ?? demande.statut}
        </span>

        {demande.statut === 'en_attente' && (
          <>
            <Button size="sm" variant="outline" className="h-8 gap-1" disabled={traiter.isPending} onClick={() => geste('accepter')}>
              <Check className="size-3.5 text-success" />
              Accepter
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1" disabled={traiter.isPending} onClick={onRejeter}>
              <X className="size-3.5 text-destructive" />
              Rejeter
            </Button>
          </>
        )}

        {demande.statut === 'acceptee' && (
          <>
            <BoutonTelecharger
              className="h-8"
              formats={['docx', 'pdf']}
              libelle="Attestation"
              enCours={telechargement.isPending}
              onChoisir={(format) => telechargement.mutate(format)}
            />
            <Button size="sm" variant="outline" className="h-8 gap-1" disabled={traiter.isPending} onClick={() => geste('prete')}>
              <Stamp className="size-3.5 text-success" />
              Prête à retirer
            </Button>
          </>
        )}

        {demande.statut === 'prete' && (
          <Button size="sm" variant="outline" className="h-8 gap-1" disabled={traiter.isPending} onClick={() => geste('remise')}>
            <PackageCheck className="size-3.5" />
            Remise
          </Button>
        )}
      </span>
    </li>
  );
}

/** Le motif du rejet — lu par le stagiaire dans « Mes demandes ». */
function DialogueRejet({ demande, onFermer }) {
  const [motif, setMotif] = useState('');
  const traiter = useTraiter();

  const rejeter = () =>
    traiter.mutate(
      { id: demande._id, action: 'rejeter', motif },
      {
        onSuccess: () => {
          setMotif('');
          onFermer();
        },
      }
    );

  return (
    <Dialog open={Boolean(demande)} onOpenChange={(ouvert) => !ouvert && onFermer()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rejeter la demande</DialogTitle>
          <DialogDescription className="sr-only">Le motif est montré au stagiaire.</DialogDescription>
        </DialogHeader>
        <Input
          value={motif}
          onChange={(evenement) => setMotif(evenement.target.value)}
          maxLength={300}
          placeholder="Motif (montré au stagiaire)"
          aria-label="Motif du rejet"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onFermer}>
            Annuler
          </Button>
          <Button variant="destructive" disabled={traiter.isPending} onClick={rejeter}>
            Rejeter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
