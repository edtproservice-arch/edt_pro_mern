import { ClipboardPaste, Copy, Redo2, Scissors, Trash2, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';

/**
 * Les actions d'édition, dans une barre flottante en pied d'écran.
 * ← `setupActionToolbar()` de emploi.html
 *
 * ═══ ⚠️ POURQUOI FLOTTANTE, ET PLUS UN MENU ═══
 * Repliées dans un menu, ces actions demandaient DEUX gestes : ouvrir, puis
 * choisir — pour des commandes qu'on enchaîne par rafales sur une sélection
 * qu'on vient à peine de tracer. Et le menu se referme à chaque choix, donc il
 * fallait le rouvrir pour la suivante.
 *
 * Flottante, la barre est à un geste, et surtout elle apparaît PRÈS DE LA MAIN —
 * en bas, là où le regard se trouve après un glissement dans la grille, et non
 * en haut d'une page qu'il faut remonter.
 *
 * ═══ ELLE NE S'AFFICHE QUE QUAND ELLE SERT ═══
 * Tant que rien n'est sélectionné, rien n'a été copié et rien n'est à défaire,
 * aucun de ses boutons ne peut agir : une barre permanente n'afficherait que des
 * commandes éteintes, en travers de la grille.
 */
export default function BarreFlottante({
  selection,
  pressePapiers,
  historique,
  enCours,
  onCopier,
  onCouper,
  onColler,
  onVider,
  onDefaire,
  onRefaire,
  onEffacerSelection,
}) {
  const rien = selection.size === 0;
  const visible = !rien || Boolean(pressePapiers) || historique.passe.length > 0;

  if (!visible) return null;

  return (
    <div
      /*
       * ⚠️ `pointer-events-none` SUR L'ENVELOPPE, rétabli sur la barre. Sans
       * cela, la bande transparente pleine largeur intercepterait les clics sur
       * les dernières lignes de la grille — un formateur deviendrait
       * inaccessible sans que rien ne l'explique.
       */
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-4"
    >
      <div
        role="toolbar"
        aria-label="Actions sur la sélection"
        className={cn(
          'pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border bg-card p-1.5',
          'shadow-lg shadow-black/5'
        )}
      >
        <span className="px-2 text-xs tabular-nums text-muted-foreground">
          {rien ? 'Aucune case' : `${selection.size} case(s)`}
        </span>

        <span className="mx-0.5 h-6 w-px bg-border" />

        <Action
          icone={Copy}
          libelle="Copier"
          touches={['Ctrl', 'C']}
          disabled={rien}
          aide="Sélectionnez d’abord des cases"
          onClick={onCopier}
        />
        <Action
          icone={Scissors}
          libelle="Couper"
          touches={['Ctrl', 'X']}
          disabled={rien || enCours}
          aide="Sélectionnez d’abord des cases"
          onClick={onCouper}
        />
        <Action
          icone={ClipboardPaste}
          libelle="Coller"
          touches={['Ctrl', 'V']}
          disabled={!pressePapiers || rien || enCours}
          aide={!pressePapiers ? 'Rien dans le presse-papiers' : 'Choisissez la case de destination'}
          onClick={onColler}
        />

        <span className="mx-0.5 h-6 w-px bg-border" />

        <Action
          icone={Undo2}
          libelle="Défaire"
          touches={['Ctrl', 'Z']}
          disabled={historique.passe.length === 0 || enCours}
          aide="Rien à défaire"
          onClick={onDefaire}
        />
        <Action
          icone={Redo2}
          libelle="Refaire"
          touches={['Ctrl', 'Y']}
          disabled={historique.futur.length === 0 || enCours}
          aide="Rien à refaire"
          onClick={onRefaire}
        />

        <span className="mx-0.5 h-6 w-px bg-border" />

        {/* Le VIDAGE est le seul geste destructeur : il se tient à l'écart des
            autres, derrière un séparateur, et porte le rouge. */}
        <Action
          icone={Trash2}
          libelle="Vider"
          touches={['Suppr']}
          disabled={rien || enCours}
          aide="Sélectionnez d’abord des cases"
          onClick={onVider}
          destructif
        />

        {!rien && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title="Annuler la sélection (Échap)"
            onClick={onEffacerSelection}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function Action({ icone: Icone, libelle, touches, disabled, aide, onClick, destructif }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? aide : `${libelle} (${touches.join('+')})`}
      className={cn(
        'h-8 gap-1.5 text-xs',
        destructif &&
          'text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/30'
      )}
    >
      <Icone className="size-3.5" />
      {libelle}
      {/* Les touches disparaissent sur écran étroit : la barre doit tenir sur
          une ligne, sinon elle mange la grille qu'elle sert. */}
      <KbdGroup className="hidden lg:inline-flex">
        {touches.map((touche) => (
          <Kbd key={touche}>{touche}</Kbd>
        ))}
      </KbdGroup>
    </Button>
  );
}
