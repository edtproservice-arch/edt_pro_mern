import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { File, FileText, FileWarning, Gavel, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { exporterFeuillePresence } from './api';

/**
 * Un document de discipline d'UN stagiaire, en Word ou PDF — le même que la
 * page Documents, demandé nommément : `modele` est la clé du canevas.
 */
function BoutonDocumentStagiaire({ modele, libelle, titre, icone: Icone, groupe, matricule, nom, enEvidence = false, className }) {
  const telechargement = useMutation({
    mutationFn: (format) => exporterFeuillePresence(modele)({ format, groupes: [groupe], matricules: [matricule] }),
    onError: (erreur) => toast.error('Téléchargement impossible', { description: erreur.message }),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={telechargement.isPending || !groupe}
          aria-label={`${titre} de ${nom}`}
          className={cn(
            'h-7 gap-1 text-xs',
            enEvidence && 'border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive',
            className
          )}
        >
          {telechargement.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Icone className="size-3.5" />}
          {libelle}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => telechargement.mutate('docx')}>
          <FileText className="size-3.5 text-blue-600" />
          Télécharger en Word
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => telechargement.mutate('pdf')}>
          <File className="size-3.5 text-red-600" />
          Télécharger en PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Le PV du conseil de discipline d'UN stagiaire (2026-10-11, demande du
 * porteur : le même document que la page Documents, depuis « Notes de
 * discipline »). Pré-rempli comme là-bas : identité, filière, année, mode,
 * téléphone, faits.
 *
 * `enEvidence` : le stagiaire relève du conseil (sanction de son autorité) —
 * le bouton se colore, c'est le PV qu'on vient chercher.
 */
export default function BoutonPvConseil(props) {
  return <BoutonDocumentStagiaire modele="pv-discipline" libelle="PV conseil" titre="PV du conseil de discipline" icone={Gavel} {...props} />;
}

/** La fiche de réclamation d'UN stagiaire (2026-10-11) : établissement, groupe et nom pré-remplis. */
export function BoutonReclamation(props) {
  return <BoutonDocumentStagiaire modele="reclamation" libelle="Réclamation" titre="Fiche de réclamation" icone={FileWarning} {...props} />;
}

/** Le stagiaire relève-t-il du conseil ? Une sanction d'assiduité ou de comportement de son autorité (« CD »). */
export const releveDuConseil = (note) =>
  note?.assiduite?.sanction?.autorite === 'CD' || note?.comportement?.sanction?.autorite === 'CD';
