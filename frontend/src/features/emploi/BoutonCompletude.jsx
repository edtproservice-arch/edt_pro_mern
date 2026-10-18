import { ClipboardCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { couleurCompletude } from './completudeApparence';
import { useBilanCompletude } from './useBilanCompletude';

/**
 * Le taux de conformité de la semaine — l'interrupteur du panneau de rapport.
 * ← `completudeBtn` + `chargerCompletude()` de emploi.html
 *
 * ⚠️ SANS CHRONOGRAMME PLANIFIÉ, LE BOUTON NE S'AFFICHE PAS. Il n'y a rien à
 *    quoi comparer : montrer « 0 % » à un établissement qui n'a simplement rien
 *    planifié ferait chercher un retard qui n'existe pas.
 *
 * ⚠️ LE BOUTON N'AFFICHE PLUS LE RAPPORT LUI-MÊME (2026-09-28, demande du
 *    porteur : « panneau à droite, décale la grille ») : le rapport est une
 *    colonne À DROITE DE LA GRILLE, qu'il fait rétrécir — c'est donc la page
 *    qui le dispose et qui tient son état. Le bouton l'ouvre ou le ferme, et
 *    ne l'ouvre plus de lui-même (2026-10-18).
 */
export default function BoutonCompletude({ semaine, ouvert = false, onOuvrir }) {
  const bilan = useBilanCompletude(semaine);

  /*
   * ⚠️ PLUS D'OUVERTURE AUTOMATIQUE (2026-10-18, demande du porteur : « le
   * rapport masqué par défaut ») : il s'ouvrait de lui-même, une fois par
   * semaine, dès que le taux passait sous 100 %. C'est désormais ce bouton seul
   * qui l'ouvre — la couleur du taux suffit à signaler l'écart. (Le lien
   * `?rapport=1` de « À traiter » l'ouvre toujours : c'est une demande explicite.)
   */
  /* Rien à comparer, ou lecture impossible : pas d'indicateur du tout. */
  if (!bilan.data?.planifie) return null;

  const { total } = bilan.data;
  const couleur = couleurCompletude(total.taux);

  const details = [];
  if (total.manquant > 0) details.push(`${total.manquant} h manquantes`);
  if (total.enTrop > 0) details.push(`${total.enTrop} h hors plan`);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => onOuvrir?.(!ouvert)}
      aria-pressed={ouvert}
      /* Repère du clic extérieur de `PageEmploi` : ce clic-ci bascule déjà le panneau. */
      data-bouton-completude
      /* La couleur porte le message : on doit voir l'état sans lire le chiffre. */
      className={cn('gap-2', couleur.fond, couleur.texte, ouvert && 'ring-1 ring-inset ring-current')}
      title={
        details.length === 0
          ? 'La semaine est conforme au chronogramme'
          : `Écart au chronogramme : ${details.join(' et ')}`
      }
    >
      <ClipboardCheck className="h-4 w-4" />
      <span className="font-semibold tabular-nums">
        {total.taux === null ? '—' : `${total.taux} %`}
      </span>
    </Button>
  );
}
