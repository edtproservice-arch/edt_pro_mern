import { useState } from 'react';
import { ListFilter } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Le filtre d'une colonne de la grille, comme dans Excel (2026-10-09, demande
 * du porteur : « permettre de filtrer les 4 premières colonnes »).
 *
 * Une liste de cases à cocher des valeurs présentes, avec une recherche pour
 * les colonnes longues.
 *
 * ⚠️ `choisies === null` VEUT DIRE « PAS DE FILTRE » — et non « tout coché »
 *    écrit en dur : une valeur apparue depuis (un module ajouté à la carte)
 *    reste visible. Cocher de nouveau toutes les valeurs revient à `null`.
 *
 * @param {string[]} valeurs — triées, sans doublon
 * @param {Set<string>|null} choisies
 */
export default function FiltreColonne({ titre, valeurs, choisies, onChanger, recherche = false }) {
  const [texte, setTexte] = useState('');
  const actif = choisies !== null;
  const visibles = texte
    ? valeurs.filter((valeur) => valeur.toLowerCase().includes(texte.trim().toLowerCase()))
    : valeurs;

  const cochee = (valeur) => choisies === null || choisies.has(valeur);

  /*
   * Tout cocher / tout décocher (2026-10-09, demande du porteur). Avec une
   * recherche, ils ne portent que sur les valeurs TROUVÉES — comme dans Excel,
   * où « Sélectionner tout » suit la recherche.
   */
  const toutCocher = () => {
    if (!texte) return onChanger(null);
    const suivantes = new Set([...(choisies ?? valeurs), ...visibles]);
    return onChanger(suivantes.size === valeurs.length ? null : suivantes);
  };
  const toutDecocher = () => {
    if (!texte) return onChanger(new Set());
    const suivantes = new Set(choisies ?? valeurs);
    for (const valeur of visibles) suivantes.delete(valeur);
    return onChanger(suivantes);
  };
  const basculer = (valeur) => {
    const suivantes = new Set(choisies ?? valeurs);
    if (suivantes.has(valeur)) suivantes.delete(valeur);
    else suivantes.add(valeur);
    onChanger(suivantes.size === valeurs.length ? null : suivantes);
  };

  return (
    <Popover onOpenChange={(ouvert) => !ouvert && setTexte('')}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={actif ? `Filtre actif sur « ${titre} »` : `Filtrer « ${titre} »`}
          className={cn(
            'inline-flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted',
            actif ? 'bg-primary/15 text-primary' : 'text-muted-foreground'
          )}
        >
          <ListFilter className="size-3.5" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-64 p-2 text-sm font-normal">
        {recherche && (
          <Input
            autoFocus
            value={texte}
            onChange={(evenement) => setTexte(evenement.target.value)}
            placeholder="Rechercher…"
            className="mb-2 h-8"
          />
        )}

        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <button type="button" className="text-primary hover:underline" onClick={toutCocher}>
            Tout cocher
          </button>
          <button type="button" className="text-primary hover:underline" onClick={toutDecocher}>
            Tout décocher
          </button>
          {texte && (
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => onChanger(visibles.length === valeurs.length ? null : new Set(visibles))}
            >
              Seulement ces {visibles.length}
            </button>
          )}
        </div>

        <div className="max-h-64 overflow-y-auto">
          {visibles.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">Aucune valeur.</p>
          ) : (
            visibles.map((valeur) => (
              <label
                key={valeur}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted"
              >
                <Checkbox checked={cochee(valeur)} onCheckedChange={() => basculer(valeur)} />
                <span className="truncate" title={valeur}>
                  {valeur}
                </span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
