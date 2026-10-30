import { useEffect, useState, useSyncExternalStore } from 'react';
import { Copy, GripHorizontal, Minus, Square, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { estApplicationDesktop } from '@/lib/miseAJourDesktop';

/**
 * ═══ LA BARRE DE TITRE DE L'APPLICATION DE BUREAU, DANS CELLE DE L'APPLICATION ═══
 * (2026-10-30, demande du porteur : « masquer la barre noire en haut pour gagner l'espace,
 * et les boutons fermer, réduire… dans la barre du haut, à côté des trois points ».)
 * La fenêtre Tauri est sans décoration (`decorations: false`, `tauri.conf.json`) : ces boutons
 * la remplacent, et la barre du haut de l'application se saisit pour la déplacer
 * (`data-tauri-drag-region` ; un double-clic l'agrandit).
 *
 * ⚠️ APPLICATION DE BUREAU SEULEMENT : dans un navigateur, rien ne s'affiche.
 * ⚠️ TOUTE PAGE DOIT POUVOIR FERMER LA FENÊTRE : celles qui n'ont pas la barre de
 *    `CoquilleApp` — connexion, administration, choix de l'établissement — reçoivent
 *    `ControlesFenetreSecours`, en haut à droite. La barre signale sa présence ici.
 */

/* Combien de barres du haut sont montées : 0 → les contrôles de secours s'affichent. */
let barresMontees = 0;
const abonnes = new Set();
const prevenir = () => abonnes.forEach((abonne) => abonne());
const abonner = (abonne) => {
  abonnes.add(abonne);
  return () => abonnes.delete(abonne);
};

/** La fenêtre courante de Tauri, chargée à la demande : la version web n'en a pas besoin. */
const fenetre = async () => (await import('@tauri-apps/api/window')).getCurrentWindow();

function useAgrandie() {
  const [agrandie, setAgrandie] = useState(false);
  useEffect(() => {
    let arret = null;
    let annule = false;
    (async () => {
      const courante = await fenetre();
      const lire = async () => !annule && setAgrandie(await courante.isMaximized());
      await lire();
      // Agrandie au double-clic, par Windows + flèche, ou restaurée : l'icône suit.
      arret = await courante.onResized(lire);
      if (annule) arret();
    })().catch(() => {});
    return () => {
      annule = true;
      arret?.();
    };
  }, []);
  return agrandie;
}

const BOUTON =
  'flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

function Boutons({ className }) {
  const agrandie = useAgrandie();
  const agir = (action) => () => fenetre().then(action).catch(() => {});

  return (
    <div className={cn('flex h-full items-stretch', className)}>
      <button type="button" className={BOUTON} title="Réduire" aria-label="Réduire" onClick={agir((f) => f.minimize())}>
        <Minus className="size-4" />
      </button>
      <button
        type="button"
        className={BOUTON}
        title={agrandie ? 'Restaurer' : 'Agrandir'}
        aria-label={agrandie ? 'Restaurer' : 'Agrandir'}
        onClick={agir((f) => f.toggleMaximize())}
      >
        {agrandie ? <Copy className="size-3.5 -scale-x-100" /> : <Square className="size-3.5" />}
      </button>
      <button
        type="button"
        className={cn(BOUTON, 'hover:bg-red-600 hover:text-white')}
        title="Fermer"
        aria-label="Fermer"
        onClick={agir((f) => f.close())}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

/**
 * Les boutons, au bout de la barre du haut de l'application. Ils occupent toute sa hauteur,
 * collés au bord droit — d'où la marge négative, qui annule le `px-4` de la barre.
 */
export function ControlesFenetre() {
  const desktop = estApplicationDesktop();
  useEffect(() => {
    if (!desktop) return undefined;
    barresMontees += 1;
    prevenir();
    return () => {
      barresMontees -= 1;
      prevenir();
    };
  }, [desktop]);

  if (!desktop) return null;
  return <Boutons className="-my-px -mr-4 ml-1 self-stretch border-l" />;
}

/** En haut à droite des pages SANS barre du haut : de quoi déplacer et fermer la fenêtre. */
export function ControlesFenetreSecours() {
  const montees = useSyncExternalStore(abonner, () => barresMontees);
  if (!estApplicationDesktop() || montees > 0) return null;

  return (
    <div className="fixed right-0 top-0 z-[100] flex h-8 items-stretch rounded-bl-md border-b border-l bg-background/95 shadow-sm backdrop-blur print:hidden">
      {/* La poignée : saisie, elle déplace la fenêtre ; double-cliquée, elle l'agrandit. */}
      <div
        data-tauri-drag-region
        title="Déplacer la fenêtre"
        className="flex w-10 cursor-grab items-center justify-center text-muted-foreground"
      >
        <GripHorizontal className="pointer-events-none size-4" />
      </div>
      <Boutons />
    </div>
  );
}
