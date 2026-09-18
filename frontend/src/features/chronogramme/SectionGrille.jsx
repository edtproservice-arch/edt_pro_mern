import { ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

/**
 * Une grille de chronogramme, dans un bloc qui se replie.
 *
 * ═══ POURQUOI ELLES NE SONT PAS TOUTES DÉPLIÉES ═══
 * Une grille fait 45 colonnes sur une vingtaine de lignes, soit ~1 700 nœuds
 * DOM. Cocher les 17 formateurs de l'établissement en montait **10 260 cellules
 * et 28 961 nœuds** d'un coup — mesuré — et le rendu se figeait plus de trente
 * secondes. C'est exactement ce qui rendait la page Affectations inutilisable,
 * et la parade y est déjà écrite : on ne monte pas ce qu'on ne regarde pas.
 *
 * ⚠️ `CollapsibleContent` DÉMONTE son contenu quand il est fermé — ce n'est pas
 * un simple `display: none`. C'est ce qui fait tout le gain ici : un bloc replié
 * ne coûte que son en-tête.
 *
 * L'en-tête, lui, reste toujours visible : il porte le nom, le décompte et les
 * actions. On choisit donc quelle grille ouvrir sans avoir à la déplier, ce que
 * l'en-tête d'un ensemble d'affectations permet déjà.
 */
export default function SectionGrille({
  titre,
  resume,
  actions,
  ouvert,
  onOuvrir,
  children,
}) {
  return (
    <Collapsible open={ouvert} onOpenChange={onOuvrir} className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              ouvert && 'rotate-90'
            )}
          />
          <span className="truncate text-sm font-medium">{titre}</span>
          {resume && <div className="shrink-0 inline-flex items-center">{resume}</div>}
        </CollapsibleTrigger>

        {/*
          Les actions restent HORS du déclencheur : imbriquées dedans, un clic
          sur « Réinitialiser » aurait aussi replié le bloc, et le résultat de
          l'action serait passé sous les yeux sans être vu.
        */}
        {actions}
      </div>

      <CollapsibleContent className="space-y-2 border-t p-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Combien de grilles ouvrir d'emblée.
 *
 * En ouvrir une ou deux est ce qu'on vient chercher en les cochant ; au-delà,
 * c'est une comparaison qu'on mène bloc par bloc, et tout monter d'un coup fige
 * la page avant même qu'on ait pu lire la première.
 */
export const OUVERTES_AU_DEPART = 2;
