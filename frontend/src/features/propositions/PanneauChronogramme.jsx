import { CheckCircle2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { dejaImportees } from './grille';

/**
 * Ce que le chronogramme prévoit cette semaine — à importer dans la grille.
 * ← l'onglet « Chronogramme » de la fenêtre de proposition (`propLoadChrono`)
 *
 * ⚠️ EN MODE CHRONOGRAMME, C'EST LA SEULE FAÇON DE REMPLIR LA GRILLE (décision
 * du porteur, 2026-09-23) : « le formateur n'est pas libre, il doit importer les
 * séances depuis le chronogramme et déplacer ». Pas de « + » dans les cases.
 *
 * Chaque ligne dit combien de séances sont déjà dans la grille sur combien
 * prévues : importer complète, sans jamais doubler.
 */
export default function PanneauChronogramme({ items, grille, onImporter }) {
  const restant = items.some((item) => dejaImportees(grille, item) < item.nombre);

  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Séances prévues au chronogramme</p>
        <Button type="button" size="sm" disabled={!restant} onClick={() => onImporter(items)}>
          <Download className="size-3.5" /> Tout importer
        </Button>
      </div>

      <ul className="divide-y rounded-md border bg-background text-xs">
        {items.map((item) => {
          const posees = dejaImportees(grille, item);
          const complet = posees >= item.nombre;
          return (
            <li key={`${item.groupe}|${item.module}`} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {item.groupe}
                  {item.type === 'synchrone' && <span className="ml-1 font-normal text-muted-foreground">(à distance)</span>}
                </p>
                <p className="truncate text-muted-foreground">{item.module}</p>
              </div>
              <span className={complet ? 'text-success' : 'text-muted-foreground'}>
                {posees} / {item.nombre} séance{item.nombre > 1 ? 's' : ''}
              </span>
              {complet ? (
                <CheckCircle2 className="size-4 text-success" aria-label="Importée" />
              ) : (
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => onImporter([item])}>
                  Importer
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
