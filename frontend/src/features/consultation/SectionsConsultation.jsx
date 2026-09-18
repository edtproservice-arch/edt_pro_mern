import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { navigationPourRole } from '@/components/layout/navigation';
import CartePagesPartagees, { ColonnesPagesPartagees } from '@/features/partages/CartePagesPartagees';
import { usePartagesAvecMoi } from '@/features/partages/usePartagesAvecMoi';
import { cn } from '@/lib/utils';

/**
 * Les sections de l'espace formateur / stagiaire, dans `BarreNavigation` —
 * le même bloc que `SectionsAdmin`, réduit aux pages de CE rôle.
 * (2026-09-03, demande du porteur : « réutiliser le navbar d'administrateur »
 * pour ces deux sessions.)
 *
 * ⚠️ LA LISTE VIENT DE `navigationPourRole`, PAS D'UN TROISIÈME TABLEAU ÉCRIT
 * ICI. C'est déjà LA définition unique du menu formateur/stagiaire — celle que
 * la barre latérale du directeur utilisait avant ce changement. En écrire une
 * copie pour la barre horizontale, c'est exactement le défaut du §4.2 : deux
 * listes à tenir en phase, qui auraient fini par diverger au premier ajout de
 * page.
 *
 * ⚠️ MÊME STYLE QUE `SectionsAdmin` — pastille de fond sur la page courante,
 * pas de soulignement : un soulignement dit « onglet », donc un contenu qui
 * change SOUS lui, alors qu'au milieu d'une barre ces entrées se lisent comme
 * un menu. Deux barres de même famille qui se present différemment se
 * réapprendraient à chaque bascule.
 */
const classesLien = (panneau, actif) =>
  cn(
    'block whitespace-nowrap rounded-md transition-colors',
    panneau ? 'py-1 text-3xl font-semibold tracking-tight' : 'px-3 py-1.5 text-sm font-medium hover:bg-accent',
    actif ? (panneau ? 'text-foreground' : 'bg-accent text-foreground') : 'text-muted-foreground hover:text-foreground'
  );

/**
 * « Partagé ▾ » — plusieurs pages partagées : la carte au survol, rangée en
 * colonnes (`CartePagesPartagees`, 2026-09-12).
 *
 * ⚠️ DANS LA BARRE, LA CARTE ; DANS LE PANNEAU MOBILE, LES COLONNES DÉPLIÉES : un
 * téléphone n'a pas de survol, et une carte dans un panneau plein écran serait
 * un geste de trop pour des liens qui tiennent tous.
 */
function SectionAvecSousMenu({ section, panneau, onNavigation }) {
  const { pathname } = useLocation();
  const actif = section.sousMenu.some((sous) => pathname.startsWith(sous.url));

  if (panneau) {
    return (
      <div className="space-y-2">
        <p className={classesLien(true, actif)}>{section.titre}</p>
        <ColonnesPagesPartagees pages={section.sousMenu} onNavigation={onNavigation} panneau />
      </div>
    );
  }

  return (
    <CartePagesPartagees entree={section} onNavigation={onNavigation}>
      <button type="button" className={cn(classesLien(false, actif), 'group flex items-center gap-1')}>
        {section.titre}
        <ChevronDown className="size-3.5 opacity-60 transition-transform group-data-[state=open]:rotate-180" />
      </button>
    </CartePagesPartagees>
  );
}

export default function SectionsConsultation({ role, variante = 'barre', onNavigation }) {
  const panneau = variante === 'panneau';
  // Un formateur invité voit s'ajouter « Partagé » — une page, ou « Partagé ▾ »
  // quand on lui en a partagé plusieurs.
  const { pages: partages } = usePartagesAvecMoi();
  const sections = navigationPourRole(role, { partages });

  return (
    <nav aria-label="Sections">
      <ul className={cn('flex', panneau ? 'flex-col gap-2' : 'items-center gap-1')}>
        {sections.map((section) =>
          section.sousMenu ? (
            <li key={section.url}>
              <SectionAvecSousMenu section={section} panneau={panneau} onNavigation={onNavigation} />
            </li>
          ) : (
          <li key={section.url}>
            <NavLink
              to={section.url}
              onClick={onNavigation}
              className={({ isActive }) => classesLien(panneau, isActive)}
            >
              {section.titre}
            </NavLink>
          </li>
          )
        )}
      </ul>
    </nav>
  );
}
