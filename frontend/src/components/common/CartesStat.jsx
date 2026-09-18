import { cn } from '@/lib/utils';

/**
 * La bande de cartes chiffrées.
 * (demande du porteur, 2026-09-02 : « les cards groupés, pas d'espace entre
 * eux » — et le même dessin sur les deux pages.)
 *
 * ⚠️ REMONTÉE DE `features/admin/components/` VERS `components/common/`
 * (2026-09-05) : cinq écrans l'employaient déjà, dont TROIS hors de
 * l'administration (Calendrier national, Répartition, Réseau), qui l'importaient
 * par un chemin traversant — et le programme du stagiaire fait le sixième. Rien
 * ici ne connaît l'administration ; c'est le même déménagement que
 * `TableauTriable`, parti de la carte d'affectations pour la même raison.
 *
 * ═══ ⚠️ GROUPÉES, ELLES SE LISENT COMME UN SEUL RELEVÉ ═══
 * Espacées, quatre cartes bordées sont quatre objets qu'on compare un à un ;
 * réunies sous une seule bordure, elles forment un tableau de bord — et l'œil
 * parcourt une rangée au lieu de sauter d'une boîte à l'autre.
 *
 * ═══ ⚠️ `gap-px` SUR UN FOND DE BORDURE, PAS `divide-x` ═══
 * `divide-x` pose une bordure gauche sur tous les enfants sauf le premier, dans
 * l'ordre du FLUX : sur une grille qui passe à la ligne, le premier élément de
 * la seconde rangée en reçoit une — un trait vertical au bord gauche de la
 * bande — et les rangées, elles, ne sont pas séparées. Le fond de bordure avec
 * un interstice d'un pixel donne le bon quadrillage quel que soit le nombre de
 * colonnes.
 *
 * ⚠️ `overflow-hidden` EST INDISPENSABLE : sans lui, le fond de bordure déborde
 * des coins arrondis et dessine quatre petits angles gris.
 */
export function BandeCartes({ children, className }) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-4',
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * Une carte de la bande.
 *
 * ⚠️ ELLE NE PORTE NI BORDURE NI ARRONDI : c'est la bande qui les tient. Les
 * lui rendre dessinerait une boîte dans la boîte — le défaut déjà corrigé sur
 * le badge d'heures de la grille d'emploi du temps.
 *
 * ⚠️ `bg-card` EST CE QUI FAIT LES SÉPARATEURS : chaque carte masque le fond de
 * bordure, et il n'en reste que l'interstice d'un pixel. Une carte transparente
 * ferait un pavé gris.
 *
 * @param {node}   detail  Une seconde ligne, sous le libellé (répartition…).
 * @param {bool}   pulse   Point qui bat, pour une présence en cours.
 */
export function CarteStat({ Icone, libelle, valeur, teinte, fond, detail, pulse = false }) {
  return (
    <div className="flex items-center gap-3 bg-card p-4">
      <span
        aria-hidden="true"
        className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', fond)}
      >
        <Icone className={cn('size-5', teinte)} />
      </span>

      {/* `min-w-0` : un libellé long doit pouvoir se replier plutôt qu'élargir
          sa colonne de grille. */}
      <div className="min-w-0">
        <p className="flex items-center gap-2">
          <span className={cn('text-2xl font-bold leading-none tabular-nums', teinte)}>
            {valeur}
          </span>
          {pulse && (
            <span className="relative flex size-2.5" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-success" />
            </span>
          )}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{libelle}</p>
        {detail && <p className="mt-0.5 text-xs">{detail}</p>}
      </div>
    </div>
  );
}
