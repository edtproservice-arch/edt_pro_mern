import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ALargeSmall,
  ClipboardCopy,
  Link2,
  Maximize,
  Minimize,
  MoreHorizontal,
  MoveHorizontal,
  Star,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { basculerFavori, useFavoris } from '@/lib/favoris';
import { basculerAffichage, useAffichage } from '@/lib/preferencesAffichage';
import { depuis, useModifications } from '@/lib/derniereModification';
import { annuler, usePeutAnnuler } from '@/lib/annulation';
import { cn } from '@/lib/utils';
import { chargerModificationPage } from '@/features/partages/api';
import { EmplacementEnTete } from './enTetePage';
import { pageDeChemin } from './navigation';

/**
 * Barre d'outils de la page, à droite de l'en-tête.
 *
 * Date de dernière modification · étoile de favori · menu des actions.
 *
 * ⚠️ « Défaire » annule le dernier ENREGISTREMENT, pas la dernière frappe. Les
 * écrans de réglages s'écrivent seuls après une pause de saisie : c'est cette
 * écriture qui est l'événement, et c'est elle qu'on veut pouvoir reprendre.
 * Le mécanisme vit dans `lib/annulation.js` ; ici on ne fait que l'appeler.
 */
export default function BarreOutilsPage() {
  const { pathname } = useLocation();

  const favoris = useFavoris();
  const affichage = useAffichage();
  const modifications = useModifications();
  const pleinEcran = usePleinEcran();
  const annulable = usePeutAnnuler(pathname);

  const favori = favoris.includes(pathname);

  /*
   * ═══ LA DATE VIENT DU SERVEUR (2026-09-13, demande du porteur : « la date de
   * modification sur toutes les pages ») ═══ Elle ne s'affichait qu'après un
   * enregistrement fait DEPUIS CE NAVIGATEUR (trace locale posée par
   * `CadreReglage`) : jamais sur l'emploi du temps, les absences ou les
   * documents, et jamais pour ce qu'un collègue avait écrit. Le serveur note
   * désormais la dernière écriture de chaque page — quand, et par qui.
   *
   * ⚠️ LA TRACE LOCALE RESTE EN REPLI : la plus récente des deux l'emporte, si
   * bien qu'un enregistrement qu'on vient de faire s'affiche avant même que la
   * relecture ne revienne.
   */
  const page = pageDeChemin(pathname);
  const serveur = useQuery({
    queryKey: ['modifications', page],
    queryFn: () => chargerModificationPage(page),
    enabled: Boolean(page),
    retry: false,
    staleTime: 30_000,
  });
  const auServeur = serveur.data?.modifieLe ? Date.parse(serveur.data.modifieLe) : null;
  const localement = modifications[pathname] ?? null;
  const modifiee = Math.max(auServeur ?? 0, localement ?? 0) || null;
  // L'auteur n'est nommé que si c'est bien sa date qu'on affiche.
  const auteur = auServeur && auServeur >= (localement ?? 0) ? serveur.data?.auteur?.nom : null;

  return (
    <div className="ml-auto flex items-center gap-1">
      <DateModification horodatage={modifiee} auteur={auteur} />

      {/* Ce que la PAGE ajoute à la barre — avatars et « Partager » sur
          l'emploi du temps, dans l'ordre de Notion : avant l'étoile. */}
      <EmplacementEnTete className="mr-1" />

      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-pressed={favori}
        title={favori ? 'Retirer des favoris' : 'Ajouter aux favoris'}
        onClick={() => basculerFavori(pathname)}
      >
        {/*
          Étoile PLEINE quand la page est en favori : le seul changement de
          couleur se perd sur une icône de 16 px, et l'état doit se lire d'un
          regard depuis n'importe quelle page.
        */}
        <Star className={cn('size-4', favori && 'fill-warning text-warning')} />
        <span className="sr-only">{favori ? 'Retirer des favoris' : 'Ajouter aux favoris'}</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" title="Actions de la page">
            <MoreHorizontal className="size-4" />
            <span className="sr-only">Actions de la page</span>
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onClick={copierLien}>
            <Link2 className="size-4" />
            Copier le lien
            <DropdownMenuShortcut>Ctrl+Alt+L</DropdownMenuShortcut>
          </DropdownMenuItem>

          <DropdownMenuItem onClick={copierContenu}>
            <ClipboardCopy className="size-4" />
            Copier le contenu de la page
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <Bascule
            libelle="Petit texte"
            icone={ALargeSmall}
            actif={affichage.petitTexte}
            onBasculer={() => basculerAffichage('petitTexte')}
          />

          <Bascule
            libelle="Pleine largeur"
            icone={MoveHorizontal}
            actif={affichage.pleineLargeur}
            onBasculer={() => basculerAffichage('pleineLargeur')}
          />

          {/*
            ⚠️ AVEC LES RÉGLAGES D'AFFICHAGE, pas avec les actions : « Petit
            texte », « Pleine largeur » et « Plein écran » répondent à la même
            question — combien de place le contenu occupe-t-il. Chrome le range
            de même, sur sa rangée de zoom.

            ⚠️ DÉSACTIVÉ, PAS MASQUÉ, quand le navigateur l'interdit (un cadre
            sans `allowfullscreen`) : une entrée qui apparaît et disparaît fait
            douter de ce qu'on a vu. C'est la règle déjà posée pour « Défaire ».
          */}
          <Bascule
            libelle="Plein écran"
            icone={pleinEcran ? Minimize : Maximize}
            actif={pleinEcran}
            desactive={!document.fullscreenEnabled}
            onBasculer={basculerPleinEcran}
          />

          <DropdownMenuSeparator />

          {/*
            ⚠️ « Défaire » est DÉSACTIVÉ tant qu'il n'y a rien à annuler — et non
            masqué. Une entrée qui apparaît et disparaît fait douter de ce qu'on
            a vu ; grisée, elle dit qu'elle existe et qu'elle ne s'applique pas
            encore.
          */}
          <DropdownMenuItem
            disabled={!annulable}
            onClick={() => {
              if (annuler(pathname)) toast.success('Dernier enregistrement annulé');
            }}
          >
            <Undo2 className="size-4" />
            Défaire
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Réglage à interrupteur, dans le menu.
 *
 * ⚠️ `onSelect` est ANNULÉ : par défaut, Radix referme le menu au choix d'une
 * entrée. Ces deux réglages se règlent l'un après l'autre, en regardant l'effet
 * — refermer obligerait à rouvrir entre chaque essai.
 */
function Bascule({ libelle, icone: Icone, actif, onBasculer, desactive = false }) {
  return (
    <DropdownMenuItem
      onSelect={(evenement) => evenement.preventDefault()}
      onClick={onBasculer}
      disabled={desactive}
      className="justify-between"
    >
      <span className="flex items-center gap-2">
        <Icone className="size-4" />
        {libelle}
      </span>

      {/*
        L'interrupteur est décoratif ici : c'est la LIGNE ENTIÈRE qui bascule,
        `pointer-events-none` évite qu'un clic dessus déclenche deux fois.
      */}
      <Switch checked={actif} className="pointer-events-none" tabIndex={-1} aria-hidden />
    </DropdownMenuItem>
  );
}

/**
 * L'état PLEIN ÉCRAN, lu dans le document et non tenu à part.
 *
 * ═══ ⚠️ IL NE PEUT PAS ÊTRE UN ÉTAT LOCAL ═══
 * On sort du plein écran par Échap, par F11, ou par un autre onglet — sans que
 * l'application soit prévenue. Un booléen posé au clic mentirait dès la première
 * de ces sorties, et l'interrupteur annoncerait un plein écran qui n'existe
 * plus. `fullscreenchange` est le seul signal fiable.
 *
 * ⚠️ ET F11 N'EST PAS ANNONCÉ dans le menu, bien qu'il donne le même résultat à
 * l'œil : c'est le plein écran DU NAVIGATEUR, qui ne renseigne pas
 * `document.fullscreenElement`. L'inscrire comme raccourci ferait afficher un
 * interrupteur éteint sur une fenêtre bel et bien en plein écran.
 */
function usePleinEcran() {
  const [actif, setActif] = useState(() => Boolean(document.fullscreenElement));

  useEffect(() => {
    const suivre = () => setActif(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', suivre);
    return () => document.removeEventListener('fullscreenchange', suivre);
  }, []);

  return actif;
}

/**
 * ⚠️ SUR `documentElement`, pas sur le contenu : la barre latérale et l'en-tête
 * font partie de l'application, et n'en garder que le contenu priverait de la
 * navigation au moment précis où l'on veut travailler sans être dérangé.
 *
 * ⚠️ LA DEMANDE PEUT ÊTRE REFUSÉE — cadre sans `allowfullscreen`, réglage du
 * navigateur — et elle rend une promesse REJETÉE, jamais une exception
 * synchrone. Sans ce `catch`, le refus passerait en erreur non interceptée et
 * rien ne l'expliquerait à l'écran.
 */
async function basculerPleinEcran() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    toast.error('Plein écran impossible', {
      description: 'Le navigateur a refusé le passage en plein écran.',
    });
  }
}

/**
 * « Modifié à l'instant ».
 *
 * ⚠️ Rafraîchie toutes les 30 s : sans cela, « à l'instant » resterait affiché
 * une heure durant, ce qui est un mensonge tranquille.
 */
function DateModification({ horodatage, auteur }) {
  const [, redessiner] = useState(0);

  useEffect(() => {
    if (!horodatage) return undefined;
    const minuterie = setInterval(() => redessiner((n) => n + 1), 30000);
    return () => clearInterval(minuterie);
  }, [horodatage]);

  if (!horodatage) return null;

  return (
    <span
      className="mr-1 hidden text-xs text-muted-foreground sm:inline"
      // L'auteur au survol : le nom complet allongerait la barre sur toutes les pages.
      title={auteur ? `Modifié par ${auteur}` : undefined}
    >
      Modifié {depuis(horodatage)}
    </span>
  );
}

/**
 * ⚠️ `navigator.clipboard` exige un contexte SÉCURISÉ — https, ou localhost.
 * En développement c'est le cas ; derrière un http:// nu il est absent, d'où le
 * garde et le message plutôt qu'une exception silencieuse.
 */
async function ecrireDansLePressePapiers(texte, succes) {
  if (!navigator.clipboard?.writeText) {
    toast.error('Copie impossible', {
      description: 'Le presse-papiers n’est accessible qu’en HTTPS.',
    });
    return;
  }

  try {
    await navigator.clipboard.writeText(texte);
    toast.success(succes);
  } catch {
    // Refus de permission, ou onglet sans le focus.
    toast.error('Copie impossible', { description: 'Le navigateur a refusé l’accès.' });
  }
}

function copierLien() {
  ecrireDansLePressePapiers(window.location.href, 'Lien copié');
}

/**
 * Le CONTENU, pas la page entière : la barre latérale et l'en-tête ne font pas
 * partie de ce qu'on veut coller dans un message ou un compte rendu.
 */
function copierContenu() {
  const contenu = document.querySelector('[data-contenu-page]');
  const texte = (contenu?.innerText ?? '').trim();

  if (texte === '') {
    toast.error('Rien à copier', { description: 'Cette page n’a pas encore de contenu.' });
    return;
  }

  ecrireDansLePressePapiers(texte, 'Contenu copié');
}
