import { cn } from '@/lib/utils';
import { nombre } from '@/lib/nombres';

/**
 * Le taux d'avancement d'un module, en badge.
 *
 * ═══ ⚠️ FOND PLEIN, COMME LE BADGE DE SEMESTRE ═══
 * Les aplats à 10-25 % d'opacité étaient posés sur des cellules DÉJÀ colorées —
 * vert pour une séance placée, violet pour une séance à distance : deux voiles
 * translucides l'un sur l'autre, et le chiffre s'effaçait. Le fond plein tranche
 * sur n'importe quel fond.
 *
 * ⚠️ TEXTE BLANC SUR LES TROIS — décision du porteur (2026-08-25), le noir de la
 * première version rompait l'uniformité. `--warning` (#f59e0b) est trop clair
 * pour cela : du blanc y tombe à 2:1.
 *
 * ⚠️ L'ORANGE EST CELUI DU BADGE « MODULE ANNUEL » (`--accent-orange`), à la
 * demande du porteur — j'avais d'abord retenu un ambre assombri pour les
 * distinguer, les deux badges pouvant se retrouver DANS LA MÊME CASE. Ils
 * restent lisibles l'un de l'autre par leur contenu : une lettre d'un côté, un
 * pourcentage de l'autre.
 */
const NIVEAUX = {
  haut: 'bg-success text-white',
  moyen: 'bg-accent-orange text-white',
  bas: 'bg-destructive text-white',
};

/*
 * ⚠️ AUCUN `title` NATIF — même raison que `BadgeSemestre` : dans une grille,
 * l'infobulle du système se déplie à chaque case franchie. Le détail
 * « X h posées sur Y h prévues » est dans la carte au survol du module.
 */
export default function BadgeAvancement({ avancement, className }) {
  /*
   * ⚠️ `null` ET `0 %` NE DISENT PAS LA MÊME CHOSE : rien de prévu, contre prévu
   * mais rien de posé. Le premier n'affiche aucun badge — un « 0 % » ferait
   * croire à un retard là où il n'y a rien à faire.
   */
  if (!avancement || avancement.taux === null || avancement.taux === undefined) return null;

  return (
    <span
      className={cn(
        'inline-block shrink-0 rounded px-1 text-[0.65rem] font-semibold leading-4 tabular-nums',
        NIVEAUX[avancement.niveau] ?? NIVEAUX.bas,
        className
      )}
    >
      {/* ⚠️ EN FRANÇAIS : « 5,1 % ». Les taux de la grille tombent juste par
          hasard — ils sont entiers ; celui de l'avancement, arrondi au dixième,
          rendait « 5.1% » dans une interface qui écrit « 905,5 » à côté.
          ⚠️ L'ESPACE RESTE ABSENTE : la case d'emploi du temps fait 34 px. */}
      {nombre(avancement.taux)}%
    </span>
  );
}
