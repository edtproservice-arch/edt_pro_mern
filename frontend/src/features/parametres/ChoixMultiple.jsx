import { useState } from 'react';
import { Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Choix multiple de sujets — groupes ou formateurs.
 *
 * ═══ POURQUOI PLUSIEURS À LA FOIS ═══
 * Une même période concerne presque toujours plusieurs sujets : trois groupes
 * partent en stage la même semaine, deux formateurs suivent la même formation.
 * Un choix unique obligeait à ressaisir les mêmes dates autant de fois qu'il y a
 * de sujets — et une date recopiée de travers passe inaperçue.
 *
 * Le filtre apparaît au-delà d'une douzaine : en dessous, il occupe la place
 * sans rien faire gagner ; au-dessus, trouver un nom dans trente cases à cocher
 * devient un exercice.
 */
export default function ChoixMultiple({ sujets, selection, onChange, libelle }) {
  const [filtre, setFiltre] = useState('');

  const visibles = sujets.filter((sujet) =>
    sujet.libelle.toLowerCase().includes(filtre.trim().toLowerCase())
  );

  const basculer = (valeur) =>
    onChange(
      selection.includes(valeur)
        ? selection.filter((autre) => autre !== valeur)
        : [...selection, valeur]
    );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>{libelle}</Label>

        {selection.length > 0 && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-normal">
              {selection.length} sélectionné(s)
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onChange([])}
            >
              Tout décocher
            </Button>
          </div>
        )}
      </div>

      {sujets.length > 12 && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filtre}
            onChange={(e) => setFiltre(e.target.value)}
            placeholder="Filtrer…"
            className="h-8 pl-8"
          />
        </div>
      )}

      <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2">
        {visibles.length === 0 && (
          <p className="px-1 py-2 text-sm text-muted-foreground">
            {sujets.length === 0 ? 'Aucun disponible.' : 'Aucun résultat pour ce filtre.'}
          </p>
        )}

        {visibles.map((sujet) => (
          <label
            key={sujet.valeur}
            className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-muted"
          >
            <Checkbox
              checked={selection.includes(sujet.valeur)}
              onCheckedChange={() => basculer(sujet.valeur)}
            />
            <span className="min-w-0 truncate">{sujet.libelle}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
