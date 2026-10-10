import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Le MOTIF d'une indisponibilité de formateur (2026-10-11, demande du
 * porteur : « le formateur peut s'absenter pour d'autres raisons comme congé
 * de paternité, congé de décès d'un proche… »).
 *
 * Les motifs courants en pastilles — un clic suffit dans la plupart des cas —
 * et « Autre » ouvre un champ libre : la liste ne prétend pas tout prévoir.
 *
 * @param {string[]} motifs — les propositions (`MOTIFS_INDISPONIBILITE`)
 */
export default function ChoixMotif({ motifs, valeur, onChange, className }) {
  // « Autre » : choisi mais pas encore précisé, ou un texte libre déjà saisi.
  const autre = valeur === AUTRE || (valeur !== '' && !motifs.includes(valeur));

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex flex-wrap gap-1">
        {[...motifs, 'Autre…'].map((motif) => {
          const estAutre = motif === 'Autre…';
          const actif = estAutre ? autre : valeur === motif;
          return (
            <button
              key={motif}
              type="button"
              aria-pressed={actif}
              onClick={() => (estAutre ? !autre && onChange(AUTRE) : onChange(motif))}
              className={cn(
                'rounded-md border px-2 py-0.5 text-xs transition-colors',
                actif
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-muted'
              )}
            >
              {motif}
            </button>
          );
        })}
      </div>
      {autre && (
        <Input
          autoFocus
          value={valeur === AUTRE ? '' : valeur}
          maxLength={100}
          placeholder="Préciser le motif…"
          className="h-8 text-xs"
          onChange={(evenement) => onChange(evenement.target.value || AUTRE)}
        />
      )}
    </div>
  );
}

/**
 * « Autre » choisi, texte pas encore saisi. ⚠️ Une valeur SENTINELLE, jamais
 * enregistrée : `motifRetenu` la ramène au motif par défaut.
 */
const AUTRE = '\u0000autre';

/** Le motif à enregistrer : un « Autre » laissé vide ne vaut rien de plus que le motif par défaut. */
export const motifRetenu = (valeur, parDefaut) => (valeur && valeur !== AUTRE ? valeur.trim() || parDefaut : parDefaut);
