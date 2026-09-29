import { Check, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Fil d'étapes de la configuration initiale.
 * ← `.stepper-container` de public/setup.html:436-444
 *
 * Une étape franchie reste cliquable : le directeur doit pouvoir revenir
 * corriger sa base sans tout recommencer. Une étape non atteinte ne l'est pas.
 *
 * ⚠️ UNE ÉTAPE PASSÉE N'EST PAS UNE ÉTAPE FAITE (2026-09-20) : cochée en vert, elle
 * laisserait croire que tout est en ordre alors qu'elle reste à compléter avant de
 * pouvoir terminer. Elle porte une flèche « passée », en orange.
 *
 * @param {number[]} [props.passees]  numéros (à partir de 1) des étapes passées
 */
export default function Etapes({ etapes, courante, atteinte, onChoisir, passees = [] }) {
  return (
    <ol className="flex items-center gap-2 overflow-x-auto pb-2">
      {etapes.map((etape, index) => {
        const numero = index + 1;
        const active = numero === courante;
        const franchie = numero < atteinte;
        const accessible = numero <= atteinte;
        const passee = franchie && passees.includes(numero);

        return (
          <li key={etape.cle} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              disabled={!accessible}
              onClick={() => accessible && onChoisir(numero)}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-3 rounded-md border p-3 text-left transition-colors',
                active && 'border-primary bg-primary/5',
                !active && accessible && 'hover:bg-muted',
                !accessible && 'opacity-50'
              )}
            >
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium',
                  active && 'bg-primary text-primary-foreground',
                  franchie && !active && !passee && 'bg-success text-success-foreground',
                  passee && !active && 'bg-warning text-warning-foreground',
                  !active && !franchie && 'bg-muted text-muted-foreground'
                )}
              >
                {passee && !active ? (
                  <SkipForward className="h-4 w-4" />
                ) : franchie && !active ? (
                  <Check className="h-4 w-4" />
                ) : (
                  numero
                )}
              </span>

              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{etape.titre}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {passee ? 'Passée — à compléter' : etape.resume}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
