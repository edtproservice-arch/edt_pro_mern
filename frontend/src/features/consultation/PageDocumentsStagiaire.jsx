import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Award, FileSignature, Loader2 } from 'lucide-react';
import CadreReglage from '@/features/parametres/CadreReglage';
import { DocumentTelechargeable, FeuilleDocument } from '@/features/documents/CartesDocuments';
import { LIBELLES_DEMANDE, STATUTS, STATUTS_OUVERTS, dateCourte } from '@/features/demandesDocuments/api';
import { cn } from '@/lib/utils';
import { chargerMesDocumentsStagiaire, demanderDocument, telechargerMonDuplicata } from './api';

/**
 * ═══ LES DOCUMENTS DU STAGIAIRE (2026-10-23, demande du porteur) ═══
 *   - sa DEMANDE DE DUPLICATA du diplôme : à son nom, téléchargée directement
 *     (la carte de stagiaire en est RETIRÉE le 2026-10-23, demande du porteur :
 *     elle reste remise par l'administration) ;
 *   - l'ATTESTATION DE POURSUITE DE FORMATION : elle doit être signée et cachetée,
 *     il la DEMANDE. L'administration l'accepte ou la rejette depuis son accueil,
 *     puis la signale prête — il vient alors la retirer.
 */
const TELECHARGEABLES = [
  {
    cle: 'duplicata',
    titre: 'Demande de duplicata du diplôme',
    resume: 'Pré-remplie à votre nom',
    icone: Award,
    telecharger: telechargerMonDuplicata,
  },
];

const DEMANDABLES = [{ type: 'attestation-poursuite', resume: 'Signée et cachetée', icone: FileSignature }];

export default function PageDocumentsStagiaire() {
  const requete = useQuery({
    queryKey: ['consultation', 'mes-documents'],
    queryFn: chargerMesDocumentsStagiaire,
    retry: false,
  });
  const demandes = requete.data?.demandes ?? [];

  return (
    <CadreReglage
      titre="Mes documents"
      chargement={requete.isLoading}
      erreur={requete.isError ? requete.error.message : null}
    >
      <div className="space-y-8">
        <section className="space-y-3">
          <h2 className="text-sm font-medium">À télécharger</h2>
          <div className="flex flex-wrap gap-4">
            {TELECHARGEABLES.map((document) => (
              <DocumentTelechargeable key={document.cle} document={document} />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">À demander</h2>
            <p className="text-xs text-muted-foreground">
              Signés et cachetés par l’administration : faites la demande, puis retirez le document quand il est prêt.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            {DEMANDABLES.map((document) => (
              <TuileDemande
                key={document.type}
                document={document}
                ouverte={demandes.find((demande) => demande.type === document.type && STATUTS_OUVERTS.includes(demande.statut))}
              />
            ))}
          </div>
        </section>

        {demandes.length > 0 && <MesDemandes demandes={demandes} />}
      </div>
    </CadreReglage>
  );
}

/** Une tuile « à demander » : un clic envoie la demande, sauf s'il y en a déjà une en cours. */
function TuileDemande({ document, ouverte }) {
  const client = useQueryClient();
  const demande = useMutation({
    mutationFn: () => demanderDocument(document.type),
    onSuccess: () => {
      toast.success('Demande envoyée', { description: 'L’administration vous informera quand le document sera prêt.' });
      client.invalidateQueries({ queryKey: ['consultation', 'mes-documents'] });
    },
    onError: (erreur) => toast.error('Demande impossible', { description: erreur.message }),
  });
  const titre = LIBELLES_DEMANDE[document.type];

  return (
    <button
      type="button"
      disabled={Boolean(ouverte) || demande.isPending}
      onClick={() => demande.mutate()}
      aria-label={ouverte ? `${titre} : ${STATUTS[ouverte.statut].libelle}` : `Demander : ${titre}`}
      className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
    >
      <FeuilleDocument
        document={{ ...document, titre }}
        pied={
          demande.isPending ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" />
              Envoi…
            </span>
          ) : ouverte ? (
            STATUTS[ouverte.statut].libelle
          ) : (
            'Demander'
          )
        }
        className={cn(!ouverte && 'cursor-pointer hover:border-border-strong')}
      />
    </button>
  );
}

/** Le suivi de ses demandes : où en est chacune, et ce que l'administration en dit. */
function MesDemandes({ demandes }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Mes demandes</h2>
      <ul className="divide-y rounded-lg border">
        {demandes.map((demande) => (
          <li key={demande._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span className="min-w-0">
              <span className="block font-medium">{LIBELLES_DEMANDE[demande.type] ?? demande.type}</span>
              <span className="block text-xs text-muted-foreground">
                Demandée le {dateCourte(demande.createdAt)}
                {demande.statut === 'prete' &&
                  ` — prête depuis le ${dateCourte(demande.preteLe)} : à retirer auprès de l’administration.`}
                {demande.statut === 'rejetee' && demande.motif && ` — motif : ${demande.motif}`}
                {demande.statut === 'remise' && ` — remise le ${dateCourte(demande.remiseLe)}.`}
              </span>
            </span>
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUTS[demande.statut]?.classes)}>
              {STATUTS[demande.statut]?.libelle ?? demande.statut}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
