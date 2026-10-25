import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileWarning } from 'lucide-react';
import BoutonFormat from '@/components/common/BoutonFormat';
import { imprimerReclamation } from './api';

/**
 * ═══ LA FICHE DE RÉCLAMATION JOINTE À UN MESSAGE (2026-10-26, demande du porteur) ═══
 * Envoyée par un formateur au directeur et aux gestionnaires « pour impression » :
 * l'essentiel de la fiche en clair, et de quoi l'imprimer. Le document se
 * reconstruit au serveur depuis l'instantané du message — la partie
 * « Surveillant » y donne l'état du dossier au moment d'imprimer.
 */
export default function CarteReclamation({ message }) {
  const fiche = message.reclamation;

  const impression = useMutation({
    mutationFn: (format) => imprimerReclamation(message.id, format),
    onError: (erreur) => toast.error('Impression impossible', { description: erreur.message }),
  });

  if (!fiche) return null;

  return (
    <section className="mx-4 mb-4 shrink-0 space-y-3 rounded-lg border bg-muted/20 p-3">
      <header className="space-y-0.5">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <FileWarning className="size-4 text-destructive" />
          Fiche de réclamation — {fiche.groupes.join(', ')}
        </p>
        <p className="text-xs text-muted-foreground">
          {fiche.dateHeure}
          {fiche.lieu ? ` · ${fiche.lieu}` : ''} · {fiche.formateur}
        </p>
      </header>

      <dl className="grid gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Stagiaire(s)</dt>
        <dd>{fiche.stagiaires.join(', ')}</dd>
        {fiche.actionNonDisciplinaire && (
          <>
            <dt className="text-muted-foreground">Action non disciplinaire</dt>
            <dd className="whitespace-pre-wrap">{fiche.actionNonDisciplinaire}</dd>
          </>
        )}
        {fiche.degats && (
          <>
            <dt className="text-muted-foreground">Dégâts immobiliers</dt>
            <dd className="whitespace-pre-wrap">{fiche.degats}</dd>
          </>
        )}
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        {['docx', 'pdf'].map((format) => (
          <BoutonFormat
            key={format}
            format={format}
            disabled={impression.isPending}
            enCours={impression.isPending && impression.variables === format}
            onClick={() => impression.mutate(format)}
          />
        ))}
        <span className="text-xs text-muted-foreground">
          Une page par stagiaire ; la partie « Surveillant » reflète son dossier à l’impression.
        </span>
      </div>
    </section>
  );
}
