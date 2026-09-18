import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { libelleAnneeScolaire } from 'shared/domain';
import { chargerEtablissementCourant } from '@/features/configuration/api';
import { definirAnneeActive, useAnneeActive } from '@/lib/anneeActive';

/**
 * Sélecteur d'année scolaire, en tête de la barre latérale.
 * ← `school-year-filter.js` + le sélecteur d'établissement de l'existant (F2)
 *
 * ═══ POURQUOI EN TÊTE, ET PAS DANS UN ÉCRAN DE RÉGLAGES ═══
 * L'année conditionne TOUT ce qui s'affiche : emploi du temps, avancement,
 * absences. Un directeur qui ne voit pas laquelle est active lit des chiffres
 * sans savoir de quelle année ils parlent — et l'existant a produit ce cas, où
 * l'année vivait dans la session serveur, invisible.
 *
 * Le changement invalide TOUTES les requêtes en cache : chaque écran se
 * recharge sur la nouvelle année. Les laisser afficher les données de l'ancienne
 * serait le plus sûr moyen de faire saisir une séance sur la mauvaise année.
 */
export default function SelecteurAnnee() {
  const { isMobile } = useSidebar();
  const cache = useQueryClient();
  const choisie = useAnneeActive();

  const contexte = useQuery({
    queryKey: ['etablissement-courant'],
    queryFn: chargerEtablissementCourant,
    retry: false,
  });

  const etablissement = contexte.data?.etablissement;
  const annees = contexte.data?.anneesDisponibles ?? [];
  const active = choisie ?? contexte.data?.anneeScolaire ?? null;

  const changer = (annee) => {
    if (annee === active) return;
    definirAnneeActive(annee);
    // Tout est daté : rien de ce qui est affiché ne reste valable.
    cache.invalidateQueries();
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {/*
                Bleu clair, pas l'aplat sombre du bloc shadcn : cette pastille
                n'est pas une action, elle identifie. Un carré noir en tête de
                barre pesait plus que les entrées de menu qui, elles, se
                cliquent.
              */}
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg border border-border text-muted-foreground">
                <Building2 className="size-4" />
              </div>

              <div className="grid flex-1 text-left text-sm leading-tight">
                {/*
                  Le nom ABRÉGÉ ici — c'est exactement ce pour quoi l'étape 5 le
                  demande : le nom officiel déborderait d'une barre de 16 rem.
                */}
                <span className="truncate font-semibold">
                  {etablissement?.nomAbrege || etablissement?.nom || 'Établissement'}
                </span>
                <span className="truncate text-xs">
                  {active === null ? 'Année…' : libelleAnneeScolaire(active)}
                </span>
              </div>

              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Année scolaire
            </DropdownMenuLabel>

            {annees.map((annee) => (
              <DropdownMenuItem
                key={annee}
                onClick={() => changer(annee)}
                className="gap-2 p-2"
              >
                <span className="flex-1">{libelleAnneeScolaire(annee)}</span>
                {annee === active && <Check className="size-4" />}
              </DropdownMenuItem>
            ))}

            {annees.length === 0 && (
              <DropdownMenuItem disabled className="text-xs">
                Aucune année disponible
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
