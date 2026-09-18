import { droitSuffit } from 'shared/domain';
import { usePartagesAvecMoi } from './usePartagesAvecMoi';

/**
 * Le droit de la personne connectée sur une page, et ce qu'il permet à l'écran
 * (Phase 5bis, étape d3).
 *
 * ⚠️ `lectureSeule` N'EST PAS UNE SÉCURITÉ : le serveur refuse déjà l'écriture
 * (`exigerDroitPage`). Il évite l'écran qui laisse saisir pour échouer ensuite —
 * une saisie perdue, et un message d'erreur là où il aurait suffi de ne rien
 * proposer.
 */
export function useDroitPage(page) {
  const { droitSur } = usePartagesAvecMoi();
  const droit = droitSur(page);
  return { droit, lectureSeule: !droitSuffit(droit, 'modifier') };
}
