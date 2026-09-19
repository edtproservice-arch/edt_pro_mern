import { useEffect } from 'react';
import { marquerVisitee } from '@/lib/visites';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ROLES } from 'shared/constants';
import { Separator } from '@/components/ui/separator';
import FilAriane from './FilAriane';
import BarreOutilsPage from './BarreOutilsPage';
import BarreNavigation, { LARGEUR_BARRE } from './BarreNavigation';
import { FournirLargeurPage } from './largeurPage';
import { FournirSansFilAriane } from './titrePage';
import { FournirEnTetePage } from './enTetePage';
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import BandeauUsurpation from './BandeauUsurpation';
import BandeauCollaboration from './BandeauCollaboration';
import BarreLaterale from './BarreLaterale';
import { ENTREES } from './navigation';
import SectionsConsultation from '@/features/consultation/SectionsConsultation';
import { recupererSession, seDeconnecter } from '@/features/auth/api';
import { classesAffichage, useAffichage } from '@/lib/preferencesAffichage';
import { useEpinglage } from '@/lib/epinglageBarre';
import { cn } from '@/lib/utils';
import { gererExpirationsession } from '@/lib/apiClient';

/** Le libellé de contexte affiché à côté du logo, dans la barre horizontale. */
const TITRE_SESSION = {
  [ROLES.FORMATEUR]: 'Formateur',
  [ROLES.STAGIAIRE]: 'Stagiaire',
  // L'administrateur qui collabore avec un établissement (2026-09-14).
  [ROLES.ADMIN]: 'Collaboration',
};

const DELAI_INACTIVITE_MS = 5 * 60 * 1000; // 5 minutes d'inactivité

/*
 * Ce qui compte comme « quelqu'un travaille » — TOUT geste, y compris le
 * glisser-déposer natif : pendant un glissement le navigateur n'émet plus de
 * `mousemove`, seulement `drag*`, et l'emploi du temps se travaille en grande
 * partie ainsi.
 */
const EVENEMENTS_ACTIVITE = [
  'pointerdown',
  'pointermove',
  'mousedown',
  'mousemove',
  'keydown',
  'wheel',
  'scroll',
  'touchstart',
  'click',
  'dragstart',
  'dragover',
  'drop',
  'input',
];

const VERIFICATION_INACTIVITE_MS = 10_000;

/**
 * Déconnexion automatique si l'utilisateur ne fait aucune action pendant 5
 * minutes.
 *
 * ═══ ⚠️ UN HORODATAGE, PAS UN MINUTEUR RELANCÉ (2026-09-19, signalé par le
 * porteur : « même si je travaille, la session expire ») ═══
 * La version précédente armait un `setTimeout` de 5 minutes et le relançait à
 * chaque geste. Elle tenait à deux hypothèses fausses :
 *   - que TOUT geste arrive jusqu'à `window` — or un composant qui appelle
 *     `stopPropagation()` (les boutons des cases de l'emploi du temps le font) le
 *     coupe avant, et l'écoute se faisait en phase de BULLE. On écoute
 *     maintenant en phase de CAPTURE, qui passe avant tout le monde ;
 *   - que le minuteur tire à l'heure — un onglet mis en veille ou ralenti le
 *     décale, dans un sens comme dans l'autre.
 *
 * Ici chaque geste ne fait qu'écrire l'heure (une affectation : rien à
 * annuler ni à réarmer, donc rien qui pèse sur la souris), et un contrôle
 * toutes les 10 secondes compare cette heure à maintenant. Le résultat ne
 * dépend plus de la ponctualité d'aucun minuteur.
 */
function useGestionInactivite(actif) {
  useEffect(() => {
    if (!actif) return;

    let derniere = Date.now();
    const noter = () => {
      derniere = Date.now();
    };

    const verifier = () => {
      if (Date.now() - derniere < DELAI_INACTIVITE_MS) return;
      clearInterval(controle);
      seDeconnecter().catch(() => {});
      gererExpirationsession('inactivite');
    };
    const controle = setInterval(verifier, VERIFICATION_INACTIVITE_MS);

    EVENEMENTS_ACTIVITE.forEach((evt) =>
      window.addEventListener(evt, noter, { passive: true, capture: true })
    );

    return () => {
      clearInterval(controle);
      EVENEMENTS_ACTIVITE.forEach((evt) => window.removeEventListener(evt, noter, { capture: true }));
    };
  }, [actif]);
}

/**
 * Coquille de l'application : barre latérale + en-tête + contenu.
 *
 * ═══ POURQUOI UNE COQUILLE, ET NON UNE BARRE PAR PAGE ═══
 * Les 30 pages HTML de l'existant recopiaient chacune leur barre de navigation.
 * Ajouter une entrée demandait 30 modifications, et certaines pages avaient
 * dérivé — c'est le même défaut structurel que le §4.2 relève pour le métier.
 * Ici la navigation est montée UNE fois, autour d'un `Outlet` : une page ne
 * décrit plus que son contenu.
 */
export default function CoquilleApp() {
  const { pathname } = useLocation();

  const affichage = useAffichage();
  const epinglee = useEpinglage();

  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });

  const utilisateur = session.data?.utilisateur;

  // Déconnexion automatique après 5 minutes d'inactivité
  useGestionInactivite(Boolean(utilisateur));

  // Redirection automatique si la session est expirée
  useEffect(() => {
    if (session.isError && session.error?.status === 401) {
      gererExpirationsession('expiration');
    }
  }, [session.isError, session.error]);

  /*
   * ⚠️ LA VISITE EST NOTÉE ICI, PAS DANS CHAQUE PAGE. La coquille est le seul
   * endroit qui voie TOUS les changements de route — l'inscrire page par page
   * en oublierait, et les « Récents » de l'accueil seraient incomplets sans
   * qu'on sache lesquelles manquent.
   *
   * L'accueil lui-même est écarté : il ne s'y trouverait rien à retrouver.
   */
  useEffect(() => {
    if (pathname !== '/app') marquerVisitee(pathname);
  }, [pathname]);

  // Le titre suit la route : l'entrée la plus SPÉCIFIQUE gagne, sans quoi
  // « /app/parametres/espaces » afficherait « Paramètres ».
  const courante = [...ENTREES]
    .sort((a, b) => b.url.length - a.url.length)
    .find((entree) => pathname.startsWith(entree.url));

  /*
   * ═══ ⚠️ FORMATEUR ET STAGIAIRE N'OUVRENT PAS LA COQUILLE DU DIRECTEUR ═══
   * (2026-09-03, demande du porteur : « réutiliser le navbar d'administrateur
   * … et annuler la page accueil ».)
   *
   * Trois ou quatre écrans ne justifient ni barre latérale, ni sélecteur
   * d'année, ni tableau de bord d'établissement — la barre HORIZONTALE de
   * l'espace admin (`BarreNavigation`) convient mieux, et sa première section
   * est déjà leur page d'arrivée (`AccueilRouteur` y renvoie) : il n'y a plus
   * d'Accueil à annuler, il cesse simplement d'exister pour ces deux rôles.
   *
   * ⚠️ TANT QUE LA SESSION N'A PAS RÉPONDU, ON NE RISQUE PAS LE MAUVAIS
   * ACCUEIL : `role` vaut `undefined` avant que `session` ne résolve, ce qui
   * ferait passer `estSession` pour faux et afficherait la coquille DIRECTEUR
   * un instant avant de basculer — un clignotement visible. `GardeRole` et
   * `AccueilRouteur` posent déjà la même garde.
   */
  const role = utilisateur?.role;
  /*
   * ═══ L'ADMINISTRATEUR EN COLLABORATION PREND LA MÊME COQUILLE (2026-09-14) ═══
   * Trois pages — celles qui se partagent — dans la barre horizontale, comme un
   * formateur invité : ni la barre latérale du directeur, ni son accueil
   * d'établissement ne lui sont ouverts.
   */
  const collaboration = session.data?.collaboration ?? null;
  const estSession =
    role === ROLES.FORMATEUR || role === ROLES.STAGIAIRE || (role === ROLES.ADMIN && Boolean(collaboration));

  if (session.isLoading) return null;
  // Un administrateur HORS collaboration n'a rien sous /app : son espace est /admin.
  if (role === ROLES.ADMIN && !collaboration) return <Navigate to="/admin" replace />;

  if (estSession) {
    return (
      <FournirEnTetePage>
      <SidebarProvider>
        <SidebarInset className="h-svh overflow-hidden">
          {/*
            ═══ ⚠️ LE BANDEAU D'USURPATION VAUT POUR LES QUATRE RÔLES ═══
            (2026-09-06, demande du porteur : « qu'il s'affiche dans toutes les
            sessions — directeur, gestionnaire, formateur, stagiaire — si je me
            connecte à travers l'admin ».) Il ne vivait que dans la coquille du
            directeur : un administrateur qui prenait la place d'un FORMATEUR ne
            voyait plus RIEN qui le lui dise, et ne pouvait même plus en sortir
            sans se déconnecter. C'est exactement la situation que ce bandeau
            existe pour empêcher.

            ⚠️ EN PREMIER, DONC TOUT EN HAUT : sous la barre, il se lisait comme
            un message de la page ; au-dessus, il encadre l'application entière —
            ce qu'il décrit. Frère du conteneur défilant, il ne bouge jamais.
          */}
          <BandeauUsurpation
            impersonateur={session.data?.impersonateur}
            utilisateur={utilisateur}
          />
          <BandeauCollaboration collaboration={collaboration} />

          <BarreNavigation
            titre={TITRE_SESSION[role]}
            liens={<SectionsConsultation role={role} />}
            messagerie
            // L'administrateur garde SA messagerie et n'a pas de profil sous /app.
            messagerieUrl={collaboration ? '/admin/messagerie' : '/app/messagerie'}
            profilUrl={collaboration ? undefined : '/app/profil'}
          />

          {/*
            ⚠️ LES MÊMES CLASSES QUE `ContenuPage`, PAS UNE APPROXIMATION —
            c'est la combinaison éprouvée par `PageMessagerieAdmin`, qui
            reproduit déjà cette coquille à l'identique pour l'espace admin.
          */}
          <div className="min-h-0 flex-1 overflow-x-clip overflow-y-auto p-6">
            {/*
              ⚠️ PAS DE TITRE ICI — il est rendu par `CadreReglage` (2026-09-05,
              correction du porteur). Posé dans cette coquille, il se collait au
              bord GAUCHE pendant que le contenu, lui, est centré dans un cadre
              dont la largeur change d'une page à l'autre (`large` ou non) :
              seule la page connaît sa propre largeur. Le texte, lui, vient
              toujours de `navigation.js` — `CadreReglage` l'y retrouve par la
              route.
            */}
            {/*
              ═══ LA LARGEUR EST CELLE DE LA BARRE, POUR TOUTE LA SESSION ═══
              (2026-09-06, demande du porteur.) Le défaut de `CadreReglage`
              (`max-w-4xl`, 896 px) coupait la dernière colonne des tableaux à
              neuf colonnes de « Suivi de l'avancement ». C'est la coquille qui
              tranche, une fois — pas chaque page, où le réglage finirait par
              être oublié sur la suivante.

              ⚠️ LA MESSAGERIE N'EST PAS CONCERNÉE (demande explicite du
              porteur), et elle ne l'est pas par construction : elle ne passe pas
              par `CadreReglage` — elle annule au contraire la marge de cette
              coquille (`-m-6`) pour toucher les quatre bords. Le contexte n'agit
              que sur les pages qui demandent un cadre.
            */}
            {/* ⚠️ PAS DE FIL D'ARIANE DANS CETTE COQUILLE : une page partagée y
                rend donc son propre titre (étape d2 bis, `titreDePage`). */}
            <FournirLargeurPage value={LARGEUR_BARRE}>
              <FournirSansFilAriane value>
                <Outlet />
              </FournirSansFilAriane>
            </FournirLargeurPage>
          </div>
        </SidebarInset>
      </SidebarProvider>
      </FournirEnTetePage>
    );
  }

  return (
    <FournirEnTetePage>
      <SidebarProvider>
      <BarreLaterale />

      {/*
        ⚠️ `print:h-auto print:overflow-visible` : sans cela, une page imprimée
        s'arrête à la hauteur de l'écran — le tableau de consultation, qui fait
        plusieurs pages, était tronqué au premier écran.
      */}
      <SidebarInset className="h-svh overflow-hidden print:h-auto print:overflow-visible">
        {/*
          ⚠️ AVANT L'EN-TÊTE (2026-09-06, demande du porteur : « il faut qu'il
          soit fixe en haut »). Posé DESSOUS, il se lisait comme un message de la
          page — et l'en-tête, avec son fil d'Ariane et ses outils, passait
          devant l'avertissement le plus important de l'écran. En tête de la
          colonne, il coiffe l'application entière, ce qu'il décrit.
        */}
        <BandeauUsurpation
          impersonateur={session.data?.impersonateur}
          utilisateur={utilisateur}
        />

        {/* La navigation ne s'imprime pas : ce qu'on met sur le papier, c'est le
            contenu de la page, jamais la barre d'outils qui y mène. */}
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b bg-background px-4 print:hidden">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <FilAriane courante={courante} />
          <BarreOutilsPage />
        </header>

        {/*
          Un `div`, pas un `main` : `SidebarInset` EST déjà le `<main>` de la
          page. En imbriquer un second casse le repère de navigation des
          lecteurs d'écran, qui n'en attendent qu'un.
        */}
        {/*
          `data-contenu-page` : c'est ce que « Copier le contenu de la page »
          lit. La barre latérale et l'en-tête n'ont rien à faire dans ce qu'on
          colle ensuite dans un message.

          Les classes d'affichage — petit texte, pleine largeur — s'appliquent
          ICI, sur le conteneur : elles agissent par héritage sur tout ce qui ne
          fixe pas sa propre taille, sans qu'aucune page ait à s'en occuper.
        */}
        <ContenuPage affichage={affichage} epinglee={epinglee}>
          <Outlet />
        </ContenuPage>
      </SidebarInset>
    </SidebarProvider>
      </FournirEnTetePage>
  );
}

/**
 * Le contenu de la page — et le repli AUTOMATIQUE de la barre latérale.
 *
 * ═══ ⚠️ AU CLIC, PAS AU POINTEUR ═══
 * Replier la barre DÉCALE toute la mise en page. Fait sur `pointerdown`, le
 * décalage arrive AVANT le relâchement : la case visée n'est plus sous le
 * curseur au moment du `mouseup`, et le clic tombe à côté — ou se perd. Sur
 * `click`, la cible a déjà reçu son événement, le repli ne peut plus lui nuire.
 *
 * ═══ ⚠️ SUR LE CONTENU, PAS SUR L'EN-TÊTE ═══
 * Le bouton de bascule vit dans l'en-tête : l'y inclure fermerait la barre dans
 * la foulée du clic qui vient de l'ouvrir. « La page », c'est ce qu'il y a
 * dessous.
 *
 * Sur MOBILE, la barre est un panneau superposé avec son propre voile, qui se
 * ferme déjà au clic extérieur : y ajouter ce repli n'apporterait rien et
 * toucherait un état (`openMobile`) que `setOpen` ne pilote pas.
 */
function ContenuPage({ affichage, epinglee, children }) {
  const { open, setOpen, isMobile } = useSidebar();

  return (
    <div
      data-contenu-page
      onClick={() => {
        // ⚠️ ÉPINGLÉE, la barre ne bouge plus : c'est tout l'objet du réglage.
        if (epinglee || isMobile || !open) return;
        setOpen(false);
      }}
      className={cn(
        'min-h-0 flex-1 overflow-x-clip overflow-y-auto p-6',
        'print:overflow-visible print:p-0',
        classesAffichage(affichage)
      )}
    >
      {children}
    </div>
  );
}

