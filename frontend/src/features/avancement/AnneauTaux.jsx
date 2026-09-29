import { cn } from '@/lib/utils';
import { nombre } from '@/lib/nombres';

/**
 * Un taux, en anneau — la forme du « Radial Chart - Shape » de shadcn : un
 * cercle complet, une seule couleur, un seul chiffre au centre.
 * ← `#doughnut-percent` et `#global-progress-rate` d'avancement.html
 *
 * ⚠️ EN SVG, PAS EN GRAPHIQUE. L'existant montait un Chart.js entier — chargé
 * depuis un CDN — pour dessiner un seul cercle : sans réseau, l'indicateur
 * principal de l'écran restait vide. Deux arcs suffisent, et la CSP stricte
 * prévue en Phase 11 reste applicable.
 *
 * ═══ ⚠️ TROIS FORMES ESSAYÉES, ET C'EST LA PLUS SIMPLE QUI RESTE (demande du
 * porteur, 2026-09-25 : « je n'aime pas [le demi-cercle empilé], utilise Radial
 * Chart - Shape ») ═══
 * Le composant a porté tour à tour un anneau empilé (présentiel + distanciel
 * pondérés par le prévu, invisible à faible avancement), trois pistes
 * concentriques, puis un demi-cercle empilé — trois lectures qui essayaient de
 * montrer les TROIS chiffres à la fois. Le porteur a tranché : un seul cercle,
 * UNE valeur à la fois, et c'est la bascule à côté (`BasculeAnneau`, dans
 * `Chiffres`) qui choisit LAQUELLE — total, distanciel ou présentiel. Cet
 * anneau-ci ne sait donc plus rien des trois mesures : il ne fait que dessiner
 * le taux et la couleur qu'on lui donne.
 */
/**
 * @param {number|null} taux — `null` quand rien n'est prévu pour cette mesure.
 * @param {string} [couleur] — une couleur CSS valide pour le trait (ex.
 *   `hsl(var(--accent-orange))`), choisie par l'appelant selon la mesure
 *   affichée.
 * @param {'normal'|'grand'} [taille] — `grand` pour le panneau latéral, où la
 *   place ne manque pas et où l'anneau est le premier chiffre qu'on vient lire.
 */
export default function AnneauTaux({ taux, couleur = 'hsl(var(--accent-orange))', taille = 'normal' }) {
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
        {taux !== null && (
          <circle
            cx="40"
            cy="40"
            r={rayon}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={perimetre}
            strokeDashoffset={perimetre * (1 - part)}
            className="transition-[stroke-dashoffset] duration-500"
            style={{ stroke: couleur }}
          />
        )}
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
