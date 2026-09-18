import { useMutation, useQuery } from '@tanstack/react-query';
import { NavLink, useNavigate } from 'react-router-dom';
import { ChevronsUpDown, LogOut, Settings, UserRound } from 'lucide-react';
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
              <DropdownMenuItem asChild>
                <NavLink to="/app/parametres">
                  <Settings />
                  Paramètres
                </NavLink>
              </DropdownMenuItem>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              disabled={deconnexion.isPending}
              onClick={() => deconnexion.mutate()}
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
