import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Le cadre d'un panneau de droite « à la Notion » — pleine hauteur, en-tête de
 * 50 px, contenu défilant, et bord gauche REDIMENSIONNABLE (2026-09-28,
 * demande du porteur, infobulle de Notion à l'appui : « Close — Click ·
 * Resize — Drag »).
 *
 * ═══ LE BORD GAUCHE FAIT DEUX CHOSES, COMME CHEZ NOTION ═══
 * · le GLISSER redimensionne — entre 320 px et 60 % de la fenêtre ;
 * · un simple CLIC ferme. ⚠️ C'est le DÉPLACEMENT qui départage : sous 3 px,
 *   c'est un clic. Sans ce seuil, le moindre tremblement de la main pendant un
 *   clic redimensionnerait au lieu de fermer — et inversement.
 *
 * ⚠️ LA LARGEUR EST RETENUE PAR NAVIGATEUR (`localStorage`, clé par panneau) :
 *    une préférence de LECTURE, comme le zoom de la grille. Chaque accès est
 *    protégé — navigation privée ou stockage bloqué ne doivent jamais empêcher
 *    le panneau de s'ouvrir ; il reprend alors sa largeur par défaut.
 * ⚠️ AU CLAVIER AUSSI : le bord est un `separator` focalisable ; ← et →
 *    changent la largeur par pas de 16 px.
 */
const LARGEUR_MIN = 320;
const PART_MAX = 0.6;
const SEUIL_CLIC = 3;
const PAS_CLAVIER = 16;

const borner = (largeur) =>
  Math.round(Math.min(Math.max(largeur, LARGEUR_MIN), Math.max(LARGEUR_MIN, window.innerWidth * PART_MAX)));

function lire(cle, defaut) {
  try {
    const valeur = Number(window.localStorage.getItem(cle));
    return Number.isFinite(valeur) && valeur > 0 ? valeur : defaut;
  } catch {
    return defaut;
  }
}

function retenir(cle, largeur) {
  try {
    window.localStorage.setItem(cle, String(largeur));
  } catch {
    // Stockage indisponible : la largeur vaudra pour cette visite seulement.
  }
}

export default function CadrePanneauDroit({
  titre,
  icone: Icone,
  onFermer,
  cleLargeur,
  largeurParDefaut = 416,
  children,
}) {
  const [largeur, setLargeur] = useState(() => borner(lire(cleLargeur, largeurParDefaut)));
  const largeurCourante = useRef(largeur);
  largeurCourante.current = largeur;
  const glisse = useRef(null);

  // Une fenêtre qu'on rétrécit ne doit pas laisser le panneau dévorer la page.
  useEffect(() => {
    const ajuster = () => setLargeur((actuelle) => borner(actuelle));
    window.addEventListener('resize', ajuster);
    return () => window.removeEventListener('resize', ajuster);
  }, []);

  const changer = (nouvelle) => {
    const bornee = borner(nouvelle);
    setLargeur(bornee);
    return bornee;
  };

  const debuter = (evenement) => {
    if (evenement.button !== 0) return;
    evenement.preventDefault();
    evenement.currentTarget.setPointerCapture(evenement.pointerId);
    glisse.current = { depart: evenement.clientX, largeur: largeurCourante.current, bouge: false };
    // Pendant le glissement, le curseur ne doit pas redevenir une flèche au-dessus
    // de la grille, ni le texte de la page se sélectionner.
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const deplacer = (evenement) => {
    const g = glisse.current;
    if (!g) return;
    const ecart = g.depart - evenement.clientX;
    if (!g.bouge && Math.abs(ecart) < SEUIL_CLIC) return;
    g.bouge = true;
    changer(g.largeur + ecart);
  };

  const terminer = () => {
    const g = glisse.current;
    glisse.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (!g) return;
    if (!g.bouge) {
      onFermer?.();
      return;
    }
    retenir(cleLargeur, largeurCourante.current);
  };

  const auClavier = (evenement) => {
    const sens = { ArrowLeft: 1, ArrowRight: -1 }[evenement.key];
    if (!sens) return;
    evenement.preventDefault();
    retenir(cleLargeur, changer(largeurCourante.current + sens * PAS_CLAVIER));
  };

  return (
    <aside
      aria-label={titre}
      style={{ width: largeur }}
      className="relative flex h-svh shrink-0 flex-col border-l bg-background"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionner le panneau"
            aria-valuemin={LARGEUR_MIN}
            aria-valuenow={largeur}
            tabIndex={0}
            onPointerDown={debuter}
            onPointerMove={deplacer}
            onPointerUp={terminer}
            onPointerCancel={terminer}
            onKeyDown={auClavier}
            /* Une zone de saisie de 8 px, centrée sur le trait ; le liseré ne
               s'éclaire qu'au survol, comme chez Notion. */
            className="absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-primary/60 focus-visible:after:bg-primary"
          />
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          <span className="font-semibold">Fermer</span> clic ·{' '}
          <span className="font-semibold">Redimensionner</span> glisser
        </TooltipContent>
      </Tooltip>

      {/*
        50 px : la hauteur de l'en-tête de la coquille. ⚠️ SANS TRAIT DESSOUS
        (demande du porteur) : chez Notion l'en-tête du panneau se fond dans son
        contenu.
      */}
      <div className="flex h-[50px] shrink-0 items-center gap-2 px-4">
        {Icone && <Icone className="h-4 w-4 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{titre}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground"
          onClick={onFermer}
          aria-label="Fermer le panneau"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5">{children}</div>
    </aside>
  );
}
