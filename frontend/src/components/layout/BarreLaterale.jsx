import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import MenuUtilisateur from './MenuUtilisateur';
import BoutonEpingle from './BoutonEpingle';
import SelecteurAnnee from './SelecteurAnnee';
import { ENTREES, navigationPourRole, raccourcisPourRole } from './navigation';
import { usePartagesAvecMoi } from '@/features/partages/usePartagesAvecMoi';
import CartePagesPartagees from '@/features/partages/CartePagesPartagees';
import { useFavoris } from '@/lib/favoris';
import { compterNonLus } from '@/features/messagerie/api';
import { recupererSession } from '@/features/auth/api';

/**
 * Barre latérale de l'application.
 * ← `npx shadcn add sidebar-06`, dont la donnée d'exemple est remplacée par
 *   `navigation.js` et les liens `<a href>` par des `NavLink`.
 *
 * ═══ DEUX ÉCARTS AVEC LE BLOC D'ORIGINE ═══
 * 1. Le sous-menu s'ouvre EN PLACE et non dans un menu flottant. Les neuf
 *    réglages de « Paramètres » se lisent alors d'un coup, et l'entrée ouverte
 *    reste visible pendant qu'on navigue dedans — un menu flottant se referme
 *    à chaque clic.
 * 2. Les liens passent par `NavLink` : le routeur gère l'état actif, alors
 *    qu'un `<a href>` rechargerait toute l'application à chaque clic.
 */
/**
 * Le nombre de messages non lus, dans le menu.
 *
 * ⚠️ INTERROGATION PÉRIODIQUE, PAS SSE (décision du porteur, 2026-08-25). Une
 * minute suffit pour un compteur, et cela n'ajoute ni route à flux, ni gestion
 * de reconnexion, ni réglage Nginx. Le plan prévoit SSE en Phase 9 : on pourra
 * y passer sans rien changer à l'écran, seule la source du nombre changera.
 *
 * ⚠️ `refetchOnWindowFocus` : revenir sur l'onglet est le moment où l'on
 * s'attend le plus à voir le compteur à jour — attendre la minute suivante
 * afficherait un nombre qu'on sait faux.
 */
function CompteurMessages() {
  const { data } = useQuery({
    queryKey: ['messages', 'non-lus'],
    queryFn: compterNonLus,
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  if (!data?.nonLus) return null;

  return <SidebarMenuBadge>{data.nonLus}</SidebarMenuBadge>;
}

export default function BarreLaterale(proprietes) {
  const { pathname } = useLocation();

  /*
   * ⚠️ LE MÊME `['session']` QUE LA COQUILLE ET LE FIL D'ARIANE — le cache de
   * TanStack Query le sert une seule fois, pas une requête par consommateur.
   * C'est LUI qui décide du menu à monter : un directeur, un gestionnaire, un
   * formateur et un stagiaire n'ouvrent pas la même porte.
   */
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  // Les pages partagées avec cette personne s'ajoutent à son menu (invitations).
  const { pages: partages } = usePartagesAvecMoi();
  const navigation = navigationPourRole(session.data?.utilisateur?.role, { partages });
  /* ⚠️ Les raccourcis suivent le rôle EUX AUSSI : le gestionnaire n'a pas
     d'accueil (voir `raccourcisPourRole`). */
  const raccourcis = raccourcisPourRole(session.data?.utilisateur?.role);
  /*
   * ⚠️ « Partagé » a un sous-menu, mais ce n'est pas un réglage : il reste dans le
   * groupe Navigation, à sa place dans l'ordre du rôle, et s'ouvre en CARTE au
   * survol plutôt qu'en liste dépliée sous « Paramètres ».
   */
  const sansEntree = navigation.filter((entree) => !entree.sousMenu || entree.partage);
  const avecSousMenu = navigation.filter((entree) => entree.sousMenu && !entree.partage);

  return (
    <Sidebar {...proprietes}>
      {/*
        L'établissement et l'année en TÊTE : ils qualifient tout ce que la barre
        donne accès. Le logo perdait cette place pour ne rien dire de plus que
        l'onglet du navigateur.
      */}
      <SidebarHeader>
        {/*
          `group-data-[collapsible=icon]:hidden` : repliée en icônes, la barre
          fait 3 rem — le logo y serait illisible, et il n'apprend rien qu'un
          directeur déjà connecté ignore.
        */}
        {/*
          ⚠️ LE LOGO À GAUCHE, L'ÉPINGLE À L'AUTRE BOUT. Elle disparaît avec lui
          en mode icônes : la barre n'y fait que 3 rem, et surtout on n'épingle
          pas une barre qu'on vient de replier — le réglage ne se règle que sur
          une barre ouverte.
        */}
        <div className="flex items-center justify-between gap-1 px-2 py-1 group-data-[collapsible=icon]:hidden">
          <NavLink to="/app" className="flex items-center">
            <img src="/logo_edtpro.svg" alt="EDT Pro" className="h-7 w-auto" />
          </NavLink>

          <BoutonEpingle />
        </div>

        <SelecteurAnnee />
      </SidebarHeader>

      <SidebarContent>
        <GroupeFavoris pathname={pathname} />

        {/* Groupe Navigation (tous les menus sauf Paramètres) */}
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarMenu>
            {raccourcis.map((entree) => {
              const estAccueil = entree.url === '/app';

              return (
                <SidebarMenuItem key={entree.url}>
                  <SidebarMenuButton
                    asChild
                    tooltip={entree.titre}
                    isActive={estAccueil ? pathname === '/app' : pathname === entree.url}
                  >
                    <NavLink to={entree.url} end={estAccueil}>
                      <entree.icone className="stroke-[1.7]" />
                      <span>{entree.titre}</span>
                    </NavLink>
                  </SidebarMenuButton>

                  {/*
                    ⚠️ LE COMPTEUR NE S'AFFICHE QU'AU-DELÀ DE ZÉRO. Un « 0 »
                    permanent à côté de « Messagerie » se lit comme une pastille
                    à traiter, et on finit par ne plus la regarder — y compris le
                    jour où elle porte un vrai nombre.
                  */}
                  {entree.url === '/app/messagerie' && <CompteurMessages />}
                </SidebarMenuItem>
              );
            })}

            {sansEntree.map((entree) =>
              entree.partage ? (
                <EntreePartagee key={entree.url} entree={entree} pathname={pathname} />
              ) : (
                <SidebarMenuItem key={entree.url}>
                  <SidebarMenuButton asChild tooltip={entree.titre} isActive={pathname === entree.url}>
                    <NavLink to={entree.url}>
                      <entree.icone className="stroke-[1.7]" />
                      <span>{entree.titre}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            )}
          </SidebarMenu>
        </SidebarGroup>

        {/*
          ⚠️ LE GROUPE DISPARAÎT SANS SOUS-MENU. Seul le directeur en porte un
          (« Paramètres ») — un formateur, un stagiaire ou un gestionnaire
          verraient sinon un intitulé suivi de rien, la même règle que pour les
          Favoris.
        */}
        {avecSousMenu.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Paramètres</SidebarGroupLabel>
            <SidebarMenu>
              {avecSousMenu.map((entree) => (
                <SousMenu key={entree.url} entree={entree} pathname={pathname} />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* Le compte en pied, comme partout : on l'y cherche. */}
      <SidebarFooter>
        <MenuUtilisateur />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

/**
 * « Partagé » dans la barre latérale — plusieurs pages partagées avec un
 * gestionnaire (2026-09-12, demande du porteur : « et pour le gestionnaire »).
 * La même carte que dans la barre du formateur, ouverte À DROITE : sous
 * l'entrée, elle recouvrirait les liens suivants de la barre.
 *
 * ⚠️ PAS D'INFOBULLE, même barre repliée en icônes : la carte s'ouvre au même
 * survol et porte déjà le titre de chaque page — une bulle par-dessus la
 * masquerait.
 */
function EntreePartagee({ entree, pathname }) {
  const actif = entree.sousMenu.some((sous) => pathname.startsWith(sous.url));

  return (
    <SidebarMenuItem>
      <CartePagesPartagees entree={entree} side="right" align="start">
        <SidebarMenuButton isActive={actif}>
          <entree.icone className="stroke-[1.7]" />
          <span>{entree.titre}</span>
          <ChevronRight className="ml-auto stroke-[1.7] opacity-60" />
        </SidebarMenuButton>
      </CartePagesPartagees>
    </SidebarMenuItem>
  );
}

function SousMenu({ entree, pathname }) {
  // Ouvert d'office quand on se trouve dedans : sinon la page courante n'est
  // signalée nulle part dans le menu.
  const dedans = pathname.startsWith(entree.url);

  return (
    <Collapsible asChild defaultOpen={dedans} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={entree.titre}>
            <entree.icone className="stroke-[1.7]" />
            <span>{entree.titre}</span>
            <ChevronRight className="ml-auto stroke-[1.7] transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <SidebarMenuSub>
            {entree.sousMenu.map((sous) => (
              <SidebarMenuSubItem key={sous.url}>
                <SidebarMenuSubButton asChild>
                  <NavLink to={sous.url}>
                    {/*
                      Dix réglages alignés se ressemblent tous : sans repère
                      visuel, on relit la liste entière à chaque visite.
                    */}
                    <sous.icone className="stroke-[1.7]" />
                    <span>{sous.titre}</span>
                  </NavLink>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

/**
 * Groupe « Favoris », en tête de la barre.
 *
 * ═══ CE QUI DONNE UN SENS À L'ÉTOILE ═══
 * Sans cet endroit, l'étoile de l'en-tête ne serait qu'un interrupteur
 * décoratif. Les favoris sont là pour raccourcir le chemin vers les deux ou
 * trois écrans qu'on rouvre tous les jours — le sous-menu des Paramètres en
 * compte dix, dont on n'en touche jamais plus de trois.
 *
 * ⚠️ Le groupe DISPARAÎT quand la liste est vide, plutôt que d'afficher un
 * titre suivi de rien : un intitulé sans contenu occupe la place la plus
 * précieuse de la barre pour ne rien dire.
 *
 * ⚠️ Un favori dont l'URL n'existe plus au menu est IGNORÉ. Le stockage local
 * survit aux versions : une entrée renommée laisserait sinon un lien mort que
 * personne ne saurait retirer.
 */
function GroupeFavoris({ pathname }) {
  const favoris = useFavoris();

  const entrees = favoris
    .map((url) => ENTREES.find((entree) => entree.url === url))
    .filter(Boolean);

  if (entrees.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Favoris</SidebarGroupLabel>
      <SidebarMenu>
        {entrees.map((entree) => {
          const Icone = entree.icone;

          return (
            <SidebarMenuItem key={entree.url}>
              <SidebarMenuButton asChild isActive={pathname === entree.url} tooltip={entree.titre}>
                <NavLink to={entree.url}>
                  {Icone && <Icone className="size-4 stroke-[1.7]" />}
                  <span>{entree.titre}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
