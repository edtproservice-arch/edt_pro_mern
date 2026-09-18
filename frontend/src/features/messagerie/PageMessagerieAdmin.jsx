import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import BarreNavigation from '@/components/layout/BarreNavigation';
import SectionsAdmin from '@/features/admin/components/SectionsAdmin';
import PageMessagerie from './PageMessagerie';

/**
 * La messagerie, hébergée dans l'espace ADMINISTRATION.
 * (2026-09-03, demande du porteur : « lier l'admin avec messagerie ».)
 *
 * ═══ ⚠️ POURQUOI CE N'EST PAS `/app/messagerie` ═══
 * Cette route existe déjà et fonctionne pour les DIRECTEURS depuis le
 * 2026-08-25 — mais elle vit sous `CoquilleApp`, la coquille applicative
 * (barre latérale, sélecteur d'année, carte d'établissement). Un administrateur
 * n'a NI établissement NI année scolaire : le monter dans cette coquille
 * ouvrirait une barre latérale vide et un sélecteur d'année sans rien à
 * sélectionner.
 *
 * ⚠️ CÔTÉ SERVEUR, RIEN NE CHANGE : `messagerie.routes.js` ne pose ni
 * `resolveTenant` ni `requireRole` établissement — « un message appartient à
 * deux PERSONNES, pas à un établissement ». L'admin est déjà l'un des cinq
 * rôles que la matrice de droits reconnaît (il écrit à tous les directeurs).
 * Il ne manquait qu'un ENDROIT où l'ouvrir depuis l'espace admin.
 *
 * ═══ ⚠️ LE MÊME `<PageMessagerie>`, PAS UNE SECONDE MESSAGERIE ═══
 * Elle exige deux choses de son environnement, que cette page reproduit à
 * l'identique de `CoquilleApp` :
 *   - un `SidebarProvider` (elle lit `useSidebar()` pour son rail responsive) ;
 *   - un ANCÊTRE de hauteur DÉFINIE, avec 1,5 rem de marge sur chaque bord —
 *     son propre `-m-6 h-[calc(100%+3rem)]` reprend cette marge pour toucher
 *     les quatre bords. `SidebarInset` (`h-svh`) + ce conteneur (`flex-1
 *     min-h-0 p-6`) sont EXACTEMENT ceux de `ContenuPage` dans `CoquilleApp`.
 * Sans cette seconde condition, la messagerie s'écraserait à sa hauteur
 * naturelle au lieu d'occuper l'écran.
 *
 * ⚠️ `BarreNavigation` reste `sticky top-0` par habitude, mais elle n'a plus
 * rien à faire : dans un conteneur `h-svh overflow-hidden`, c'est le CONTENU
 * qui défile, jamais la page — la barre est déjà fixe par construction, en
 * tant que premier enfant `shrink-0` d'une colonne flex.
 */
export default function PageMessagerieAdmin() {
  return (
    <SidebarProvider>
      <SidebarInset className="h-svh overflow-hidden">
        <BarreNavigation titre="Administration" liens={<SectionsAdmin />} />

        {/*
          ⚠️ LES MÊMES CLASSES QUE `ContenuPage`, PAS UNE APPROXIMATION —
          `min-h-0 flex-1` pour la hauteur définie dont `-m-6
          h-[calc(100%+3rem)]` a besoin, `overflow-y-auto` (et non `hidden`)
          parce que c'est la combinaison éprouvée par toutes les autres pages ;
          `PageMessagerie` ne la sollicite jamais, calibrée pour tenir
          exactement dans cet espace.
        */}
        <div className="min-h-0 flex-1 overflow-x-clip overflow-y-auto p-6">
          <PageMessagerie />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
