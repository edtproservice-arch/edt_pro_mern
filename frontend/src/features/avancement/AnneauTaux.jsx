import { AVANCEMENT_ELEVE, AVANCEMENT_MOYEN } from 'shared/domain';
import { cn } from '@/lib/utils';
import { nombre } from '@/lib/nombres';

/**
 * Le taux global, en anneau.
 * ← `#doughnut-percent` et `#global-progress-rate` d'avancement.html
 *
 * ⚠️ EN SVG, PAS EN GRAPHIQUE. L'existant montait un Chart.js entier — chargé
 * depuis un CDN — pour dessiner un seul cercle : sans réseau, l'indicateur
 * principal de l'écran restait vide. Deux arcs suffisent, et la CSP stricte
 * prévue en Phase 11 reste applicable.
 */
/**
 * @param {'normal'|'grand'} [taille] — `grand` pour le panneau latéral, où la
 *   place ne manque pas et où l'anneau est le premier chiffre qu'on vient lire.
 */
export default function AnneauTaux({ taux, taille = 'normal' }) {
  const grand = taille === 'grand';
  const rayon = 34;
  const perimetre = 2 * Math.PI * rayon;
  /* ⚠️ BORNÉ À 100 % POUR LE TRACÉ SEULEMENT : un dépassement reste écrit en
     chiffres — c'est une information, pas une erreur à masquer — mais un arc de
     plus d'un tour se lirait comme un retour à zéro. */
  const part = Math.min(Math.max(taux ?? 0, 0), 100) / 100;

  return (
    <div className={cn('relative shrink-0', grand ? 'size-36' : 'size-24')}>
      {/* ⚠️ LE `viewBox` NE CHANGE PAS : le tracé est en coordonnées relatives,
          c'est la BOÎTE qui grandit. Toucher au rayon décalerait l'épaisseur du
          trait par rapport au cercle. */}
      <svg viewBox="0 0 80 80" className={cn('-rotate-90', grand ? 'size-36' : 'size-24')}>
        <circle cx="40" cy="40" r={rayon} fill="none" strokeWidth="8" className="stroke-muted" />
        <circle
          cx="40"
          cy="40"
          r={rayon}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={perimetre}
          strokeDashoffset={perimetre * (1 - part)}
          className={cn('transition-[stroke-dashoffset] duration-500', trait(taux))}
        />
      </svg>

      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center font-semibold tabular-nums',
          grand ? 'text-2xl' : 'text-lg'
        )}
      >
        {/* ⚠️ « — » ET NON « 0 % » quand rien n'est prévu : un zéro se lit comme
            un retard, alors qu'il n'y a rien à faire. */}
        {/* ⚠️ EN FRANÇAIS : « 0,6 % ». Rendu brut, il écrivait « 0.6 % » juste
            à côté d'un bandeau qui affiche « 14 465,5 h ». */}
        {taux === null ? '—' : `${nombre(taux)} %`}
      </span>
    </div>
  );
}

/**
 * ⚠️ LES MÊMES SEUILS QUE LE BADGE DE LA GRILLE (`AVANCEMENT_ÉLEVÉ` / `MOYEN`) :
 * le même module doit se lire de la même couleur d'un écran à l'autre.
 */
function trait(taux) {
  if (taux === null) return 'stroke-muted-foreground/40';
  if (taux >= AVANCEMENT_ELEVE) return 'stroke-success';
  if (taux >= AVANCEMENT_MOYEN) return 'stroke-accent-orange';
  return 'stroke-destructive';
}
