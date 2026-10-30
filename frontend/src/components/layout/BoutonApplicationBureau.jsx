import { MonitorDown } from 'lucide-react';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { estApplicationDesktop } from '@/lib/miseAJourDesktop';

/**
 * ═══ TÉLÉCHARGER L'APPLICATION DE BUREAU (2026-10-30, demande du porteur) ═══
 * En pied de la barre latérale, au-dessus du compte : l'installeur Windows de la DERNIÈRE
 * version publiée.
 *
 * ⚠️ UN NOM DE FICHIER STABLE : `releases/latest/download/<nom>` ne sert que le nom exact, et
 *    l'installeur porte sa version (« EDT-Pro_0.2.0_x64-setup.exe »). Chaque release dépose
 *    donc AUSSI une copie sans version, `EDT-Pro_x64-setup.exe` — voir
 *    `scripts/publier-desktop.mjs`. Le lien ne change jamais d'une version à l'autre.
 * ⚠️ DANS LE NAVIGATEUR SEULEMENT : dans l'application de bureau, on l'a déjà — elle se met à
 *    jour toute seule.
 */
export const URL_INSTALLEUR_BUREAU =
  'https://github.com/edtproservice-arch/edt_pro_mern/releases/latest/download/EDT-Pro_x64-setup.exe';

export default function BoutonApplicationBureau() {
  if (estApplicationDesktop()) return null;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton asChild tooltip="Télécharger l’application Windows">
          <a href={URL_INSTALLEUR_BUREAU} rel="noopener noreferrer" download>
            <MonitorDown className="stroke-[1.7]" />
            <span>Application bureau</span>
            <span className="ml-auto rounded border px-1.5 text-[0.65rem] text-muted-foreground">Windows</span>
          </a>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
