import { ArrowRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { NATURES, libelleNature } from './completudeApparence';

/**
 * Les écarts d'une semaine au chronogramme, module par module.
 *
 * ⚠️ UNE LISTE SUR DEUX LIGNES, PLUS UN TABLEAU (2026-09-28) : le rapport vit
 *    désormais dans un panneau latéral d'environ 500 px, où six colonnes ne
 *    tiennent pas. Chaque écart garde TOUTES ses informations — groupe, module,
 *    type, formateur, prévu, posé, heures absentes, nature, lien vers la case.
 */
export default function ListeEcarts({ ecarts, onAllerAuxCases }) {
  return (
    <ul className="divide-y rounded-lg border">
      {ecarts.map((e) => (
        <li key={`${e.groupe}|${e.module}|${e.type}`} className="space-y-1 px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium">{e.groupe}</span>
            <span className="font-mono text-xs">{e.module}</span>
            {e.type === 'synchrone' && (
              <Badge variant="outline" className="font-normal">
                à distance
              </Badge>
            )}
            <Badge
              variant="secondary"
              className={cn('ml-auto shrink-0 font-normal', NATURES[e.nature]?.classe)}
            >
              {libelleNature(e.nature)}
            </Badge>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">{e.formateur || '—'}</span>
            <span className="shrink-0 tabular-nums">
              prévu {e.prevu} h · posé {e.pose} h
              {/*
                ⚠️ LES HEURES ABSENTES SONT DITES À PART. Une séance marquée
                absente RESTE posée — le créneau est occupé — mais lire « 5 h
                posées » sans savoir que 2,5 n'ont pas été données donnerait une
                fausse tranquillité.
              */}
              {e.absent > 0 && <> (dont {e.absent} h absentes)</>}
            </span>
          </div>

          {/*
            ⚠️ UNE SÉANCE HORS CHRONOGRAMME SE SUPPRIME (2026-09-27, demande du
            porteur) : le lien mène à ses cases et les sélectionne — Suppr
            suffit. « En trop » les montre sans les sélectionner : une seule est
            de trop.
          */}
          {onAllerAuxCases && e.positions?.length > 0 && (
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0 text-xs"
              onClick={() =>
                onAllerAuxCases(e.positions, { selectionner: e.nature === 'hors_chronogramme' })
              }
            >
              {e.nature === 'hors_chronogramme' ? 'Supprimer dans la grille' : 'Voir dans la grille'}
              <ArrowRight className="h-3 w-3" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
