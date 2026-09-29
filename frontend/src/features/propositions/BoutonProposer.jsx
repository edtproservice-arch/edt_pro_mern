import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { ROLES } from 'shared/constants';
import { recupererSession } from '@/features/auth/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import DialogueProposition from './DialogueProposition';

/**
 * « Proposer mon emploi » — l'entrée du formateur.
 * ← `#btn-proposition-compose` de inbox.html
 *
 * Posé sur « Mon emploi du temps », là où le formateur regarde sa semaine, et
 * dans la messagerie, là où l'existant le plaçait.
 *
 * ⚠️ IL NE S'AFFICHE QUE POUR UN FORMATEUR — il décide seul, pour que chaque
 * écran qui le pose n'ait pas à le savoir. Le serveur refuse les autres rôles.
 */
export default function BoutonProposer({ className, compact = false }) {
  const [ouvert, setOuvert] = useState(false);
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });

  if (session.data?.utilisateur?.role !== ROLES.FORMATEUR) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn('h-8 gap-1.5 text-xs', className)}
        aria-label="Proposer mon emploi du temps"
        title="Proposer mon emploi du temps de la semaine suivante"
        onClick={() => setOuvert(true)}
      >
        <CalendarPlus className="size-3.5" />
        {!compact && <span>Proposer mon emploi</span>}
      </Button>
      {ouvert && <DialogueProposition ouvert={ouvert} onOpenChange={setOuvert} />}
    </>
  );
}
