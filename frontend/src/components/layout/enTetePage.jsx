import { createContext, useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

/**
 * Un emplacement de la barre du HAUT que la PAGE peut remplir.
 * (2026-09-12, demande du porteur : « le bouton Partager en haut, dans la
 * barre, comme dans Notion ».)
 *
 * ═══ POURQUOI UN PORTAIL ═══
 * La barre appartient à la COQUILLE, montée une fois autour de toutes les pages ;
 * « Partager » et la pile d'avatars appartiennent à UNE page — elle seule sait
 * quelle salle elle a rejointe, quelle semaine elle montre, qui est directeur.
 * Remonter tout cela dans la coquille l'aurait rendue dépendante de chaque page ;
 * la page, elle, n'a qu'à rendre ses éléments DANS cet emplacement.
 *
 * ⚠️ UNE SEULE PAGE À LA FOIS : c'est `Outlet` qui la monte, et elle vide
 * l'emplacement en se démontant — le portail disparaît avec elle.
 *
 * ⚠️ HORS D'UNE COQUILLE (espace admin, configuration), le contexte est absent :
 * l'emplacement ne se rend pas et le portail non plus, sans erreur.
 */
const ContexteEnTete = createContext(null);

export function FournirEnTetePage({ children }) {
  const [noeud, setNoeud] = useState(null);
  return <ContexteEnTete.Provider value={{ noeud, setNoeud }}>{children}</ContexteEnTete.Provider>;
}

/** Posé par la barre, là où les éléments de la page doivent apparaître. */
export function EmplacementEnTete({ className }) {
  const contexte = useContext(ContexteEnTete);
  if (!contexte) return null;
  // `empty:hidden` : sans rien dedans, l'emplacement ne réserve aucun espace.
  return <div ref={contexte.setNoeud} className={cn('flex items-center gap-2 empty:hidden', className)} />;
}

/** Rendu par la page : ses enfants apparaissent dans la barre du haut. */
export function PortailEnTete({ children }) {
  const contexte = useContext(ContexteEnTete);
  if (!contexte?.noeud) return null;
  return createPortal(children, contexte.noeud);
}
