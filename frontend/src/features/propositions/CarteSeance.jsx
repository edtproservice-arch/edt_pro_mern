import { TYPES_COURS } from 'shared/constants';
import { typeDeSeance } from 'shared/domain';
import { FOND_SYNCHRONE } from '@/components/common/apparenceGrille';
import { cn } from '@/lib/utils';

/**
 * Une séance d'une proposition : groupe, module, espace.
 *
 * ⚠️ LA MÊME CHEZ LE FORMATEUR ET CHEZ LE DIRECTEUR (demande du porteur,
 * 2026-09-23 : « met le tableau du directeur comme celui du formateur »). Deux
 * rendus de la même séance auraient fini par diverger.
 */
export const CLASSE_DISTANCE = cn(FOND_SYNCHRONE, 'border-accent-purple text-accent-purple-deep');

/** Le violet de la grille Emploi pour une séance à distance (TEAMS). */
export const estADistance = (seance) => typeDeSeance(seance) === TYPES_COURS.SYNCHRONE;

export default function CarteSeance({ seance, className, indisponible, children, ...props }) {
  return (
    <div
      {...props}
      className={cn('relative flex h-full flex-col rounded-md border bg-background p-1.5 text-left', className)}
    >
      {children}
      <span className="truncate font-semibold">{seance.groupe}</span>
      <span className="truncate opacity-80">{seance.module}</span>
      <span className="mt-auto truncate opacity-70">{seance.salle}</span>
      {/* Une séance posée garde la couleur de sa nature : c'est la mention qui avertit. */}
      {indisponible && <MentionIndisponible />}
    </div>
  );
}

export const MentionIndisponible = () => (
  <span className="truncate text-[10px] font-semibold text-destructive">Indisponibilité</span>
);
