import { CircleCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Le schéma de liaison — des cartes reliées par un trait gris qui défile.
 * (demande du porteur, 2026-09-21 : le style d'un flux de travail, pour les espaces mutualisés puis
 * pour les formateurs mutualisés.) Extrait pour être partagé : une seule mise en page, un seul
 * alignement à tenir — voir `Flux`.
 */

/**
 * Une carte du schéma : une tuile d'icône, un titre gras, une ligne grise, un pied.
 *
 * ⚠️ LA TUILE EST CLAIRE POUR TOUTES LES CARTES (2026-09-21, demande du porteur : « annule le
 * fond noir pour l'espace ») : la même pour l'espace et pour l'établissement.
 */
export default function Noeud({ Icone, titre, sousTitre, pied, action, surClic, etiquette = 'Partagé' }) {
  const Racine = surClic ? 'button' : 'div';
  return (
    <div className="relative w-72 shrink-0 rounded-lg border bg-card shadow-sm">
      <Racine
        type={surClic ? 'button' : undefined}
        onClick={surClic}
        className={cn(
          'flex w-full items-center gap-3 p-3 text-left',
          surClic && 'rounded-lg transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background text-foreground">
          <Icone className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{titre}</span>
          <span className="block truncate text-xs text-muted-foreground">{sousTitre}</span>
        </span>
      </Racine>
      <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
        <span className="truncate text-xs text-muted-foreground">{pied}</span>
        <span className="flex shrink-0 items-center gap-1 rounded-md bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
          <CircleCheck className="size-3.5" />
          {etiquette}
        </span>
      </div>
      {action}
    </div>
  );
}

/** Un crochet, où s'accroche le trait : un point gris, au milieu exact du bord de la carte. */
const Crochet = ({ className }) => (
  <span
    className={cn(
      'absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-muted-foreground/70',
      className
    )}
  />
);

/**
 * Un espace à gauche, ses destinataires à droite, reliés par un trait gris qui défile.
 * Plusieurs destinataires : un tronc vertical les réunit, comme un flux qui se divise.
 *
 * ═══ ⚠️ L'ALIGNEMENT TIENT À UNE RÈGLE : TOUT SE CENTRE SUR LE MILIEU DE LA CARTE ═══
 * Les crochets et les traits partent de `top-1/2` avec le même décalage de moitié de leur
 * épaisseur (`-translate-y-1/2`) — pas de bordure pointillée, dont la position dépend de
 * l'arrondi du navigateur : le trait tombait un pixel sous les points.
 */
export function Flux({ gauche, droites }) {
  const n = droites.length;
  return (
    // `mx-auto w-fit` : centré quand il tient dans la fenêtre, calé à gauche (et défilable) sinon.
    <div className="mx-auto flex w-fit items-center py-1">
      <div className="relative">
        {gauche}
        <Crochet className="-right-[3px]" />
      </div>

      <div className="trait-route w-10 shrink-0" aria-hidden="true" />

      <ul className="relative flex shrink-0 flex-col">
        {droites.map((droite, i) => {
          // Le tronc s'éloigne du CENTRE de la colonne : ce qui est au-dessus monte, dessous descend.
          const sens = (position) => (position < n / 2 ? 'trait-route-haut' : 'trait-route-bas');
          return (
            <li key={droite.cle} className="relative py-1.5 pl-10">
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={cn('trait-route-v absolute left-0 top-0 h-1/2', sens(i + 0.25))}
                />
              )}
              {i < n - 1 && (
                <span
                  aria-hidden="true"
                  className={cn('trait-route-v absolute left-0 top-1/2 h-1/2', sens(i + 0.75))}
                />
              )}
              <span
                aria-hidden="true"
                className="trait-route absolute left-0 top-1/2 w-10 -translate-y-1/2"
              />
              <div className="relative">
                <Crochet className="-left-[3px]" />
                {droite.noeud}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
