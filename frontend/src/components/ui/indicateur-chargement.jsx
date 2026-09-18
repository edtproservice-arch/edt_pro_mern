import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Indicateur unique pour tous les chargements asynchrones de l'application. */
export default function IndicateurChargement({ className, label = 'Chargement' }) {
  return (
    <Loader2
      role="status"
      aria-label={label}
      className={cn('size-6 animate-spin text-primary', className)}
    />
  );
}
