import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { grouperPages } from 'shared/domain';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/*
 * Délais du survol. À l'ouverture : traverser la barre en passant sur
 * « Partagé » ne doit pas déplier la carte. À la fermeture : le pointeur franchit
 * l'écart entre le déclencheur et la carte sans la refermer en chemin.
 */
const DELAI_OUVERTURE_MS = 120;
const DELAI_FERMETURE_MS = 200;

/*
 * ⚠️ DES CLASSES LITTÉRALES : Tailwind lit les classes dans le source, un nom
 * composé à l'exécution (`lg:grid-cols-${n}`) ne serait jamais généré.
 * Une colonne sur téléphone, deux sur tablette, toutes sur grand écran.
 */
const COLONNES = {
  1: '',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
  5: 'sm:grid-cols-2 lg:grid-cols-5',
};

/**
 * La carte « Partagé » — les pages que le directeur a partagées, rangées en
 * colonnes, qui s'ouvre au SURVOL (2026-09-12, demande du porteur, capture d'un
 * méga-menu à l'appui). Une seule carte pour les deux emplacements : la barre du
 * formateur (`side="bottom"`) et la barre latérale du gestionnaire
 * (`side="right"`) — deux versions auraient fini par ranger les pages autrement.
 *
 * ═══ ⚠️ UN POPOVER PILOTÉ, PAS UNE `HoverCard` DE RADIX ═══
 * La `HoverCard` est faite pour un aperçu qu'on LIT : son contenu est hors de
 * l'ordre de tabulation, et un clavier n'atteindrait jamais les liens. Ici la
 * carte est un MENU. Elle s'ouvre donc au survol pour la souris, ET au clic ou à
 * Entrée pour le clavier et le tactile — et dans ce cas le focus y entre.
 *
 * ⚠️ OUVERTE PAR LE SURVOL, ELLE NE PREND PAS LE FOCUS : passer la souris sur la
 * barre ne doit pas arracher le curseur d'un champ en cours de saisie.
 *
 * ⚠️ UN CLIC SUR LE DÉCLENCHEUR DÉJÀ OUVERT PAR LE SURVOL NE LA REFERME PAS : le
 * geste naturel est de survoler PUIS de cliquer, et Radix basculerait l'état.
 *
 * ⚠️ LE TACTILE N'A PAS DE SURVOL : seul un pointeur `mouse` (ou stylet) arme les
 * minuteries — sur un téléphone, `pointerenter` précède le clic, et la carte
 * s'ouvrirait puis se refermerait aussitôt.
 *
 * @param {{
 *   entree: { titre: string, sousMenu: { titre, url, page, droit, icone }[] },
 *   children: React.ReactElement,   le déclencheur (transmet ref et props)
 *   side?: 'bottom' | 'right',
 *   align?: 'start' | 'center' | 'end',
 *   onNavigation?: () => void,
 * }} props
 */
export default function CartePagesPartagees({ entree, children, side = 'bottom', align = 'center', onNavigation }) {
  const [ouvert, setOuvert] = useState(false);
  const minuteur = useRef(null);
  // Qui l'a ouverte : « survol » ne prend pas le focus, « clic » si.
  const ouvertePar = useRef(null);

  useEffect(() => () => clearTimeout(minuteur.current), []);

  const survol = (evenement) => evenement.pointerType === 'mouse' || evenement.pointerType === 'pen';

  const entrer = (evenement) => {
    if (!survol(evenement)) return;
    clearTimeout(minuteur.current);
    if (ouvert) return;
    minuteur.current = setTimeout(() => {
      ouvertePar.current = 'survol';
      setOuvert(true);
    }, DELAI_OUVERTURE_MS);
  };

  const sortir = (evenement) => {
    if (!survol(evenement)) return;
    clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => setOuvert(false), DELAI_FERMETURE_MS);
  };

  const fermer = () => {
    clearTimeout(minuteur.current);
    setOuvert(false);
    onNavigation?.();
  };

  return (
    <Popover
      open={ouvert}
      onOpenChange={(suivant) => {
        clearTimeout(minuteur.current);
        if (suivant) ouvertePar.current = 'clic';
        setOuvert(suivant);
      }}
    >
      <PopoverTrigger
        asChild
        onPointerEnter={entrer}
        onPointerLeave={sortir}
        onClick={(evenement) => {
          // Déjà ouverte par le survol : le clic la GARDE ouverte au lieu de la
          // basculer (Radix n'agit pas sur un événement dont on a empêché l'effet).
          if (ouvert && ouvertePar.current === 'survol') {
            evenement.preventDefault();
            ouvertePar.current = 'clic';
          }
        }}
      >
        {children}
      </PopoverTrigger>

      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        collisionPadding={16}
        onPointerEnter={entrer}
        onPointerLeave={sortir}
        onOpenAutoFocus={(evenement) => {
          if (ouvertePar.current === 'survol') evenement.preventDefault();
        }}
        onCloseAutoFocus={(evenement) => {
          if (ouvertePar.current === 'survol') evenement.preventDefault();
        }}
        aria-label={`${entree.titre} — pages partagées avec vous`}
        className="w-auto max-w-[calc(100vw-2rem)] p-0"
      >
        <ColonnesPagesPartagees pages={entree.sousMenu} onNavigation={fermer} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Les colonnes elles-mêmes — rendues par la carte ET, dépliées, par le panneau
 * mobile du formateur : un téléphone n'a pas de survol, et la carte y serait un
 * geste de plus pour des liens qui tiennent tous à l'écran.
 */
export function ColonnesPagesPartagees({ pages, onNavigation, panneau = false }) {
  const { pathname } = useLocation();
  const colonnes = grouperPages(pages);

  if (panneau) {
    return (
      <div className="space-y-3 pl-4">
        {colonnes.map((colonne) => (
          <div key={colonne.cle} className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{colonne.libelle}</p>
            <ul className="space-y-1">
              {colonne.entrees.map((page) => (
                <li key={page.url}>
                  <NavLink
                    to={page.url}
                    onClick={onNavigation}
                    className={({ isActive }) =>
                      cn('block py-0.5 text-xl', isActive ? 'text-foreground' : 'text-muted-foreground')
                    }
                  >
                    {page.titre}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'grid max-h-[70vh] grid-cols-1 gap-x-10 gap-y-5 overflow-y-auto p-5',
        COLONNES[Math.min(colonnes.length, 5)]
      )}
    >
      {colonnes.map((colonne) => (
        <section key={colonne.cle} className="min-w-[9rem]" aria-label={colonne.libelle}>
          <h3 className="mb-2 text-sm font-semibold text-foreground/70">{colonne.libelle}</h3>
          <ul className="space-y-0.5">
            {colonne.entrees.map((page) => {
              const actif = pathname === page.url || pathname.startsWith(`${page.url}/`);
              return (
                <li key={page.url}>
                  <NavLink
                    to={page.url}
                    onClick={onNavigation}
                    className={cn(
                      'flex items-center gap-2 whitespace-nowrap rounded-md py-1 text-sm transition-colors',
                      actif ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {page.titre}
                    {/* Dire qu'on n'y fera que lire : sinon on l'ouvre pour modifier et on bute. */}
                    {page.droit === 'consulter' && (
                      <span className="rounded bg-muted px-1.5 py-px text-[0.65rem] font-normal text-muted-foreground">
                        lecture
                      </span>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
