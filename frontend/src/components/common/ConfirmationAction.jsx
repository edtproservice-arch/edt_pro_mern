import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Confirmation avant une action à conséquence.
 *
 * Volontairement générique : c'est l'appelant qui décrit ce qui va se passer.
 * Une confirmation qui dit seulement « Êtes-vous sûr ? » ne fait perdre du
 * temps sans rien éviter — l'utilisateur doit lire CE QUI change.
 */
export default function ConfirmationAction({
  ouvert,
  onOpenChange,
  titre,
  description,
  libelleConfirmation = 'Confirmer',
  destructive = false,
  onConfirmer,
}) {
  return (
    <AlertDialog open={ouvert} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titre}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirmer}
            className={cn(destructive && buttonVariants({ variant: 'destructive' }))}
          >
            {libelleConfirmation}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
