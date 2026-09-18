import { ChevronDown, GraduationCap, Layers, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Effectifs en cartes cliquables.
 *
 * ═══ POURQUOI CLIQUABLES ═══
 * Un nombre seul ne se vérifie pas : « 995 stagiaires » ne dit pas s'il en
 * manque une filière. La carte ouvre donc le détail qui la compose — c'est le
 * seul moyen de contrôler un import avant d'imprimer 995 badges.
 */
const CARTES = [
  {
    cle: 'stagiaires',
    libelle: 'Stagiaires',
    icone: Users,
    valeur: (stats) => stats.total,
    aide: 'personnes distinctes',
  },
  {
    cle: 'filieres',
    libelle: 'Filières',
    icone: GraduationCap,
    valeur: (stats) => stats.nombreFilieres,
    aide: 'représentées',
  },
  {
    cle: 'groupes',
    libelle: 'Groupes',
    icone: Layers,
    valeur: (stats) => stats.nombreGroupes,
    aide: 'inscriptions comprises',
  },
];

export default function CartesEffectifs({ statistiques, ouvert, onBasculer }) {
  const stats = statistiques ?? { total: 0, nombreFilieres: 0, nombreGroupes: 0 };

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {CARTES.map(({ cle, libelle, icone: Icone, valeur, aide }) => (
        <button
          key={cle}
          type="button"
          onClick={() => onBasculer(cle)}
          aria-expanded={ouvert === cle}
          className={cn(
            'flex items-center gap-3 rounded-lg border p-4 text-left transition-colors',
            ouvert === cle ? 'border-primary bg-primary/5' : 'hover:bg-muted'
          )}
        >
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg',
              ouvert === cle ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
            )}
          >
            <Icone className="size-5" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-2xl font-semibold tabular-nums leading-none">
              {valeur(stats)}
            </span>
            <span className="mt-1 block truncate text-sm font-medium">{libelle}</span>
            {/*
              ⚠️ « personnes distinctes » et « inscriptions comprises » ne sont
              pas décoratifs : un stagiaire inscrit dans un tronc ET un module FQ
              compte dans DEUX groupes. Sans cette précision, la somme des
              groupes dépasse le total et le chiffre paraît faux.
            */}
            <span className="block truncate text-xs text-muted-foreground">{aide}</span>
          </span>

          <ChevronDown
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              ouvert === cle && 'rotate-180'
            )}
          />
        </button>
      ))}
    </div>
  );
}
