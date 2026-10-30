import { MonitorDown } from 'lucide-react';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { estApplicationDesktop } from '@/lib/miseAJourDesktop';

/**
 * ═══ TÉLÉCHARGER L'APPLICATION DE BUREAU (2026-10-30, demande du porteur) ═══
 * En pied de la barre latérale, au-dessus du compte : l'installeur Windows de la DERNIÈRE
 * version publiée.
 *
 * ⚠️ TÉLÉCHARGÉ DEPUIS edtpro.tech, PAS DEPUIS GITHUB (même jour, demande du porteur : « je ne
 *    veux pas qu'il dirige vers GitHub ») : nginx sert `/opt/edtpro/telechargements/` en
 *    pièce jointe. Un nom SANS version, `EDT-Pro_x64-setup.exe`, remplacé à chaque version —
 *    voir `scripts/publier-desktop.mjs` : le lien ne change jamais.
 * ⚠️ DANS LE NAVIGATEUR SEULEMENT : dans l'application de bureau, on l'a déjà — elle se met à
 *    jour toute seule.
 */
export const URL_INSTALLEUR_BUREAU = 'https://edtpro.tech/telechargements/EDT-Pro_x64-setup.exe';

export default function BoutonApplicationBureau() {
  if (estApplicationDesktop()) return null;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton asChild tooltip="Télécharger l’application Windows">
          <a href={URL_INSTALLEUR_BUREAU} download>
            <MonitorDown className="stroke-[1.7]" />
            <span>Application bureau</span>
            <span className="ml-auto rounded border px-1.5 text-[0.65rem] text-muted-foreground">Windows</span>
          </a>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
