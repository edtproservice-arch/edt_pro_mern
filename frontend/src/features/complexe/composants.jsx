import { nombre } from '@/lib/nombres';
import { cn } from '@/lib/utils';

/**
 * Les pièces communes aux écrans du directeur de complexe (2026-10-27, refonte
 * demandée par le porteur : « pas cohérent avec le style d'EDT Pro ») — celles
 * de l'accueil du directeur d'établissement (`TableauDeBordAccueil`) : tuiles
 * simples, sections encadrées, jauges aux couleurs d'état. Écrites une fois pour
 * l'accueil ET les pages Formateurs, Espaces et Absences.
 */

/** La tuile de l'accueil du directeur : un bouton qui ouvre sa section, encadré quand elle l'est. */
export function Tuile({ libelle, valeur, detail, teinte, extra, extraBas, petit = false, onClick, ouvert }) {
  // Sans `onClick`, un simple bloc : une tuile qui n'ouvre rien ne se présente pas comme un bouton.
  const Element = onClick ? 'button' : 'div';
  return (
    <Element
      {...(onClick ? { type: 'button', 'aria-pressed': ouvert, onClick } : {})}
      className={cn(
        'rounded-lg border p-4 text-left',
        onClick && 'transition-colors hover:border-input hover:bg-muted/40',
        ouvert && 'border-primary/40 bg-primary/5'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground">{libelle}</p>
          <p className={cn('mt-1 font-semibold tabular-nums', petit ? 'text-lg' : 'text-2xl', teinte)}>{valeur ?? '—'}</p>
        </div>
        {extra}
      </div>
      {extraBas}
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </Element>
  );
}

/** La jauge des tuiles « Offre » et « Demande » de la page Affectation : rouge au-delà de 100 %. */
export function JaugeTaux({ taux: valeurTaux }) {
  return (
    <>
      <Jauge taux={valeurTaux} rougeAuDela={100} className="mt-2" />
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
        {valeurTaux === null ? '—' : `${nombre(valeurTaux)} %`}
      </p>
    </>
  );
}

/** Le cadre des sections de l'accueil du directeur : titre et précision dans le cadre. */
export function Section({ titre, precision, children }) {
  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium">{titre}</h2>
        {precision && <p className="text-xs text-muted-foreground">{precision}</p>}
      </div>
      {children}
    </section>
  );
}

/** Un tableau de section : une ligne par établissement, les chiffres alignés à droite. */
export function TableauSection({ colonnes, children }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[36rem] text-xs">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {colonnes.map((colonne, rang) => (
              <th key={colonne || rang} className={cn('py-2 pr-3 font-medium', rang > 0 && 'text-right')}>
                {colonne}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Un repère de légende, comme sous la trajectoire du directeur. */
export function Repere({ couleur, libelle, pointille = false }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-0 w-4 border-t-2"
        style={{ borderColor: couleur, borderStyle: pointille ? 'dashed' : 'solid' }}
      />
      {libelle}
    </span>
  );
}

export function InfoBulle({ active, payload, label, suffixe = ' %' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      {payload
        .filter((entree) => entree.value !== null && entree.value !== undefined)
        .map((entree) => (
          <p key={entree.dataKey} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: entree.color }} />
            <span className="text-muted-foreground">{entree.name} :</span>
            <span className="tabular-nums">
              {nombre(entree.value)}
              {suffixe}
            </span>
          </p>
        ))}
    </div>
  );
}

/** Une pastille de légende. */
export function Pastille({ couleur, libelle }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2 rounded-full" style={{ background: couleur }} />
      {libelle}
    </span>
  );
}

export function Jauge({ taux: valeurTaux, couleur, rougeAuDela, className }) {
  const teinte = couleur ?? (rougeAuDela !== undefined && valeurTaux > rougeAuDela ? 'bg-destructive' : 'bg-primary');
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)}>
      <div className={cn('h-full rounded-full', teinte)} style={{ width: `${Math.min(100, Math.max(0, valeurTaux ?? 0))}%` }} />
    </div>
  );
}

export const cellule = 'py-2.5 pr-3 text-right tabular-nums';

export const celluleNom = 'max-w-56 truncate py-2.5 pr-3 font-medium';

export const AXE = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };

/** Un taux recalculé sur des heures sommées — jamais une moyenne de taux. */
export const taux = (part, total) => (total > 0 ? Math.round((part / total) * 1000) / 10 : null);

/** « 12,5 % », ou un tiret quand rien n'est prévu — jamais « 0 % » inventé. */
export const pourcent = (valeur) => (valeur === null || valeur === undefined ? '—' : `${nombre(valeur)} %`);

/** La grille de tuiles des pages : quatre par rangée sur grand écran. */
export function GrilleTuiles({ children, colonnes = 4 }) {
  return (
    <section className={cn('grid gap-3 sm:grid-cols-2', colonnes === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4')}>
      {children}
    </section>
  );
}
