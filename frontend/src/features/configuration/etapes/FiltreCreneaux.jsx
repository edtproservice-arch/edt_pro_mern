import { CalendarClock } from 'lucide-react';
import { JOURS } from 'shared/constants';
import { CRENEAUX_CONTRAINTES } from 'shared/domain';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { MODE_DISPONIBLES, MODE_INDISPONIBLES } from './filtresFormateurs';

/**
 * Le filtre par créneau : quels formateurs sont indisponibles — ou libres — sur
 * tels créneaux.
 *
 * ⚠️ LA MÊME GRILLE QUE LA MODALE d'indisponibilité (6 jours × 4 créneaux, le jour
 * entier d'un clic sur son nom) : on coche ici ce qu'on y a coché là-bas, sans
 * apprendre un second geste.
 *
 * ⚠️ LE SENS SE CHOISIT, ET IL S'ÉCRIT EN TOUTES LETTRES. « Indisponibles » retient
 * qui a déclaré AU MOINS UN des créneaux cochés ; « disponibles » qui est libre sur
 * TOUS. Ce ne sont pas les deux faces d'une même règle, et le libellé dit laquelle
 * s'applique plutôt que de laisser deviner.
 *
 * @param {string[]} props.selection clés « Jour|S1 »
 */
export default function FiltreCreneaux({ selection, mode, onChange, onModeChange }) {
  const retenus = new Set(selection);

  const basculer = (cles, valeur) => {
    const suivants = new Set(retenus);
    for (const cle of cles) {
      if (valeur) suivants.add(cle);
      else suivants.delete(cle);
    }
    onChange([...suivants]);
  };

  const cleDe = (jour, seance) => `${jour}|${seance}`;
  const cles = (jour) => CRENEAUX_CONTRAINTES.map((seance) => cleDe(jour, seance));

  const resume =
    selection.length === 0
      ? 'Tous les créneaux'
      : `${mode === MODE_DISPONIBLES ? 'Libres' : 'Indisponibles'} · ${selection.length} créneau(x)`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 justify-start gap-2 font-normal">
          <CalendarClock className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn(selection.length > 0 && 'font-medium')}>{resume}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 space-y-3 p-3">
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1" role="group" aria-label="Sens du filtre">
          {[
            [MODE_INDISPONIBLES, 'Indisponibles'],
            [MODE_DISPONIBLES, 'Disponibles'],
          ].map(([valeur, libelle]) => (
            <button
              key={valeur}
              type="button"
              aria-pressed={mode === valeur}
              onClick={() => onModeChange(valeur)}
              className={cn(
                'rounded px-2 py-1 text-xs transition-colors',
                mode === valeur ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'
              )}
            >
              {libelle}
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          {mode === MODE_DISPONIBLES
            ? 'Formateurs libres sur tous les créneaux cochés.'
            : 'Formateurs indisponibles sur au moins un des créneaux cochés.'}
        </p>

        <table className="w-full border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th className="w-20" />
              {CRENEAUX_CONTRAINTES.map((seance) => (
                <th key={seance} className="font-medium text-muted-foreground">
                  {seance}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {JOURS.map((jour) => {
              const duJour = cles(jour);
              const toutLeJour = duJour.every((cle) => retenus.has(cle));

              return (
                <tr key={jour}>
                  <th className="text-left font-medium">
                    {/* Le jour entier d'un clic, comme dans la modale. */}
                    <button
                      type="button"
                      className="hover:underline"
                      onClick={() => basculer(duJour, !toutLeJour)}
                    >
                      {jour}
                    </button>
                  </th>
                  {CRENEAUX_CONTRAINTES.map((seance) => {
                    const coche = retenus.has(cleDe(jour, seance));
                    return (
                      <td key={seance}>
                        <button
                          type="button"
                          aria-pressed={coche}
                          aria-label={`${jour} ${seance}`}
                          onClick={() => basculer([cleDe(jour, seance)], !coche)}
                          className={cn(
                            'h-7 w-full rounded-md border transition-colors',
                            coche
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'hover:bg-muted'
                          )}
                        >
                          {coche ? '✓' : ''}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {selection.length > 0 ? `${selection.length} coché(s)` : 'Aucun créneau coché'}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={selection.length === 0}
            onClick={() => onChange([])}
          >
            Tout effacer
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
