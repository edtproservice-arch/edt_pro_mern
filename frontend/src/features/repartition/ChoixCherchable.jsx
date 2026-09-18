import { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Un choix UNIQUE dans une longue liste — filière (1 003) ou métier (364).
 * (demande du porteur, 2026-09-02.)
 *
 * ═══ ⚠️ POURQUOI PAS UN `Select` COMME LES AUTRES FILTRES ═══
 * Secteur (29), niveau (7), créneau (2) et année (3) tiennent dans une liste
 * déroulante qu'on parcourt. Mille filières, non : il faut CHERCHER. Le
 * `Command` de shadcn fait les deux — on ouvre, on voit, et on tape pour
 * réduire. C'est le composant déjà employé par les filtres de la page Édition.
 *
 * ⚠️ UNE VALEUR CHOISIE SE RETIRE SANS ROUVRIR LA LISTE : la croix efface le
 * filtre. Sans elle, revenir à « tous » demanderait de retrouver l'entrée
 * cochée dans une liste de mille pour la décocher.
 *
 * @param {{valeur: string, libelle: string, secondaire?: string}[]} options
 */
export default function ChoixCherchable({
  libelle,
  tous,
  valeur,
  options,
  onChange,
  enChargement = false,
}) {
  const choisie = options.find((option) => option.valeur === valeur);

  /*
   * ═══ ⚠️ LE PANNEAU SE FERME QUAND ON CHOISIT ═══ (défaut constaté à l'écran,
   * 2026-09-02 : deux panneaux ouverts EN MÊME TEMPS, `data-state="open"` sur
   * les deux.) Un `Popover` non contrôlé ne se referme pas sur la sélection
   * d'un `CommandItem` — il ne sait rien de ce qui se passe dedans. Le panneau
   * restait donc posé PAR-DESSUS le tableau qu'on venait de filtrer, c'est-à-dire
   * par-dessus le résultat de son propre clic.
   *
   * ⚠️ ET C'EST UN CHOIX UNIQUE : sur une liste à cocher, rester ouvert est
   * juste — on en coche plusieurs. Ici, choisir termine le geste.
   */
  const [ouvert, setOuvert] = useState(false);

  /*
   * ═══ ⚠️ LA RECHERCHE SE VIDE À CHAQUE OUVERTURE ═══ (défaut constaté à
   * l'écran, 2026-09-02.) Le panneau rouvrait avec la saisie précédente encore
   * dedans : après un changement de secteur — qui remet filière et métier à
   * zéro — la liste s'ouvrait sur « Aucune correspondance » alors qu'elle
   * portait quarante et une entrées. On lit alors que le filtre est cassé,
   * quand il ne fait qu'obéir à un texte qu'on ne se rappelle pas avoir tapé.
   *
   * ⚠️ ET ON NE COMPTE PAS SUR LE DÉMONTAGE de `PopoverContent` pour l'effacer :
   * il dépend de la fin de l'animation de sortie, donc du temps. Une saisie
   * contrôlée ne dépend de rien.
   */
  const [saisie, setSaisie] = useState('');

  const basculer = (prochain) => {
    setOuvert(prochain);
    setSaisie('');
  };

  return (
    <div className="space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {libelle}
      </span>

      <div className="flex items-center gap-1">
        <Popover open={ouvert} onOpenChange={basculer}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              disabled={enChargement || options.length === 0}
              className="h-9 min-w-0 flex-1 justify-between font-normal"
            >
              {/*
                ⚠️ LE LIBELLÉ EST TRONQUÉ, JAMAIS REPLIÉ : un intitulé DRIF monte
                à quatre-vingts caractères, et le laisser se replier ferait
                grandir le bouton au-delà de sa colonne de grille — les quatre
                filtres cesseraient d'être alignés.
              */}
              <span className="truncate">
                {choisie ? (choisie.libelle ?? choisie.valeur) : tous}
              </span>
              <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>

          <PopoverContent
            /*
             * ⚠️ BORNÉ À LA PLACE DISPONIBLE : ancré sur un bouton situé au
             * milieu de la rangée, un panneau large sortait de la fenêtre — le
             * défaut déjà corrigé sur le filtre par établissement.
             */
            className="w-[min(32rem,var(--radix-popover-content-available-width))] p-0"
            align="start"
          >
            <Command
              /*
               * ⚠️ LA RECHERCHE PORTE SUR CE QUI EST AFFICHÉ, ET SUR LA VALEUR :
               * `value` reçoit le libellé — sinon taper « Agriculture » ne
               * trouverait rien dans une liste indexée par code — et `keywords`
               * le code, pour que « AGRI_AEEV_Q » reste cherchable.
               */
              filter={(valeurCherchee, saisie, motsCles) => {
                const texte = `${valeurCherchee} ${(motsCles ?? []).join(' ')}`.toLowerCase();
                return texte.includes(saisie.toLowerCase()) ? 1 : 0;
              }}
            >
              <CommandInput
                value={saisie}
                onValueChange={setSaisie}
                placeholder={`Rechercher ${libelle.toLowerCase()}…`}
                className="h-9"
              />
              <CommandList>
                <CommandEmpty>Aucune correspondance.</CommandEmpty>
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem
                      key={option.valeur}
                      value={option.libelle ?? option.valeur}
                      /*
                       * ⚠️⚠️ L'INTITULÉ DOIT ÊTRE CHERCHABLE, PAS SEULEMENT LE
                       * CODE (défaut constaté à l'écran, 2026-09-02) : la liste
                       * affiche « AGRI_AEEV_Q » en tête et son intitulé dessous,
                       * et sans cette ligne taper « Aménagements » ne trouvait
                       * RIEN — « Aucune correspondance » sur une filière
                       * pourtant présente. Sur mille entrées, on cherche par
                       * nom au moins autant que par code.
                       */
                      keywords={[option.valeur, option.secondaire].filter(Boolean)}
                      onSelect={() => {
                        onChange(option.valeur === valeur ? undefined : option.valeur);
                        basculer(false);
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 size-4 shrink-0',
                          option.valeur === valeur ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block truncate">{option.libelle ?? option.valeur}</span>
                        {option.secondaire && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {option.secondaire}
                          </span>
                        )}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {choisie && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label={`Retirer le filtre ${libelle.toLowerCase()}`}
            onClick={() => onChange(undefined)}
          >
            <X />
          </Button>
        )}
      </div>
    </div>
  );
}
