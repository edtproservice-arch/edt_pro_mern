import { Check, Circle } from 'lucide-react';
import { REGLES_MOT_DE_PASSE } from 'shared/schemas';
import { cn } from '@/lib/utils';

/**
 * Conditions du mot de passe, cochées à la frappe.
 *
 * ═══ POURQUOI LES MONTRER TOUTES, ET TOUT DE SUITE ═══
 * Une phrase d'aide — « 8 caractères, une majuscule, une minuscule, un
 * chiffre » — se lit une fois et ne dit jamais laquelle manque. On tape, le
 * bouton reste éteint, et rien n'explique pourquoi. Ici chaque condition
 * s'allume dès qu'elle est remplie : ce qui bloque se voit.
 *
 * ⚠️ La liste vient de `shared/src/schemas/auth.js`, d'où le schéma Zod est
 * lui-même construit. Ce composant ne peut donc pas annoncer une règle que le
 * serveur n'applique pas, ni taire celle qui fera échouer l'envoi.
 */
export default function ReglesMotDePasse({ valeur = '', className }) {
  const saisi = String(valeur);

  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1', className)}>
      {REGLES_MOT_DE_PASSE.map((regle) => {
        const remplie = regle.satisfaite(saisi);

        return (
          <li
            key={regle.cle}
            className={cn(
              'flex items-center gap-1.5 text-xs transition-colors',
              remplie ? 'text-success' : 'text-muted-foreground'
            )}
          >
            {/*
              Deux icônes distinctes, et pas seulement deux couleurs : la
              différence doit rester lisible sans percevoir le vert.
            */}
            {remplie ? (
              <Check className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <Circle className="h-3 w-3 shrink-0" />
            )}
            {regle.libelle}
          </li>
        );
      })}
    </ul>
  );
}
