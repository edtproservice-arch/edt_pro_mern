import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarClock, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { FIN_SEMESTRE_1, semaineDe } from 'shared/domain';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupText } from '@/components/ui/button-group';
import { cn } from '@/lib/utils';
import { FOND_FORMATION, FOND_STAGE } from './GrilleChronogramme';

/**
 * Barre de navigation des semaines, au-dessus de la grille.
 * ← la barre du chronogramme d'EDT Pro
 *
 * ═══ POURQUOI ELLE EST NÉCESSAIRE ═══
 * La grille fait 45 colonnes, dont une douzaine tient à l'écran. Sans repère,
 * on défile à l'aveugle : rien ne dit où l'on se trouve dans l'année, ni où se
 * trouvent les semaines déjà remplies. La bande reproduit l'année entière en
 * miniature — un carré par semaine — et le cadre bleu montre ce qu'on regarde.
 *
 * ⚠️ `FIN_SEMESTRE_1` VIENT DU DOMAINE, il n'est plus redéfini ici : la bande,
 * la grille et les boutons « Semestre 1 / 2 » doivent tomber sur la MÊME
 * colonne, et trois copies d'un même 17 auraient dérivé.
 */
/** Paliers de zoom, en pourcentage. */
const ZOOMS = [50, 60, 70, 80, 90, 100, 110, 125, 150];

export default function NavigationSemaines({ semaines, planning, conteneur, zoom, onZoom }) {
  const [visible, setVisible] = useState({ debut: 1, fin: 1 });
  /** Le rectangle du cadre, en pixels, dans le repère de la bande. */
  const [cadre, setCadre] = useState(null);
  const bande = useRef(null);

  /**
   * Quelles semaines sont à l'écran ?
   *
   * Mesuré sur le DOM plutôt que calculé depuis les largeurs : le zoom, les
   * colonnes collantes et la barre de défilement décalent tout, et une formule
   * se serait désynchronisée au premier changement de largeur.
   */
  const mesurer = useCallback(() => {
    const boite = conteneur.current;
    if (!boite) return;

    const cellules = [...boite.querySelectorAll('tbody tr:first-child [data-semaine]')];
    if (cellules.length === 0) return;

    const gaucheUtile = boite.getBoundingClientRect().left;
    const droiteUtile = gaucheUtile + boite.clientWidth;

    const dedans = cellules.filter((cellule) => {
      const rect = cellule.getBoundingClientRect();
      // Une colonne à moitié masquée par le bloc collant ne compte pas comme
      // visible : on annoncerait une semaine qu'on ne peut pas lire.
      return rect.left >= gaucheUtile - 1 && rect.right <= droiteUtile + 1;
    });

    if (dedans.length === 0) return;

    setVisible({
      debut: Number(dedans[0].dataset.semaine),
      fin: Number(dedans.at(-1).dataset.semaine),
    });
  }, [conteneur]);

  useEffect(() => {
    const boite = conteneur.current;
    if (!boite) return undefined;

    mesurer();
    boite.addEventListener('scroll', mesurer, { passive: true });

    // Le redimensionnement de la fenêtre change autant la fenêtre visible
    // qu'un défilement.
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(boite);

    return () => {
      boite.removeEventListener('scroll', mesurer);
      observateur.disconnect();
    };
  }, [conteneur, mesurer, zoom]);

  /** Amène une semaine à gauche de la zone visible. */
  const allerA = useCallback(
    (numero) => {
      const boite = conteneur.current;
      const cellule = boite?.querySelector(`tbody tr:first-child [data-semaine="${numero}"]`);
      if (!boite || !cellule) return;

      /*
       * ⚠️ CALCUL PAR RECTANGLES, ET NON PAR `offsetLeft`.
       * `offsetLeft` se mesure depuis l'`offsetParent`, qui n'est pas le
       * conteneur de défilement : mesuré ici, l'écart était de 205 px, et la
       * semaine visée tombait à côté. Les rectangles, eux, sont dans le même
       * repère que `scrollLeft`.
       *
       * ⚠️ On vise le bord droit du BLOC COLLANT, pas celui du conteneur : les
       * quatre colonnes de gauche recouvrent la zone, et une semaine amenée à 0
       * se retrouverait cachée dessous. Sa largeur est MESURÉE — l'écrire en
       * dur se désynchroniserait au premier changement de colonne.
       */
      const formateur = boite.querySelector('tbody tr:first-child td:nth-of-type(3)');
      const bordCollant = formateur
        ? formateur.getBoundingClientRect().right - boite.getBoundingClientRect().left
        : 0;

      const decalage =
        cellule.getBoundingClientRect().left - boite.getBoundingClientRect().left - bordCollant;

      boite.scrollTo({ left: boite.scrollLeft + decalage, behavior: 'smooth' });
    },
    [conteneur]
  );

  /*
   * Le cadre suit la fenêtre visible, et se remesure quand la bande change de
   * largeur — un repli de la barre latérale suffit à tout décaler.
   */
  useEffect(() => {
    const boite = bande.current;
    if (!boite) return undefined;

    const placer = () => {
      const premier = boite.querySelector(`[data-vers="${visible.debut}"]`);
      const dernier = boite.querySelector(`[data-vers="${visible.fin}"]`);
      if (!premier || !dernier) {
        setCadre(null);
        return;
      }

      const base = boite.getBoundingClientRect();
      const debut = premier.getBoundingClientRect();
      const fin = dernier.getBoundingClientRect();
      setCadre({ gauche: debut.left - base.left, largeur: fin.right - debut.left });
    };

    placer();
    const observateur = new ResizeObserver(placer);
    observateur.observe(boite);
    return () => observateur.disconnect();
  }, [visible.debut, visible.fin, semaines.length]);

  const rangZoom = ZOOMS.indexOf(zoom);
  const semaineDuJour = semaineDe(new Date())?.numero;
  const aujourdhuiDansAnnee = semaines.some((semaine) => semaine.numero === semaineDuJour);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Semaines{' '}
          <strong className="text-foreground">
            S{visible.debut} – S{visible.fin}
          </strong>
        </p>

        <div className="flex flex-wrap items-center gap-1">
          {/*
            ⚠️ GROUPÉS, COMME DANS L'EMPLOI DU TEMPS (2026-08-25, demande du
            porteur). Les quatre commandes règlent UNE seule chose : espacées
            comme quatre boutons indépendants, elles se lisaient comme quatre
            actions sans rapport. Le même réglage, au même endroit et sous la
            même forme, ne se réapprend pas d'un écran à l'autre.

            ⚠️ `whitespace-nowrap` et une largeur minimale : à 3,5 rem, « 100 »
            et « % » passaient sur deux lignes et le bloc doublait de hauteur —
            c'est le défaut déjà corrigé sur l'emploi du temps.
          */}
          <ButtonGroup>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              title="Réduire la grille"
              disabled={rangZoom <= 0}
              onClick={() => onZoom(ZOOMS[rangZoom - 1])}
            >
              <ZoomOut className="size-3.5" />
            </Button>

            <ButtonGroupText className="h-8 min-w-[3.75rem] justify-center whitespace-nowrap px-2 text-xs tabular-nums">
              {zoom} %
            </ButtonGroupText>

            <Button
              variant="outline"
              size="icon"
              className="size-8"
              title="Agrandir la grille"
              disabled={rangZoom >= ZOOMS.length - 1}
              onClick={() => onZoom(ZOOMS[rangZoom + 1])}
            >
              <ZoomIn className="size-3.5" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              className="size-8"
              title="Faire tenir l’année entière"
              onClick={() => onZoom(zoomPourTenir(conteneur.current))}
            >
              <Maximize2 className="size-3.5" />
            </Button>
          </ButtonGroup>

          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            // Hors année scolaire, « Aujourd'hui » n'a nulle part où aller :
            // désactivé plutôt que sans effet.
            disabled={!aujourdhuiDansAnnee}
            title={
              aujourdhuiDansAnnee
                ? `Aller à la semaine ${semaineDuJour}`
                : 'La date du jour est hors de cette année scolaire'
            }
            onClick={() => allerA(semaineDuJour)}
          >
            <CalendarClock className="size-3.5" />
            Aujourd’hui
          </Button>

          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => allerA(1)}>
            Semestre 1
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => allerA(FIN_SEMESTRE_1 + 1)}
          >
            Semestre 2
          </Button>
        </div>
      </div>

      {/*
        La bande : un carré par semaine, dans l'ordre de l'année. Un seul
        écouteur, sur le conteneur — 45 boutons en auraient demandé 45.
      */}
      <div
        ref={bande}
        /*
         * ⚠️ `relative` : le cadre de la plage visible est posé PAR-DESSUS, en
         * position absolue. Voir plus bas pourquoi il ne peut pas être dessiné
         * carré par carré.
         */
        className="relative flex gap-px overflow-hidden rounded-md border p-1"
        onClick={(evenement) => {
          const numero = Number(evenement.target.closest('[data-vers]')?.dataset.vers);
          if (Number.isInteger(numero)) allerA(numero);
        }}
      >
        {semaines.map((semaine) => (
          <CarreSemaine
            key={semaine.numero}
            semaine={semaine}
            rempli={aDesHeures(planning, semaine.numero)}
            finSemestre={semaine.numero === FIN_SEMESTRE_1}
          />
        ))}

        {/*
          ═══ ⚠️ UN SEUL CADRE, PAS UN ANNEAU PAR SEMAINE ═══
          La plage visible en compte une douzaine : un `ring` posé sur chacune
          dessinait DOUZE cadres accolés, et l'œil y lisait douze choses au lieu
          d'une seule fenêtre. C'est une PLAGE — elle doit se voir comme un bloc,
          comme dans l'existant.

          ⚠️ IL EST POSITIONNÉ EN PIXELS, MESURÉS. Les carrés sont en `flex-1`
          avec un interstice d'un pixel : un calcul en pourcentage dériverait
          d'autant de pixels qu'il y a d'interstices, et le cadre tomberait à
          côté de ses bornes. On lit donc les rectangles réels.
        */}
        {cadre && (
          <span
            aria-hidden
            /*
             * ⚠️ UN VOILE, PAS UN APLAT. Le cadre est posé PAR-DESSUS les
             * carrés : un fond opaque effacerait ce qu'ils disent — vacances,
             * stage, semaine saisie. À 10 %, la plage se voit comme un bloc et
             * les états restent lisibles au travers.
             *
             * `pointer-events-none` reste indispensable : sans lui, ce voile
             * intercepterait les clics d'une douzaine de semaines, qui ne
             * seraient plus atteignables.
             */
            className="pointer-events-none absolute inset-y-1 rounded-sm bg-primary/10 ring-1 ring-primary"
            style={{ left: cadre.gauche, width: cadre.largeur }}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.7rem] text-muted-foreground">
        <Puce classe="bg-primary/10 border-primary/30" libelle="Vacances" />
        <Puce classe={cn(FOND_STAGE, 'border-[#b2ebf2]')} libelle="Stage" />
        <Puce classe="bg-warning/25 border-warning/50" libelle="Férié" />
        <Puce classe="bg-accent-green/20 border-accent-green/50" libelle="Semaine saisie" />
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-px bg-destructive" />
          Fin du semestre 1
        </span>
      </div>
    </div>
  );
}

/**
 * Un carré de la bande.
 *
 * L'état de la semaine prime sur son remplissage : une semaine de vacances ne
 * peut pas être saisie, la colorer en « saisie » serait contradictoire.
 */
function CarreSemaine({ semaine, rempli, finSemestre }) {
  const teinte = semaine.motif === 'vacances'
    ? 'bg-primary/10 border-primary/30'
    : semaine.motif === 'stage'
      ? cn(FOND_STAGE, 'border-accent-cyan')
      : semaine.motif === 'formation'
        ? cn(FOND_FORMATION, 'border-accent-pink/40')
        : rempli
        ? 'bg-accent-green/20 border-accent-green/50 text-accent-green'
        : semaine.joursDisponibles < 6
          ? 'bg-warning/25 border-warning/50'
          : 'bg-muted border-transparent';

  return (
    <button
      type="button"
      data-vers={semaine.numero}
      title={titre(semaine, rempli)}
      className={cn(
        'relative min-w-0 flex-1 rounded-sm border py-1 text-[0.6rem] tabular-nums transition-colors',
        teinte,
        // Le filet rouge marque la coupure des semestres.
        finSemestre && 'after:absolute after:-right-px after:inset-y-0 after:w-px after:bg-destructive'
      )}
    >
      {semaine.numero}
    </button>
  );
}

function Puce({ classe, libelle }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block size-3 rounded-sm border', classe)} />
      {libelle}
    </span>
  );
}

const aDesHeures = (planning, numero) =>
  Object.values(planning ?? {}).some((cellules) => Number(cellules?.[numero]?.heures) > 0);

function titre(semaine, rempli) {
  if (semaine.motif === 'vacances') return `S${semaine.numero} — vacances`;
  if (semaine.motif === 'stage') return `S${semaine.numero} — stage du groupe`;
  if (semaine.motif === 'formation') return `S${semaine.numero} — formateur en formation`;
  if (semaine.joursDisponibles < 6) {
    return `S${semaine.numero} — ${semaine.joursDisponibles} jour(s) ouvré(s)`;
  }
  return `S${semaine.numero}${rempli ? ' — saisie' : ''}`;
}

/**
 * Zoom qui fait tenir l'année entière.
 *
 * ⚠️ Mesuré à zoom 1, comme dans l'existant : `scrollWidth` s'exprime dans les
 * pixels de l'élément ZOOMÉ. Le lire tel quel donnerait un rapport faussé par
 * le zoom déjà appliqué, et le résultat serait faux à chaque nouvel appel.
 */
function zoomPourTenir(boite) {
  if (!boite) return 100;

  const garde = boite.style.zoom;
  boite.style.zoom = '1';
  const rapport = boite.clientWidth / boite.scrollWidth;
  boite.style.zoom = garde;

  const exact = Math.floor(rapport * 100);
  // On retient le palier le plus grand qui tient encore.
  return [...ZOOMS].reverse().find((palier) => palier <= exact) ?? ZOOMS[0];
}
