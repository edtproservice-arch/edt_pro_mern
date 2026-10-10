import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import BarreNavigation from '@/components/layout/BarreNavigation';
import SectionsAdmin from '@/features/admin/components/SectionsAdmin';
import PageAnnonces from './PageAnnonces';

/**
 * Les annonces, dans l'espace ADMINISTRATION (2026-10-10) — l'administrateur
 * écrit aux directeurs. Même hébergement que `PageMessagerieAdmin` : l'admin
 * n'a ni établissement ni année, donc pas la coquille du directeur.
 */
export default function PageAnnoncesAdmin() {
  return (
    <SidebarProvider>
      <SidebarInset className="h-svh overflow-hidden">
        <BarreNavigation titre="Administration" liens={<SectionsAdmin />} />
        <div className="min-h-0 flex-1 overflow-x-clip overflow-y-auto p-6">
          <PageAnnonces admin />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
