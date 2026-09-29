import { useEffect, useRef } from 'react';
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
 *    garde l'ouverture automatique.
 */
export default function BoutonCompletude({ semaine, ouvert = false, onOuvrir }) {
  const bilan = useBilanCompletude(semaine);

  /*
   * ═══ ⚠️ LE RAPPORT S'OUVRE DE LUI-MÊME, UNE FOIS PAR SEMAINE ═══
   * Le bilan se recalcule après chaque enregistrement. Sans mémoire de la
   * dernière semaine VUE, le panneau se rouvrirait à chaque sauvegarde de la
   * même semaine — y compris à l'instant où l'on vient de le fermer, ce qui le
   * rendrait impossible à écarter.
   *
   * ⚠️ LE REPÈRE SUIT LA DERNIÈRE SEMAINE VUE, conforme ou non. S'il ne
   *    retenait que les semaines ANNONCÉES, revenir sur une semaine incomplète
   *    après un détour par une semaine conforme ne la rouvrirait pas.
   */
  const derniereVue = useRef(null);

  useEffect(() => {
    const donnees = bilan.data;
    if (!donnees) return;

    const aChange = derniereVue.current !== donnees.semaine;
    derniereVue.current = donnees.semaine;
    if (!aChange) return;

    if (!donnees.planifie) return;
    if (donnees.total.taux === null || donnees.total.taux >= 100) return;

    onOuvrir?.(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une fois par semaine, pas à chaque rendu
  }, [bilan.data]);

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
