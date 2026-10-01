import { nombre } from '@/lib/nombres';
import { cn } from '@/lib/utils';

/**
 * Un (groupe, module) de l'écart de saisie e-note : l'intitulé, les heures
 * saisies et réalisées, l'écart, puis les séances de la grille qui le composent.
 *
 * ⚠️ PARTAGÉE entre le panneau du directeur (`DetailEcartSaisie`) et le message
 * reçu par le formateur (`CarteEcartSaisie`, 2026-10-01, demande du porteur :
 * « en message, le même style d'affichage que le panneau ») — une seule carte,
 * pour que les deux ne divergent pas.
 */
export default function CarteModuleEcart({ ligne }) {
  const manque = ligne.ecart < 0;
  return (
    <div className="rounded-lg border bg-background">
      <div className="flex items-start justify-between gap-3 border-b px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{ligne.intitule || ligne.module}</p>
          <p className="text-xs text-muted-foreground">
            {ligne.groupe} · {ligne.module} · E-note {nombre(ligne.enote)} h · EDT {nombre(ligne.edt)} h
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
            manque ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
          )}
        >
          {nombre(ligne.ecart)} h
        </span>
      </div>

      {ligne.seances.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Aucune séance dans la grille sur cette période.
        </p>
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {ligne.seances.map((seance, index) => (
              <tr key={index} className="border-b last:border-b-0">
                <td className="px-3 py-1.5">
                  {seance.jour} {dateCourte(seance.date)}
                </td>
                <td className="px-3 py-1.5 font-medium">{seance.creneau}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{seance.salle || '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{nombre(seance.heures)} h</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** « 2026-09-14 » → « 14/09 ». */
export function dateCourte(jour) {
  const [, mois, j] = String(jour).split('-');
  return `${j}/${mois}`;
}
