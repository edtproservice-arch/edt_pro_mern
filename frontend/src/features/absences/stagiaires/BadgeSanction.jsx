import { cn } from '@/lib/utils';

/**
 * La sanction de la grille de discipline, avec l'autorité qui la prononce.
 *
 * ⚠️ QUATRE GRAVITÉS, QUATRE TEINTES, dans l'ordre de la grille — la couleur se
 * lit sur `niveau`, jamais sur le libellé : deux libellés (« Blâme » d'assiduité
 * et de comportement) partagent la même gravité.
 * ⚠️ L'EXCLUSION EST LE SEUL APLAT PLEIN : c'est le seul cas qui passe devant
 * le Conseil de discipline pour une décision grave, il doit se voir d'abord.
 * ⚠️ `accent-orange-deep` pour le texte : l'ambre `warning` (L 50 %) tombe à
 * ~2:1 en lettres sur son propre aplat (piège déjà consigné sur l'agenda).
 * Classes LITTÉRALES : Tailwind ne compose pas un nom de classe à l'exécution.
 */
const TEINTES = {
  'mise-en-garde': 'border-warning/50 bg-warning/10 text-accent-orange-deep',
  avertissement: 'border-accent-orange/50 bg-accent-orange/15 text-accent-orange-deep',
  blame: 'border-destructive/40 bg-destructive/10 text-destructive',
  exclusion: 'border-destructive bg-destructive text-white',
};

export default function BadgeSanction({ sanction, avecAutorite = true, className }) {
  if (!sanction) return <span className="text-xs text-muted-foreground">—</span>;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-left text-[0.7rem] font-medium leading-tight',
        TEINTES[sanction.niveau],
        className
      )}
    >
      {sanction.libelle}
      {avecAutorite && <span className="shrink-0 font-semibold opacity-75">· {sanction.autorite}</span>}
    </span>
  );
}
