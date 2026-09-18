import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Fusionne des classes Tailwind sans conflit. Utilisé par tous les composants shadcn. */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
