import { useState } from 'react';
import { fr } from 'date-fns/locale';
import { CalendarDays, X } from 'lucide-react';
import { enJour } from 'shared/domain';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Le choix d'UNE date : le calendrier shadcn dans une fenêtre, à la place du sélecteur natif du
 * navigateur. (demande du porteur, 2026-09-20 : « mets le calendrier de shadcn ».) Celui du
 * navigateur change d'un système à l'autre et ne ressemble pas au reste de l'application.
 *
 * ⚠️ LA DATE RESTE UNE CHAÎNE « AAAA-MM-JJ », lue à minuit LOCAL : c'est le format que l'API
 * échange, et une date construite à minuit UTC rendrait la veille au Maroc (voir `enJour`).
 *
 * ⚠️ VIDE = « PAS DE DATE » : la valeur est `''`, et « Effacer » y revient — un champ de date
 * qui ne se vide pas ne permettrait pas de retirer une rentrée.
 *
 * @param {string} props.valeur          « AAAA-MM-JJ », ou '' quand rien n'est choisi
 * @param {(valeur: string) => void} props.onChange  reçoit « AAAA-MM-JJ », ou '' à l'effacement
 * @param {Date} [props.moisParDefaut]   le mois ouvert quand aucune date n'est choisie
 * @param {boolean} [props.effacable]    propose « Effacer » (défaut : oui)
 */
export default function SelecteurDate({
  id,
  valeur,
  onChange,
  moisParDefaut,
  placeholder = 'Choisir une date…',
  effacable = true,
  disabled = false,
  // Les jours non sélectionnables (matcher react-day-picker), ex. `{ before: new Date() }`.
  joursDesactives,
  'aria-label': libelle,
  className,
}) {
  const [ouvert, setOuvert] = useState(false);
  const date = valeur ? new Date(`${valeur}T00:00:00`) : undefined;

  return (
    <Popover open={ouvert} onOpenChange={setOuvert}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={libelle}
          className={cn(
            'h-9 w-full justify-start gap-2 bg-card text-sm font-normal',
            !date && 'text-muted-foreground',
            className
          )}
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
          {date
            ? date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
            : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={fr}
          selected={date}
          defaultMonth={date ?? moisParDefaut}
          disabled={joursDesactives}
          onSelect={(choix) => {
            // Recliquer sur la date choisie la désélectionne : on n'en fait pas un effacement.
            if (!choix) return;
            onChange(enJour(choix));
            setOuvert(false);
          }}
        />
        {effacable && date && (
          <div className="border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-center gap-1.5 text-muted-foreground"
              onClick={() => {
                onChange('');
                setOuvert(false);
              }}
            >
              <X className="size-4" />
              Effacer la date
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
