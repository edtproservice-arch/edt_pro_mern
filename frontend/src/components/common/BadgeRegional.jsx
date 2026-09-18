import { Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/**
 * Le statut d'un module — EFM RÉGIONAL ou LOCAL — en pastille bordée.
 *
 * ═══ ⚠️ EXTRAIT DE `GrilleAffectations`, PAS RECOPIÉ ═══ (2026-09-05, demande
 * du porteur : « je veux que le badge régional soit comme celui dans l'image ».)
 * La carte d'affectations posait déjà exactement cette pastille ; le programme
 * du stagiaire en faisait la seconde. Deux copies d'un même badge, c'est le
 * §4.2 du plan — et c'est ainsi que `BadgeSemestre` avait fini en TROIS
 * exemplaires divergents avant d'être extrait.
 *
 * ⚠️ CE N'EST PAS LA SEULE FORME DE CE REPÈRE, ET C'EST VOULU. Dans une GRILLE
 * — emploi du temps, chronogramme, avancement — il ne reste que l'ÉTOILE, sans
 * texte ni cadre : une case de 34 px n'a pas la place d'écrire « EFM régional ».
 * Les deux formes disent la même chose au même endroit du vocabulaire (étoile
 * pleine, ambre `warning`) ; seule la place disponible les sépare.
 *
 * ⚠️ « LOCAL » PORTE LE MÊME CADRE (demande du porteur : « faire le même style
 * pour local ») : dans une colonne « Statut », les deux valeurs sont de même
 * nature — l'une ne peut pas être une pastille et l'autre un mot nu, sans quoi
 * la colonne se lit comme si seule la première portait une information.
 * L'étoile et la couleur suffisent à les distinguer.
 */
export default function BadgeRegional({ estRegional }) {
  if (!estRegional) {
    return (
      <Badge variant="outline" className="font-normal text-muted-foreground">
        Local
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="gap-1 whitespace-nowrap font-normal">
      {/*
        Étoile PLEINE et jaune : un EFM régional est imposé par la région, il ne
        se réaménage pas comme un module local. Le texte seul se noyait dans une
        ligne qui porte déjà le code, l'intitulé et les heures.
      */}
      <Star className="h-3 w-3 fill-warning text-warning" />
      EFM régional
    </Badge>
  );
}
