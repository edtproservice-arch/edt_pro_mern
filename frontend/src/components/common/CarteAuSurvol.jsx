import { useEffect, useRef, useState } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';

/**
 * Une carte au survol qui NE MONTE RIEN tant qu'on ne la survole pas.
 *
 * ═══ ⚠️ AUCUN COMPOSANT RADIX AU REPOS ═══
 * Les grilles de ce projet comptent 765 à 1 224 cellules. Monter une
 * `HoverCard` dans chacune, c'est exactement ce qui avait figé la page
 * Affectations — 780 listes, 15 900 nœuds, mesurés. Au repos, cette enveloppe
 * n'est qu'un `span` porteur d'un `onMouseEnter` ; la `HoverCard` ne se monte
 * que sur la case réellement survolée, DÉJÀ OUVERTE, et Radix reprend la main
 * pour la fermer — lui seul sait distinguer « la souris part » de « la souris
 * entre dans la carte ».
 *
 * ⚠️ L'ÉTAT EST LOCAL À LA CASE, jamais remonté à la grille : une variable de
 * survol dans le composant parent ferait re-rendre toutes les cellules à chaque
 * déplacement de souris.
 *
 * ⚠️ `contenu` EST UNE FONCTION, pas un élément. Passer le JSX construit
 * ferait faire le travail pour les centaines de cases qu'on ne survolera
 * jamais — l'inverse de ce que ce composant cherche.
 *
 * Extraite le 2026-08-26 de `features/emploi/CarteVerrou`, qui la portait déjà,
 * quand le chronogramme en a eu besoin à son tour.
 */
export default function CarteAuSurvol({
  actif = true,
  enveloppe = 'block w-full',
  align = 'start',
  largeur = 'w-64',
  contenu,
  children,
}) {
  const [ouvert, setOuvert] = useState(false);
  const minuterie = useRef(null);

  /*
   * ⚠️ UN DÉLAI AVANT D'OUVRIR. Sans lui, traverser une ligne de la grille
   * ferait clignoter une carte qu'on ne cherchait pas à lire — et, quand elle
   * charge des données, partirait une requête par case franchie.
   */
  const armer = () => {
    clearTimeout(minuterie.current);
    minuterie.current = setTimeout(() => setOuvert(true), DELAI_SURVOL);
  };
  const desarmer = () => clearTimeout(minuterie.current);

  useEffect(() => () => clearTimeout(minuterie.current), []);

  if (!actif) return children;

  if (!ouvert) {
    return (
      <span className={enveloppe} onMouseEnter={armer} onMouseLeave={desarmer}>
        {children}
      </span>
    );
  }

  return (
    <HoverCard open openDelay={0} closeDelay={120} onOpenChange={setOuvert}>
      <HoverCardTrigger asChild>
        <span className={enveloppe}>{children}</span>
      </HoverCardTrigger>

      <HoverCardContent align={align} className={`${largeur} p-3 text-xs`}>
        {contenu()}
      </HoverCardContent>
    </HoverCard>
  );
}

/** Assez long pour traverser une ligne sans rien déclencher. */
export const DELAI_SURVOL = 320;
