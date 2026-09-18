import { GripVertical } from 'lucide-react';
import * as ResizablePrimitive from 'react-resizable-panels';

import { cn } from '@/lib/utils';

/**
 * Panneaux redimensionnables.
 *
 * ═══ ⚠️ RÉÉCRIT POUR `react-resizable-panels` v4 ═══
 * Le fichier généré par la CLI shadcn vise l'API v2/v3 — `PanelGroup`,
 * `PanelResizeHandle`, `direction`, `data-panel-group-direction`. La v4 installée
 * ici n'exporte QUE `Group`, `Panel` et `Separator`, et l'orientation se lit
 * dans `aria-orientation`. Rendu tel quel, `ResizablePanelGroup` recevait des
 * enfants `undefined` : « Element type is invalid », page BLANCHE, alors que
 * `vite build` passait sans un mot.
 *
 * ⚠️⚠️ EN v4, UN NOMBRE EST UN NOMBRE DE PIXELS. `defaultSize={16}` vaut SEIZE
 * PIXELS, pas seize pour cent — c'est une chaîne qu'il faut passer
 * (`defaultSize="16"`) pour raisonner en pourcentage. Le piège est silencieux :
 * la colonne s'affiche, minuscule.
 */
/* ⚠️ Pas de classe de direction : `Group` pose lui-même `flex-direction` en
   style en ligne, d'après son `orientation`. */
const ResizablePanelGroup = ({ className, ...props }) => (
  <ResizablePrimitive.Group className={cn('flex h-full w-full', className)} {...props} />
);

const ResizablePanel = ResizablePrimitive.Panel;

/**
 * La poignée entre deux panneaux.
 *
 * ⚠️ UN TRAIT D'UN PIXEL, UNE ZONE DE PRISE DE QUATRE. Le trait dit où passe la
 * séparation, le `::after` invisible donne de quoi l'attraper : à un pixel près,
 * on ne saisit rien. C'est le parti du bloc d'origine, conservé.
 */
const ResizableHandle = ({ withHandle, className, ...props }) => (
  <ResizablePrimitive.Separator
    className={cn(
      'relative flex w-px items-center justify-center bg-border outline-none transition-colors',
      'after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2',
      'hover:bg-primary/40 focus-visible:ring-1 focus-visible:ring-ring',
      'aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full',
      'aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:left-0',
      'aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full',
      'aria-[orientation=horizontal]:after:-translate-y-1/2 aria-[orientation=horizontal]:after:translate-x-0',
      '[&[aria-orientation=horizontal]>div]:rotate-90',
      className
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </ResizablePrimitive.Separator>
);

/**
 * Mémorise les largeurs entre deux visites — le remplaçant v4 d'`autoSaveId`.
 * Rend `{ defaultLayout, onLayoutChanged }`, à étaler sur le groupe.
 */
const useDefaultLayout = ResizablePrimitive.useDefaultLayout;

export { ResizablePanelGroup, ResizablePanel, ResizableHandle, useDefaultLayout };
