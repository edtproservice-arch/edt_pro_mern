import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupText } from '@/components/ui/button-group';

/**
 * Les quatre commandes de zoom d'une grille — réduire, la valeur, agrandir,
 * revenir à 100 %.
 *
 * ═══ ⚠️ UNE DÉFINITION, PLUS UNE PAR ÉCRAN ═══
 * Elles vivaient recopiées dans `MenuGrille` (emploi) et dans
 * `NavigationSemaines` (chronogramme) ; la page Édition en aurait fait une
 * TROISIÈME — exactement la cause n°1 d'instabilité du §4.2, appliquée à une
 * barre d'outils. Un réglage qui se retrouve au même endroit, sous la même
 * forme, ne se réapprend pas d'un écran à l'autre.
 *
 * ⚠️ LA COPIE DU CHRONOGRAMME N'EST PAS REPRISE ICI : son quatrième bouton
 * AJUSTE la grille à la largeur disponible au lieu de revenir à 100 %, et il
 * mesure le conteneur pour cela. Elle porte aussi encore le défaut de mise à
 * jour non fonctionnelle corrigé ci-dessous. À rapprocher quand ce bouton sera
 * tranché — pas au détour d'une demande qui ne le concerne pas.
 */

/** Mêmes paliers partout — `ZOOMS` de `NavigationSemaines`. */
export const ZOOMS = [50, 60, 70, 80, 90, 100, 110, 125, 150];

/**
 * ⚠️ LE PALIER SE CALCULE À PARTIR DE LA VALEUR COURANTE, pas de celle du rendu.
 * Deux clics rapprochés lisaient le MÊME `zoom` périmé et n'avançaient que d'un
 * cran — constaté en enchaînant deux clics dans la même tranche d'exécution.
 * Une mise à jour fonctionnelle règle le cas quelle que soit la vitesse.
 */
export const palier = (pas) => (courant) => {
  const rang = ZOOMS.indexOf(courant);
  return ZOOMS[Math.min(Math.max(rang + pas, 0), ZOOMS.length - 1)] ?? courant;
};

/**
 * ═══ ⚠️ LE ZOOM RESTE SOUDÉ — ET LUI SEUL ═══
 * (2026-08-26, décision du porteur après deux passes.)
 *
 * Ses quatre commandes règlent UNE seule chose, et l'une d'elles n'est même pas
 * un bouton : le bloc soudé les donne à lire comme un instrument unique, avec sa
 * valeur au milieu. C'est le seul endroit de ces barres où le groupe se
 * justifie sans être un choix exclusif.
 *
 * Autour, « Activer », « Réinitialiser » et « Imprimer » restent des boutons
 * SÉPARÉS : ce sont des actions indépendantes, et les souder au zoom laissait
 * croire à un choix qu'on ferait entre elles.
 *
 * ═══ ⚠️ NE JAMAIS LE POSER DANS UN AUTRE `ButtonGroup` ═══
 * C'est le défaut qu'a vu le porteur, et il est silencieux : imbriqué, ce groupe
 * déclenche `has-[>[data-slot=button-group]]:gap-2` — 8 px d'écart — pendant que
 * `[&>*:not(:first-child)]:border-l-0` continue de retirer la bordure gauche des
 * boutons SUIVANTS. Écart plus bordure retirée, ils apparaissent ouverts d'un
 * côté. Les appelants l'entourent donc d'un simple `div` en `flex`.
 */
export default function CommandesZoom({ zoom, onZoom }) {
  const rang = ZOOMS.indexOf(zoom);

  return (
    <ButtonGroup>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        title="Réduire la grille"
        disabled={rang <= 0}
        onClick={() => onZoom(palier(-1))}
      >
        <ZoomOut className="size-3.5" />
      </Button>

      {/* ⚠️ `whitespace-nowrap` et assez large : à 3,5 rem, « 100 » et « % »
          passaient sur deux lignes et le bloc doublait de hauteur. */}
      <ButtonGroupText className="h-8 min-w-[3.75rem] justify-center whitespace-nowrap px-2 text-xs tabular-nums">
        {zoom} %
      </ButtonGroupText>

      <Button
        variant="outline"
        size="icon"
        className="size-8"
        title="Agrandir la grille"
        disabled={rang >= ZOOMS.length - 1}
        onClick={() => onZoom(palier(1))}
      >
        <ZoomIn className="size-3.5" />
      </Button>

      <Button
        variant="outline"
        size="icon"
        className="size-8"
        title="Revenir à la taille normale"
        disabled={zoom === 100}
        onClick={() => onZoom(100)}
      >
        <Maximize2 className="size-3.5" />
      </Button>
    </ButtonGroup>
  );
}
