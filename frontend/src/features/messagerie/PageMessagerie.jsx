import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Inbox,
  Mail,
  MailOpen,
  Reply,
  Search,
  Send,
  Trash2,
  Undo2,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Input } from '@/components/ui/input';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useDefaultLayout,
} from '@/components/ui/resizable';
import { Separator } from '@/components/ui/separator';
import { useSidebar } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';
import Alerte from '@/components/common/Alerte';
import { depuis } from '@/lib/derniereModification';
import { cn } from '@/lib/utils';
import { BOITES, VIDE } from './boites';
import {
  archiverMessage,
  chargerMessages,
  compterBoites,
  envoyerMessage,
  marquerNonLu,
  ouvrirMessage,
  restaurerMessage,
  supprimerBrouillon,
  supprimerMessage,
} from './api';
import Redaction from './Redaction';
import CarteInvitation from '@/features/partages/CarteInvitation';

/**
 * Messagerie interne (F10) — sous-livraison (a).
 * ← public/inbox.html (3 522 lignes) + api/messaging/*.php
 *   Mise en page reprise du bloc « mail » de shadcn (maquettes fournies par le
 *   porteur) : TROIS colonnes — les boîtes, la liste, le message.
 *
 * ═══ ⚠️ PLEINE PAGE, HORS DU CADRE DE RÉGLAGES ═══
 * `CadreReglage` centre un contenu de 110 rem au plus et laisse la page défiler
 * sous lui : une messagerie y flottait au milieu d'un grand vide. Ici l'écran
 * occupe toute la hauteur disponible et ce sont les COLONNES qui défilent,
 * chacune pour son compte — c'est ce que fait toute messagerie, et c'est ce qui
 * permet de parcourir une liste sans perdre le message ouvert.
 *
 * ═══ ⚠️ TROIS PANNEAUX REDIMENSIONNABLES, PAS TROIS COLONNES FIGÉES ═══
 * Les largeurs fixes (13 rem · 24 rem) tenaient sur un grand écran et
 * étranglaient le message sur un portable. `react-resizable-panels` raisonne en
 * POURCENTAGES : la mise en page suit la fenêtre d'elle-même, et la poignée
 * laisse rendre au message la place que la liste ne lui rendait pas.
 *
 * ⚠️ LES PROPOSITIONS D'EDT NE SONT PAS ICI. Elles forment la sous-livraison (b)
 * — elles ÉCRIVENT dans les séances, et un défaut d'affichage ne doit pas se
 * découvrir en même temps qu'un défaut d'écriture.
 */
/* ⚠️ MÊMES IDENTIFIANTS QUE LES PANNEAUX, ET DANS LEUR ORDRE : c'est sur eux que
   la disposition enregistrée se rattache. Un écart, et elle se réapplique de
   travers — le rail prendrait la largeur du message. */
const PANNEAUX = ['boites', 'liste', 'lecture'];

/* Largeur du rail en dessous de laquelle « Brouillons » ne tient plus à côté de
   son icône : il passe alors en icônes seules. Mesurée sur le libellé le plus
   long, marge intérieure comprise. */
const SEUIL_RAIL = 146;

export default function PageMessagerie() {
  const cache = useQueryClient();
  const { isMobile } = useSidebar();

  /*
   * ⚠️ LES LARGEURS SONT UNE PRÉFÉRENCE DE POSTE, gardée en `localStorage`
   * comme l'épingle de la barre latérale et les réglages d'affichage : le même
   * directeur peut vouloir une liste large sur son grand écran et étroite sur
   * son portable. Les remettre à zéro à chaque visite ferait refaire le réglage
   * tous les matins. Elle ne part jamais au serveur.
   */
  const largeurs = useDefaultLayout({ id: 'messagerie', panelIds: PANNEAUX });

  /*
   * ⚠️ AU PLUS ÉTROIT, LE RAIL NE GARDE QUE SES ICÔNES. Les libellés ne tenaient
   * plus : ils débordaient du panneau et se peignaient PAR-DESSUS la liste
   * (constaté par le porteur). Un rail d'icônes est un état à part entière — la
   * barre latérale de l'application fait exactement la même chose en mode replié
   * — et non un affichage tronqué qu'on subit.
   *
   * Le seuil est en PIXELS, pas en pourcentage : c'est la place qu'il faut pour
   * lire « Brouillons », et elle ne dépend pas de la largeur de la fenêtre.
   */
  const [rail, setRail] = useState(null);
  const railEtroit = useEtroit(rail, SEUIL_RAIL);
  const [nonLusSeuls, setNonLusSeuls] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [redaction, setRedaction] = useState(null);

  /*
   * ═══ ⚠️ LA BOÎTE ET LE MESSAGE OUVERT VIVENT DANS L'ADRESSE ═══
   * Sur mobile, la liste et le message occupent tour à tour tout l'écran. Le
   * geste « retour » du téléphone doit donc ramener à la LISTE — gardé dans un
   * état React, il quittait la messagerie entière. Ouvrir un message sur mobile
   * EMPILE une entrée d'historique ; sur grand écran, où liste et message sont
   * côte à côte, on REMPLACE : passer d'un message à l'autre ne doit pas remplir
   * l'historique.
   *
   * ⚠️ LA BOÎTE Y EST AUSSI : un rechargement sur un message archivé le rouvrirait
   * sinon avec les actions de la réception (« Archiver » un message déjà archivé).
   */
  const [parametres, setParametres] = useSearchParams();
  const emplacement = useLocation();
  const naviguer = useNavigate();
  const boiteDemandee = parametres.get('boite');
  const boite = BOITES.some((entree) => entree.cle === boiteDemandee) ? boiteDemandee : 'reception';
  const ouvert = parametres.get('message');

  const allerA = ({ vers = boite, message = null }, empiler = false) => {
    const suivants = new URLSearchParams();
    if (vers !== 'reception') suivants.set('boite', vers);
    if (message) suivants.set('message', message);
    setParametres(suivants, empiler ? { state: { depuisListe: true } } : { replace: true });
  };

  /*
   * ⚠️ FERMER REVIENT EN ARRIÈRE quand c'est l'ouverture qui a empilé l'entrée :
   * la retirer à nouveau (`replace`) laisserait deux fois la liste dans
   * l'historique, et le geste « retour » suivant paraîtrait sans effet.
   */
  const fermer = () => {
    if (!ouvert) return;
    if (emplacement.state?.depuisListe) naviguer(-1);
    else allerA({ message: null });
  };
  const champReponse = useRef(null);

  const liste = useQuery({
    queryKey: ['messages', boite],
    queryFn: () => chargerMessages({ boite }),
    retry: false,
  });

  const compteurs = useQuery({
    queryKey: ['messages', 'boites'],
    queryFn: compterBoites,
    retry: false,
  });

  const message = useQuery({
    queryKey: ['message', ouvert],
    queryFn: () => ouvrirMessage(ouvert),
    // ⚠️ Un BROUILLON ne s'ouvre pas dans le volet de lecture : il se reprend
    // dans la fenêtre de rédaction. Le demander au serveur ferait un 404.
    enabled: Boolean(ouvert) && boite !== 'brouillons',
    retry: false,
  });

  /** Toute action sur un message : la liste et les compteurs sont relus. */
  const rafraichir = () => {
    fermer();
    cache.invalidateQueries({ queryKey: ['messages'] });
  };

  /*
   * ⚠️ SIX APPELS ÉCRITS EN TOUTES LETTRES, pas une boucle ni un helper qui
   * appellerait `useMutation` : un hook doit être invoqué au même endroit et
   * dans le même ordre à chaque rendu. Les cacher derrière une fonction locale
   * « marche » tant que le nombre d'appels ne bouge pas — et casse le jour où il
   * bouge, sans que rien ne l'annonce.
   */
  const retirer = useMutationSimple(supprimerMessage, {
    titre: 'Message retiré',
    detail: 'Il est dans votre corbeille ; votre correspondant garde le sien.',
  }, rafraichir);
  const archiver = useMutationSimple((id) => archiverMessage(id, true), { titre: 'Message archivé' }, rafraichir);
  const desarchiver = useMutationSimple((id) => archiverMessage(id, false), { titre: 'Message remis dans sa boîte' }, rafraichir);
  const restaurer = useMutationSimple(restaurerMessage, { titre: 'Message restauré' }, rafraichir);
  const jeterBrouillon = useMutationSimple(supprimerBrouillon, { titre: 'Brouillon supprimé' }, rafraichir);
  /*
   * ⚠️ MARQUER NON LU REFERME LE MESSAGE — c'est `rafraichir` qui s'en charge.
   * Le laisser ouvert le ferait remarquer lu à la première relecture, et le
   * geste paraîtrait sans effet. C'est aussi ce que fait toute messagerie : on
   * marque non lu pour Y REVENIR, donc on retourne à la liste.
   */
  const marquerNonLue = useMutationSimple(marquerNonLu, {
    titre: 'Message marqué non lu',
    detail: 'Il vous attend dans votre boîte de réception.',
  }, rafraichir);

  const tous = liste.data?.messages ?? [];

  /*
   * ⚠️ LE FILTRE EST LOCAL, pas une requête. Une page en compte 25 : les
   * renvoyer au serveur à chaque frappe ferait un aller-retour pour trier ce
   * qu'on a déjà sous les yeux.
   */
  const messages = useMemo(() => {
    const terme = recherche.trim().toLowerCase();

    return tous.filter((entree) => {
      if (nonLusSeuls && entree.lu) return false;
      if (terme === '') return true;
      return `${entree.correspondant.nom} ${entree.sujet} ${entree.corps}`
        .toLowerCase()
        .includes(terme);
    });
  }, [tous, recherche, nonLusSeuls]);

  const changerBoite = (valeur) => {
    if (valeur !== boite || ouvert) allerA({ vers: valeur });
    /* ⚠️ « Non lus » n'a de sens QUE dans la boîte de réception : ailleurs, le
       filtre viderait la liste sans que rien ne l'explique. */
    if (valeur !== 'reception') setNonLusSeuls(false);
  };

  const ouvrirEntree = (entree) => {
    // Un brouillon se REPREND, il ne se lit pas.
    if (entree.brouillon) {
      setRedaction({
        id: entree.id,
        destinataires: entree.destinataires ?? [],
        sujet: entree.sujet,
        corps: entree.corps,
        reponseA: entree.reponseA ?? undefined,
      });
      return;
    }

    // Sur mobile le message REMPLACE la liste : l'ouverture s'empile, pour que
    // le geste « retour » y ramène. Déjà ouvert, on remplace (message suivant).
    allerA({ message: entree.id }, isMobile && !ouvert);
    // Ouvrir MARQUE LU côté serveur : liste et compteurs doivent être relus.
    cache.invalidateQueries({ queryKey: ['messages'] });
  };

  /* Les trois pièces sont écrites UNE fois et posées par les deux mises en page :
     deux copies de la liste ou du volet de lecture divergeraient au premier
     ajustement. */
  const enteteListe = (
    <>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 className="truncate text-lg font-semibold">
          {BOITES.find((entree) => entree.cle === boite)?.libelle}
        </h2>

        {boite === 'reception' && (
          <ButtonGroup>
            <Onglet actif={!nonLusSeuls} onClick={() => setNonLusSeuls(false)}>
              Tous
            </Onglet>
            <Onglet actif={nonLusSeuls} onClick={() => setNonLusSeuls(true)}>
              Non lus
            </Onglet>
          </ButtonGroup>
        )}
      </div>

      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={recherche}
            onChange={(evenement) => setRecherche(evenement.target.value)}
            placeholder="Rechercher…"
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      <Separator />
    </>
  );

  /* Le contenu du rail — « Écrire » puis les boîtes —, posé par les deux mises
     en page : large ou en icônes sur grand écran, toujours en icônes sur mobile. */
  const contenuRail = (etroit) => (
    <>
      <BoutonEcrire etroit={etroit} onClick={() => setRedaction({})} />

      {BOITES.map((entree) => (
        <Boite
          key={entree.cle}
          actif={boite === entree.cle}
          etroit={etroit}
          icone={entree.icone}
          libelle={entree.libelle}
          compte={compteurs.data?.boites?.[entree.cle]}
          onClick={() => changerBoite(entree.cle)}
        />
      ))}
    </>
  );

  const listeMessages = (
    <Liste
      messages={messages}
      vide={tous.length === 0}
      boite={boite}
      chargement={liste.isLoading}
      ouvert={ouvert}
      onOuvrir={ouvrirEntree}
    />
  );

  const lecture = (
    <Lecture
      requete={message}
      ouvert={ouvert}
      boite={boite}
      champReponse={champReponse}
      onRetour={isMobile ? fermer : undefined}
      onSupprimer={() => retirer.mutate(ouvert)}
      onArchiver={() => archiver.mutate(ouvert)}
      onDesarchiver={() => desarchiver.mutate(ouvert)}
      onRestaurer={() => restaurer.mutate(ouvert)}
      onNonLu={() => marquerNonLue.mutate(ouvert)}
      enCours={
        retirer.isPending ||
        archiver.isPending ||
        desarchiver.isPending ||
        restaurer.isPending ||
        marquerNonLue.isPending
      }
      onEnvoye={() => cache.invalidateQueries({ queryKey: ['messages'] })}
    />
  );

  return (
    /*
     * ═══ ⚠️ PLEIN CADRE : LA PAGE ANNULE SA PROPRE MARGE ═══
     * `ContenuPage` pose `p-6` sur TOUTES les pages — juste pour un écran de
     * réglages, faux pour une messagerie, qui doit toucher les bords comme la
     * barre latérale. `-m-6` la reprend, et la hauteur suit : `100%` du contenu
     * PLUS les 3 rem que la marge vient de rendre.
     *
     * ⚠️ EN POURCENTAGE, JAMAIS EN `100svh` MOINS UNE CONSTANTE. La hauteur de
     * l'en-tête est une valeur qu'il faudrait tenir à jour ici, et le bandeau
     * d'usurpation la change à lui seul : l'écran débordait alors du bas, sans
     * que rien ne le signale.
     */
    <div className="-m-6 flex h-[calc(100%+3rem)] flex-col overflow-hidden">
      {liste.isError ? (
        <Alerte type="erreur" titre="Messagerie indisponible">
          {liste.error.message}
        </Alerte>
      ) : isMobile ? (
        /*
         * ═══ ⚠️ SUR MOBILE : LA LISTE, PUIS LE MESSAGE — JAMAIS LES DEUX ═══
         * Les trois panneaux EMPILÉS (première version) donnaient à chacun un
         * tiers d'écran : le rail mangeait le haut, la liste tenait deux lignes,
         * et le message s'ouvrait sous le pli, loin du doigt qui venait de le
         * choisir (constaté par le porteur). Ici : le rail d'icônes à gauche — la
         * forme du rail replié sur grand écran, badge de non-lus compris — la
         * liste à côté, et le message, une fois choisi, prend TOUT l'écran, avec
         * un retour.
         *
         * ⚠️ UN RAIL VERTICAL, PAS UNE RANGÉE DE BOÎTES (décision du porteur) :
         * les six icônes tiennent en 56 px de large, sans rien faire défiler de
         * côté, et la liste garde toute la hauteur.
         */
        ouvert ? (
          lecture
        ) : (
          <div className="flex min-h-0 flex-1">
            <nav className="flex w-14 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r p-2">
              {contenuRail(true)}
            </nav>

            <div className="flex min-w-0 flex-1 flex-col">
              {enteteListe}
              {listeMessages}
            </div>
          </div>
        )
      ) : (
        <ResizablePanelGroup {...largeurs} orientation="horizontal" className="min-h-0 flex-1">
          {/* ── 1. Les boîtes ──────────────────────────────────────────── */}
          {/*
            ⚠️ `minSize` EN PIXELS (un NOMBRE en v4), quand `defaultSize` et
            `maxSize` sont en pourcentage (des CHAÎNES) : le rail doit pouvoir
            se réduire à la largeur d'une icône, et cette largeur ne dépend pas
            de la taille de la fenêtre. Les unités se mélangent, c'est prévu.
          */}
          <ResizablePanel id="boites" defaultSize="16" minSize={56} maxSize="30">
            {/* ⚠️ `overflow-x-hidden` : sans lui, un libellé plus large que le
                panneau se peint par-dessus la liste au lieu d'être coupé. */}
            <nav
              ref={setRail}
              className={cn(
                'flex h-full flex-col gap-1 overflow-y-auto overflow-x-hidden p-2',
                railEtroit && 'items-center'
              )}
            >
              {contenuRail(railEtroit)}
            </nav>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* ── 2. La liste ────────────────────────────────────────────── */}
          <ResizablePanel id="liste" defaultSize="30" minSize="20" maxSize="55">
            <div className="flex h-full min-h-0 flex-col">
              {enteteListe}
              {listeMessages}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* ── 3. Le message ──────────────────────────────────────────── */}
          <ResizablePanel id="lecture" defaultSize="54" minSize="25">
            {lecture}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {redaction && (
        <Redaction
          initial={redaction}
          onFermer={() => setRedaction(null)}
          onSupprimerBrouillon={(id) => {
            setRedaction(null);
            jeterBrouillon.mutate(id);
          }}
          onEnvoye={() => {
            setRedaction(null);
            cache.invalidateQueries({ queryKey: ['messages'] });
          }}
        />
      )}
    </div>
  );
}

/**
 * « Cet élément est-il plus étroit que N pixels ? »
 *
 * Un `ResizeObserver` plutôt que le `onResize` du panneau : il mesure
 * l'ÉLÉMENT, sans dépendre de l'ordre d'enregistrement des panneaux, et répond
 * donc aussi quand c'est la FENÊTRE qui rétrécit, sans qu'on ait touché à la
 * poignée. (Les deux reposent de toute façon sur un `ResizeObserver` : celui de
 * la bibliothèque observe l'élément du panneau.)
 *
 * ⚠️ L'ÉTAT NE CHANGE QU'AU FRANCHISSEMENT DU SEUIL : le poser à chaque pixel
 * ferait un rendu par trame pendant tout le glissement.
 */
function useEtroit(element, seuil) {
  const [etroit, setEtroit] = useState(false);

  /*
   * ⚠️ L'ÉLÉMENT, PAS UNE `ref` : sur mobile le rail n'est pas monté. Une `ref`
   * resterait vide quand on repasse en grand écran (rotation, fenêtre élargie),
   * et l'effet — qui ne dépendrait que de l'objet `ref`, stable — ne se
   * relancerait jamais. Passé par une ref de rappel, l'élément relance l'effet.
   */
  useEffect(() => {
    if (!element) return undefined;

    /*
     * ⚠️ UNE SEULE DÉFINITION DE LA MESURE, et c'est `getBoundingClientRect` :
     * le `contentRect` de l'observateur exclut la marge intérieure, la première
     * mesure l'inclut. Deux références différentes feraient basculer le rail à
     * deux largeurs différentes selon la façon dont on y arrive.
     */
    const mesurer = () => setEtroit(element.getBoundingClientRect().width < seuil);

    /*
     * ⚠️ ON MESURE UNE PREMIÈRE FOIS À LA MAIN, sans attendre l'observateur.
     * Sa toute première notification passe par le cycle de rendu du navigateur,
     * qui peut tarder — et la largeur d'ouverture vient du stockage : un rail
     * enregistré étroit doit s'afficher en icônes DÈS le premier rendu, pas
     * après un aller-retour.
     */
    mesurer();

    const observateur = new ResizeObserver(mesurer);
    observateur.observe(element);
    return () => observateur.disconnect();
  }, [element, seuil]);

  return etroit;
}

/** Une mutation qui prévient, puis rafraîchit. */
function useMutationSimple(fonction, reussite, apres) {
  return useMutation({
    mutationFn: fonction,
    onSuccess: () => {
      toast.success(reussite.titre, { description: reussite.detail });
      apres();
    },
    onError: (erreur) => toast.error('Action impossible', { description: erreur.message }),
  });
}

/**
 * Une boîte, dans la colonne de gauche.
 *
 * ⚠️ LE COMPTE NE S'AFFICHE QU'AU-DELÀ DE ZÉRO — comme la pastille du menu. Un
 * « 0 » permanent se lit comme quelque chose à traiter.
 *
 * ═══ ⚠️ EN RAIL ÉTROIT, LE COMPTE DEVIENT UNE PASTILLE ═══
 * Le nombre ne tient plus à côté de l'icône. Le supprimer ferait perdre le seul
 * signal de ce qui reste à lire — précisément ce qu'on vient chercher dans un
 * rail. Il passe donc en pastille sur le coin de l'icône, comme la barre
 * latérale de l'application le fait déjà.
 */
function Boite({ actif, etroit, icone: Icone, libelle, compte, onClick }) {
  const bouton = (
    <button
      type="button"
      onClick={onClick}
      aria-current={actif ? 'page' : undefined}
      /* ⚠️ Le libellé reste dans le nom accessible même masqué : un lecteur
         d'écran n'a rien d'autre à annoncer qu'une icône. */
      aria-label={etroit ? libelle : undefined}
      className={cn(
        'flex items-center rounded-md text-sm transition-colors',
        etroit ? 'relative size-9 shrink-0 justify-center' : 'w-full gap-2 px-2 py-1.5',
        actif ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
      )}
    >
      <Icone className="size-4 shrink-0" />

      {etroit ? (
        compte > 0 && (
          <span
            className={cn(
              'absolute -right-0.5 -top-0.5 min-w-4 rounded-full px-1 text-[0.6rem] font-medium leading-4 tabular-nums',
              actif ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground'
            )}
          >
            {compte}
          </span>
        )
      ) : (
        <>
          <span className="flex-1 truncate text-left">{libelle}</span>
          {compte > 0 && (
            <span className={cn('text-xs tabular-nums', !actif && 'text-muted-foreground')}>
              {compte}
            </span>
          )}
        </>
      )}
    </button>
  );

  /* L'infobulle N'EXISTE QU'EN RAIL ÉTROIT : ailleurs le libellé est écrit, et
     une bulle qui redit ce qu'on lit ne fait que gêner. */
  if (!etroit) return bouton;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{bouton}</TooltipTrigger>
      <TooltipContent side="right">
        {libelle}
        {compte > 0 && ` · ${compte}`}
      </TooltipContent>
    </Tooltip>
  );
}

/** « Écrire » — le seul bouton d'ACTION du rail, donc le seul en bleu plein. */
function BoutonEcrire({ etroit, onClick }) {
  const bouton = (
    <Button
      variant="outline"
      size="sm"
      aria-label={etroit ? 'Écrire' : undefined}
      className={cn('mb-1 shrink-0 text-xs', etroit ? 'size-9 p-0' : 'h-8 w-full gap-1.5')}
      onClick={onClick}
    >
      <Mail className="size-3.5" />
      {!etroit && 'Écrire'}
    </Button>
  );

  if (!etroit) return bouton;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{bouton}</TooltipTrigger>
      <TooltipContent side="right">Écrire un message</TooltipContent>
    </Tooltip>
  );
}

const Onglet = ({ actif, onClick, children }) => (
  <Button
    variant={actif ? 'default' : 'outline'}
    size="sm"
    className="h-7 px-2 text-xs"
    aria-pressed={actif}
    onClick={onClick}
  >
    {children}
  </Button>
);

/**
 * La liste des messages, en CARTES séparées — c'est la forme de la maquette.
 *
 * ⚠️ LE NON-LU SE VOIT AU NOM EN GRAS ET À LA PASTILLE, pas seulement à une
 * teinte de fond : sur vingt lignes, une nuance de gris ne se repère pas.
 *
 * ⚠️ L'EXTRAIT EST BORNÉ À DEUX LIGNES (`line-clamp-2`) : sans borne, un message
 * de trente lignes chasserait tous les autres hors de l'écran, et la liste ne
 * servirait plus à choisir.
 */
function Liste({ messages, vide, boite, chargement, ouvert, onOuvrir }) {
  if (chargement) {
    return <p className="p-8 text-center text-sm text-muted-foreground">Chargement…</p>;
  }

  if (messages.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-muted-foreground">
        <Inbox className="mx-auto mb-2 size-5 opacity-50" />
        {/* ⚠️ « Rien ne correspond » et « la boîte est vide » sont DEUX états
            différents : les confondre ferait chercher un message qu'un filtre
            masque. */}
        {vide ? VIDE[boite] : 'Aucun message ne correspond à ce filtre.'}
      </p>
    );
  }

  return (
    <ul className="min-h-0 flex-1 overflow-y-auto p-0">
      {messages.map((message) => (
        <li key={message.id}>
          <button
            type="button"
            onClick={() => onOuvrir(message)}
            className={cn(
              /*
               * ⚠️ LE MESSAGE OUVERT SE SIGNALE PAR SON FOND, PAS PAR UN CADRE
               * BLEU (demande du porteur). Le bleu est la couleur de la boîte
               * ACTIVE dans le rail : le poser aussi sur une carte faisait deux
               * marques bleues pour deux choses différentes.
               */
              'w-full space-y-1 border-b p-3 text-left transition-colors hover:bg-muted/50',
              ouvert === message.id && 'bg-muted'
            )}
          >
            <span className="flex items-baseline gap-2">
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-sm',
                  !message.lu ? 'font-semibold' : 'font-medium'
                )}
              >
                {message.correspondant.nom}
              </span>

              {!message.lu && (
                <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
              )}

              <span className="shrink-0 text-[0.65rem] text-muted-foreground">
                {depuis(new Date(message.date).getTime())}
              </span>
            </span>

            {/* ⚠️ Un brouillon sans sujet est NOMMÉ : une ligne vide laisserait
                croire à un défaut, alors que c'est son état normal. */}
            <span className="block truncate text-xs font-medium">
              {message.sujet || <span className="italic text-muted-foreground">Sans sujet</span>}
            </span>

            <span className="line-clamp-2 block text-xs text-muted-foreground">
              {message.corps}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Le message ouvert : barre d'actions, en-tête, corps, réponse en place. */
function Lecture({
  requete,
  ouvert,
  boite,
  champReponse,
  enCours,
  onRetour,
  onSupprimer,
  onArchiver,
  onDesarchiver,
  onRestaurer,
  onNonLu,
  onEnvoye,
}) {
  if (boite === 'brouillons') {
    return (
      <p className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
        Un brouillon se reprend dans la fenêtre de rédaction : cliquez-le pour l’ouvrir.
      </p>
    );
  }

  if (!ouvert) {
    return (
      <p className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
        Choisissez un message pour le lire.
      </p>
    );
  }

  /* Sur mobile, le retour doit rester atteignable même pendant l'ouverture ou
     après un échec : sans lui, l'écran n'aurait plus aucune sortie. */
  const retour = onRetour && (
    <Action icone={ArrowLeft} titre="Retour à la liste" onClick={onRetour} />
  );

  if (requete.isLoading || requete.isError) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {retour && <div className="px-3 py-2">{retour}</div>}
        <p className={cn('p-6 text-sm', requete.isError ? 'text-destructive' : 'text-muted-foreground')}>
          {requete.isError ? requete.error.message : 'Ouverture du message…'}
        </p>
      </div>
    );
  }

  const message = requete.data.message;
  const repondable = Boolean(message.correspondant.id) && boite !== 'corbeille';

  return (
    <article className="flex h-full min-h-0 flex-col">
      {/*
        ⚠️ LA BARRE D'ACTIONS SUIT LA BOÎTE. Dans la corbeille, « archiver » n'a
        pas de sens et « restaurer » est la seule chose qu'on vienne y faire ;
        dans l'archive, c'est l'inverse. Afficher les quatre partout donnerait des
        boutons sans effet, et on chercherait pourquoi.
      */}
      <div className="flex items-center gap-1 px-3 py-2">
        {retour && (
          <>
            {retour}
            <Separator orientation="vertical" className="mx-1 h-5" />
          </>
        )}

        {boite === 'corbeille' ? (
          <Action icone={Undo2} titre="Sortir de la corbeille" onClick={onRestaurer} disabled={enCours} />
        ) : boite === 'archive' ? (
          <Action
            icone={ArchiveRestore}
            titre="Remettre dans sa boîte"
            onClick={onDesarchiver}
            disabled={enCours}
          />
        ) : (
          <Action icone={Archive} titre="Archiver" onClick={onArchiver} disabled={enCours} />
        )}

        {boite !== 'corbeille' && (
          <Action
            icone={Trash2}
            titre="Mettre à la corbeille"
            onClick={onSupprimer}
            disabled={enCours}
            destructif
          />
        )}

        {/*
          ⚠️ SEUL UN MESSAGE REÇU SE MARQUE NON LU : `lu` décrit MA lecture, et
          je n'en ai aucune sur ce que j'envoie. C'est `recu` qui tranche, PAS la
          boîte — l'archive et la corbeille mêlent les deux sens.
        */}
        {message.recu && (
          <Action icone={MailOpen} titre="Marquer non lu" onClick={onNonLu} disabled={enCours} />
        )}

        {repondable && (
          <Action
            icone={Reply}
            titre="Répondre"
            /* La zone de réponse est en bas : on y amène le curseur plutôt que
               d'ouvrir une fenêtre, sinon le message d'origine sort de vue. */
            onClick={() => champReponse.current?.focus()}
          />
        )}

        <span className="ml-auto text-xs text-muted-foreground">
          {new Date(message.date).toLocaleString('fr-FR', {
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>

      <Separator />

      <header className="flex gap-3 p-4">
        <Initiales nom={message.correspondant.nom} />

        <div className="min-w-0">
          <p className="text-sm font-semibold">{message.correspondant.nom}</p>
          <p className="truncate text-sm">{message.sujet}</p>
          {/*
            ⚠️ « REÇU OU ENVOYÉ » VIENT DU SERVEUR, PAS DE LA BOÎTE. La règle
            précédente — `boite === 'envoyes'` — se trompait dans l'archive et
            dans la corbeille, qui mêlent les deux sens : un message que j'avais
            envoyé puis archivé s'y annonçait « Reçu ».
          */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {message.recu ? 'Reçu' : 'Envoyé'}
            {message.correspondant.role && ` · ${message.correspondant.role}`}
          </p>
        </div>
      </header>

      <Separator />

      {/*
        ⚠️ `whitespace-pre-wrap` : les retours à la ligne du rédacteur sont la
        seule mise en forme dont il dispose. Les perdre transforme une liste de
        points en un paragraphe illisible.
      */}
      <p className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap p-4 text-sm leading-relaxed">
        {message.corps}
      </p>

      {/* L'invitation à collaborer, quand le message en porte une. */}
      <CarteInvitation message={message} />

      {/*
        ⚠️ LA RÉPONSE SE SAISIT EN PLACE, PAS DANS UNE MODALE — c'est le gain du
        bloc, et il est réel : répondre est le geste le plus fréquent, et une
        fenêtre à ouvrir puis à refermer met le message d'origine hors de vue au
        moment précis où l'on écrit la réponse.

        ⚠️ Pas de réponse depuis la CORBEILLE : on n'écrit pas depuis un message
        qu'on vient de jeter.
      */}
      {repondable && <ReponseRapide message={message} champ={champReponse} onEnvoye={onEnvoye} />}
    </article>
  );
}

const Action = ({ icone: Icone, titre, onClick, disabled, destructif }) => (
  <Button
    variant="ghost"
    size="icon"
    title={titre}
    disabled={disabled}
    onClick={onClick}
    className={cn('size-8', destructif && 'text-destructive hover:bg-destructive/10 hover:text-destructive')}
  >
    <Icone className="size-4" />
    <span className="sr-only">{titre}</span>
  </Button>
);

function ReponseRapide({ message, champ, onEnvoye }) {
  const [corps, setCorps] = useState('');

  const envoi = useMutation({
    mutationFn: () =>
      envoyerMessage({
        destinataires: [message.correspondant.id],
        // ⚠️ « Re: » n'est ajouté qu'une fois : sur un fil qui va et vient, le
        // sujet finirait en « Re: Re: Re: ».
        sujet: message.sujet.startsWith('Re:') ? message.sujet : `Re: ${message.sujet}`,
        corps,
        reponseA: message.id,
      }),
    onSuccess: () => {
      setCorps('');
      toast.success('Réponse envoyée');
      onEnvoye();
    },
    onError: (erreur) => toast.error('Envoi impossible', { description: erreur.message }),
  });

  return (
    <div className="space-y-2 border-t p-3">
      <Textarea
        ref={champ}
        value={corps}
        onChange={(evenement) => setCorps(evenement.target.value)}
        placeholder={`Répondre à ${message.correspondant.nom}…`}
        rows={3}
        className="text-sm"
      />

      <div className="flex justify-end">
        <Button
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={corps.trim() === '' || envoi.isPending}
          onClick={() => envoi.mutate()}
        >
          <Send className="size-3.5" />
          {envoi.isPending ? 'Envoi…' : 'Envoyer'}
        </Button>
      </div>
    </div>
  );
}

/**
 * Les initiales du correspondant.
 *
 * ⚠️ DEUX LETTRES AU PLUS : les noms de la base font jusqu'à quatre mots
 * (« ABDESSAMAD AIT TALEB »), et une pastille de 40 px n'en contient pas plus.
 */
function Initiales({ nom }) {
  const lettres = String(nom ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((mot) => mot[0] ?? '')
    .join('')
    .toUpperCase();

  return (
    <Avatar className="size-10 shrink-0">
      <AvatarFallback className="text-xs">{lettres || '?'}</AvatarFallback>
    </Avatar>
  );
}
