import { useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Une liste où l'on coche PLUSIEURS choix à la fois, avec sa recherche.
 * ← `ChoixFormateurs` / `ChoixGroupes` du chronogramme, dont c'est le même geste :
 * le panneau reste ouvert pendant qu'on coche, pour ne pas le rouvrir entre chaque.
 *
 * ⚠️ « TOUT COCHER » PORTE SUR CE QUI EST VISIBLE, pas sur la liste entière.
 * Chercher « abdel » puis tout cocher doit retenir les « abdel » — c'est ce qu'on
 * vient de demander à l'écran. Cocher les trente autres au passage les retiendrait
 * sans qu'on le voie.
 *
 * @param {object} props
 * @param {string} props.invite  ce que dit le bouton quand rien n'est coché
 * @param {string} props.pluriel « formateurs » : « 3 formateurs »
 * @param {Array<{valeur: string, libelle: string, detail?: string}>} props.options
 * @param {string[]} props.selection
 * @param {(selection: string[]) => void} props.onChange
 */
export default function FiltreMultiple({
  invite,
  pluriel,
  options,
  selection,
  onChange,
  recherche = 'Rechercher…',
  vide = 'Aucun résultat.',
  className,
}) {
  const [filtre, setFiltre] = useState('');

  const terme = filtre.trim().toLowerCase();
  const visibles = terme
    ? options.filter((option) => option.libelle.toLowerCase().includes(terme))
    : options;

  const valeurs = visibles.map((option) => option.valeur);
  const toutRetenu = valeurs.length > 0 && valeurs.every((valeur) => selection.includes(valeur));
  const horsFiltre = selection.filter((valeur) => !valeurs.includes(valeur)).length;

  const basculer = (valeur) =>
    onChange(
      selection.includes(valeur)
        ? selection.filter((autre) => autre !== valeur)
        : [...selection, valeur]
    );

  const resume =
    selection.length === 0
      ? invite
      : selection.length === 1
        ? (options.find((option) => option.valeur === selection[0])?.libelle ?? selection[0])
        : `${selection.length} ${pluriel}`;

  return (
    <Popover onOpenChange={(ouvert) => !ouvert && setFiltre('')}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('h-8 w-56 justify-start gap-2 font-normal', className)}
        >
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-left',
              selection.length > 0 && 'font-medium'
            )}
          >
            {resume}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {selection.length > 0 ? `${selection.length} retenu(s)` : 'Aucun retenu'}
            </span>

            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={valeurs.length === 0}
                onClick={() =>
                  onChange(
                    toutRetenu
                      ? selection.filter((valeur) => !valeurs.includes(valeur))
                      : [...new Set([...selection, ...valeurs])]
                  )
                }
              >
                {toutRetenu ? 'Tout décocher' : 'Tout cocher'}
              </Button>

              {/* « Vider » n'apparaît QUE s'il reste des cases cochées hors de la
                  recherche : là, « Tout décocher » n'atteint pas tout. */}
              {horsFiltre > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={() => onChange([])}
                >
                  Vider
                </Button>
              )}
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filtre}
              onChange={(evenement) => setFiltre(evenement.target.value)}
              placeholder={recherche}
              className="h-8 pl-8"
            />
          </div>

          <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-lg border p-2">
            {visibles.length === 0 && (
              <p className="px-1 py-2 text-sm text-muted-foreground">{vide}</p>
            )}

            {visibles.map((option) => (
              <label
                key={option.valeur}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-muted"
              >
                <Checkbox
                  checked={selection.includes(option.valeur)}
                  onCheckedChange={() => basculer(option.valeur)}
                />
                <span className="min-w-0 flex-1 truncate">{option.libelle}</span>
                {option.detail && (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {option.detail}
                  </span>
                )}
              </label>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
