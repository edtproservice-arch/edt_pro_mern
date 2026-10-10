import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { facettesDesGroupes, filtrerGroupes } from 'shared/domain';
import { cn } from '@/lib/utils';
import { FiltreGroupes } from '@/features/edition/FiltresDetaillee';

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
// Les deux valeurs que `construireGroupes` écrit dans `groupeModes`.
const MODES_FORMATION = ['Alterné', 'Résidentiel'];

/**
 * @param {object} [identites] — groupe → `{filiere, filiereLibelle, niveau, annee}`
 *   (`groupesIdentites` du contexte de l'emploi). Fourni, il ajoute le filtre
 *   NIVEAU / ANNÉE / FILIÈRE d'Édition (2026-10-10, demande du porteur : « pour
 *   les groupes, ajoute le filtre par niveau, année, filière ») — le même
 *   bouton, les mêmes facettes, réduites à ce que les groupes portent vraiment.
 */
export default function ChoixMultiple({ sujets, selection, onChange, libelle, identites = null }) {
  const [filtre, setFiltre] = useState('');
  const [identite, setIdentite] = useState({ filieres: [], niveaux: [], annees: [] });
  const valeursSujets = useMemo(() => sujets.map((sujet) => sujet.valeur), [sujets]);
  const facettes = useMemo(
    () => (identites ? facettesDesGroupes(valeursSujets, identites) : null),
    [identites, valeursSujets]
  );
  const retenusParIdentite = useMemo(
    () => (identites ? new Set(filtrerGroupes(valeursSujets, identites, identite)) : null),
    [identites, valeursSujets, identite]
  );
  const identiteActive = identite.filieres.length + identite.niveaux.length + identite.annees.length > 0;
  const [mode, setMode] = useState(null);

  /*
   * ═══ FILTRE PAR MODE DE FORMATION (2026-10-10, demande du porteur) ═══
   * Alterné et résidentiel ne partent pas en stage aux mêmes dates : on coche
   * d'ordinaire tous les alternés d'un coup. Les modes viennent des sujets
   * eux-mêmes (`sujet.mode`).
   *
   * ⚠️ LES DEUX MODES SONT TOUJOURS PROPOSÉS dès que les sujets en portent un
   * (des groupes, pas des formateurs) : masquer « Alterné » parce qu'aucun
   * groupe ne l'est encore faisait croire que le filtre manquait.
   */
  const trouves = sujets.map((sujet) => sujet.mode).filter(Boolean);
  const modes =
    trouves.length === 0
      ? []
      : [...new Set([...MODES_FORMATION, ...trouves])].sort((a, b) => a.localeCompare(b, 'fr'));

  const visibles = sujets.filter(
    (sujet) =>
      (!mode || sujet.mode === mode) &&
      (!retenusParIdentite || retenusParIdentite.has(sujet.valeur)) &&
      sujet.libelle.toLowerCase().includes(filtre.trim().toLowerCase())
  );
  const toutesCochees = visibles.length > 0 && visibles.every((sujet) => selection.includes(sujet.valeur));
  const cocherVisibles = () => {
    const valeurs = visibles.map((sujet) => sujet.valeur);
    onChange(
      toutesCochees
        ? selection.filter((valeur) => !valeurs.includes(valeur))
        : [...selection, ...valeurs.filter((valeur) => !selection.includes(valeur))]
    );
  };

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

      {facettes && (
        <div className="flex flex-wrap items-center gap-2">
          {/* Le mode de formation vit DANS la carte Filière quand elle existe (2026-10-10). */}
          <FiltreGroupes
            facettes={facettes}
            valeurs={identite}
            onChanger={setIdentite}
            modes={modes}
            mode={mode}
            onMode={setMode}
          />
          <span className="text-xs tabular-nums text-muted-foreground">
            {visibles.length} sur {sujets.length}
          </span>
        </div>
      )}

      {/* Sans carte Filière (pas d'identités fournies), le mode garde ses boutons propres. */}
      {modes.length > 0 && !facettes && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Mode de formation">
          {[null, ...modes].map((valeur) => (
            <Button
              key={valeur ?? 'tous'}
              type="button"
              size="sm"
              variant={mode === valeur ? 'default' : 'outline'}
              aria-pressed={mode === valeur}
              // En bleu (2026-10-10, demande du porteur) : contour bleu au repos, plein une fois choisi.
              className={cn(
                'h-7 px-2.5 text-xs',
                mode !== valeur && 'border-primary/50 text-primary hover:bg-primary/10 hover:text-primary'
              )}
              onClick={() => setMode(valeur)}
            >
              {valeur ?? 'Tous'}
            </Button>
          ))}
        </div>
      )}

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

      {/* Le geste attendu après un filtre : cocher d'un coup ce qu'il montre. */}
      {(mode || filtre.trim() || identiteActive) && visibles.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={cocherVisibles}
        >
          {toutesCochees ? 'Décocher' : 'Cocher'} les {visibles.length} affiché(s)
        </Button>
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
