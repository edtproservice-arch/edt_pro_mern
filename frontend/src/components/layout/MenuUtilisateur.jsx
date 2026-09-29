import { useMutation, useQuery } from '@tanstack/react-query';
import { NavLink, useNavigate } from 'react-router-dom';
import { ChevronsUpDown, LogOut, Moon, Settings, Sun, UserRound } from 'lucide-react';
import { ROLES } from 'shared/constants';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { recupererSession, seDeconnecter } from '@/features/auth/api';
import { initiales } from '@/lib/initiales';
import { useTheme } from '@/lib/theme';
import SousMenuEtablissements from './SousMenuEtablissements';

/**
 * Menu du compte, en pied de la barre latérale.
 * ← le bloc `NavUser` de shadcn, avec les entrées de l'application.
 *
 * ═══ POURQUOI LA DÉCONNEXION DESCEND ICI ═══
 * Elle occupait un bouton permanent dans l'en-tête, à côté d'actions de
 * travail. C'est l'action la plus destructrice de l'écran — elle fait perdre
 * une saisie en cours — et la plus rare. Elle rejoint le menu du compte, où on
 * la cherche, et où il faut deux gestes pour l'atteindre.
 */
export default function MenuUtilisateur() {
  const { isMobile } = useSidebar();
  const navigate = useNavigate();

  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  const utilisateur = session.data?.utilisateur;
  const theme = useTheme();

  const deconnexion = useMutation({
    mutationFn: seDeconnecter,
    // Même si l'appel échoue, on renvoie vers la connexion : rester sur une
    // page dont la session est morte est pire.
    onSettled: () => navigate('/connexion'),
  });

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-primary/10 font-medium text-primary">
                  {initiales(utilisateur?.nomComplet)}
                </AvatarFallback>
              </Avatar>

              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  {utilisateur?.nomComplet ?? 'Mon compte'}
                </span>
                <span className="truncate text-xs">{utilisateur?.email ?? ''}</span>
              </div>

              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarFallback className="rounded-lg bg-primary/10 font-medium text-primary">
                    {initiales(utilisateur?.nomComplet)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{utilisateur?.nomComplet}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {utilisateur?.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <NavLink to="/app/profil">
                  <UserRound />
                  Mon profil
                </NavLink>
              </DropdownMenuItem>
              {/* ⚠️ PAS POUR LE GESTIONNAIRE (2026-09-29, demande du porteur) : la
                  page Paramètres ne lui est pas ouverte — le lien menait à un refus. */}
              {utilisateur?.role !== ROLES.GESTIONNAIRE && (
                <DropdownMenuItem asChild>
                  <NavLink to="/app/parametres">
                    <Settings />
                    Paramètres
                  </NavLink>
                </DropdownMenuItem>
              )}
              <SousMenuEtablissements />

              {/*
                ⚠️ POUR LE GESTIONNAIRE (2026-09-28, demande du porteur : « pour le
                gestionnaire, mets-le en sidebar ») : il n'a pas la page
                Paramètres, où vit la bascule du directeur. Un clic alterne
                clair / sombre ; le menu se referme, comme pour toute entrée.
              */}
              {utilisateur?.role === ROLES.GESTIONNAIRE && (
                <DropdownMenuItem onClick={() => theme.definir(theme.sombre ? 'clair' : 'sombre')}>
                  {theme.sombre ? <Sun /> : <Moon />}
                  {theme.sombre ? 'Thème clair' : 'Thème sombre'}
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            {/* Rouge DOUX, comme « Déconnexion » de la barre d'administration (`BarreNavigation`) :
                la même action se lit de la même façon dans les deux espaces. `[&_svg]` :
                l'icône du menu impose sa propre couleur, qu'il faut surcharger aussi. */}
            <DropdownMenuItem
              disabled={deconnexion.isPending}
              onClick={() => deconnexion.mutate()}
              className="text-destructive focus:bg-destructive/10 focus:text-destructive [&_svg]:!text-destructive"
            >
              <LogOut />
              Se déconnecter
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
