import { Ban, CircleCheck, CircleX, Clock, Trash2 } from 'lucide-react';
import { STATUTS_COMPTE } from 'shared/constants';

/**
 * Apparence d'un statut de compte — définie une seule fois.
 *
 * `secondary` (indigo profond) est volontairement absent : la charte le réserve
 * à un seul accent par page, or un badge se répète sur chaque ligne. Les statuts
 * neutres passent en `outline`, et c'est l'icône qui les distingue.
 */
export const APPARENCE_STATUT = {
  [STATUTS_COMPTE.EN_ATTENTE]: {
    libelle: 'En attente',
    variant: 'outline',
    Icone: Clock,
    couleur: 'text-accent-orange',
  },
  [STATUTS_COMPTE.APPROUVE]: {
    libelle: 'Approuvé',
    variant: 'outline',
    Icone: CircleCheck,
    couleur: 'text-success',
  },
  [STATUTS_COMPTE.REJETE]: {
    libelle: 'Rejeté',
    variant: 'outline',
    Icone: CircleX,
    couleur: 'text-destructive',
  },
  [STATUTS_COMPTE.BLOQUE]: {
    libelle: 'Bloqué',
    variant: 'outline',
    Icone: Ban,
    couleur: 'text-destructive',
  },
  [STATUTS_COMPTE.SUPPRIME]: {
    libelle: 'Supprimé',
    variant: 'outline',
    Icone: Trash2,
    couleur: 'text-muted-foreground',
  },
};

export function apparenceStatut(statut) {
  return (
    APPARENCE_STATUT[statut] ?? {
      libelle: statut,
      variant: 'outline',
      Icone: Clock,
      couleur: 'text-muted-foreground',
    }
  );
}

/** Date courte, ou tiret cadratin si la valeur est absente. */
export function formaterDate(valeur) {
  if (!valeur) return '—';
  return new Date(valeur).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
