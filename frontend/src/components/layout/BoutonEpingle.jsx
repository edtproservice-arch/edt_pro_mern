import { Pin, PinOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/ui/sidebar';
import { basculerEpinglage, useEpinglage } from '@/lib/epinglageBarre';
import { cn } from '@/lib/utils';

/**
 * L'épingle : garder la barre latérale ouverte.
 *
 * ═══ POURQUOI ELLE EXISTE ═══
 * La barre se replie d'elle-même au premier clic dans la page — la navigation se
 * fait par à-coups, la grille se lit en continu, et rendre les 16 rem au contenu
 * est ce qu'on veut presque toujours. Presque : sur un grand écran, ou quand on
 * passe d'un réglage à l'autre, la voir se refermer sans arrêt est une gêne.
 * L'épingle rend la main.
 *
 * ⚠️ ELLE VIT DANS LA BARRE, devant le logo, et disparaît avec lui en mode
 * icônes : on n'épingle pas une barre qu'on vient de replier. Le réglage ne se
 * règle que sur une barre ouverte — c'est là qu'on est quand on veut qu'elle y
 * reste.
 *
 * L'infobulle dit ce qu'un clic PRODUIT, jamais l'état courant : c'est l'icône,
 * pleine ou barrée, qui montre où l'on en est.
 */
export default function BoutonEpingle() {
  const epinglee = useEpinglage();
  const { isMobile } = useSidebar();

  // Sur mobile la barre est un panneau superposé, refermé par son voile : il n'y
  // a rien à y épingler.
  if (isMobile) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('size-7 shrink-0', epinglee && 'text-primary')}
      aria-pressed={epinglee}
      title={
        epinglee
          ? 'Barre épinglée — elle reste ouverte. Cliquer pour qu’elle se replie à nouveau au premier clic dans la page.'
          : 'Épingler la barre — elle cessera de se replier au premier clic dans la page.'
      }
      onClick={basculerEpinglage}
    >
      {epinglee ? <Pin className="size-4 fill-current" /> : <PinOff className="size-4" />}
      <span className="sr-only">
        {epinglee ? 'Désépingler la barre latérale' : 'Épingler la barre latérale'}
      </span>
    </Button>
  );
}
