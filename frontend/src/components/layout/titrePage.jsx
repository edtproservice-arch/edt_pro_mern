import { createContext, useContext } from 'react';

/**
 * La coquille a-t-elle un fil d'Ariane pour titrer la page ? (Phase 5bis,
 * étape d2 bis.)
 *
 * ⚠️ UN CONTEXTE POSÉ PAR LA COQUILLE, pas deviné par la page : c'est elle qui
 * sait si un fil d'Ariane surmonte le contenu. La session formateur n'en a pas —
 * une page partagée y rend donc son propre titre (`titreDePage`).
 */
const ContexteSansFilAriane = createContext(false);

export const FournirSansFilAriane = ContexteSansFilAriane.Provider;

export function useSansFilAriane() {
  return useContext(ContexteSansFilAriane);
}
