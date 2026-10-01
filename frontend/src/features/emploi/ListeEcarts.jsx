import { ArrowRight, Trash2 } from 'lucide-react';

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
const NATURES_RETIRABLES = ['en_trop', 'hors_chronogramme'];

/** Les séances d'un écart qu'on peut retirer sans creuser de manque. */
const retirables = (ecart) =>
  NATURES_RETIRABLES.includes(ecart.nature) ? (ecart.positions ?? []).filter((p) => p.retirable) : [];

export default function ListeEcarts({
  ecarts,
  onAllerAuxCases,
  onSupprimerSeance,
  suppressionEnCours = false,
}) {
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

          {/*
            ⚠️ « EN TROP » ET « HORS CHRONOGRAMME » SE SUPPRIMENT D'ICI
            (2026-10-01, demande du porteur), MÊME SOUS VERROU : une case par
            séance, le directeur choisit LAQUELLE retirer. Seules les séances
            `retirable` sont offertes — celles dont le retrait ne crée aucun
            manque, la règle même du serveur. Ctrl+Z la rétablit.
          */}
          {onSupprimerSeance && retirables(e).length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-xs text-muted-foreground">Supprimer :</span>
              {retirables(e).map((p) => (
                <Button
                  key={`${p.jour}|${p.seance}|${p.periode}|${p.formateurMatricule}`}
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={suppressionEnCours}
                  title={`Supprimer la séance du ${p.jour} ${p.seance}`}
                  onClick={() => onSupprimerSeance(p)}
                >
                  <Trash2 className="h-3 w-3" />
                  {p.jour} {p.seance}
                </Button>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
