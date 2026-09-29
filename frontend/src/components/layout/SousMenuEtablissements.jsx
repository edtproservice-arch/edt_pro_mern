import { useQuery } from '@tanstack/react-query';
import { Building2, Check } from 'lucide-react';
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { chargerEtablissementCourant, chargerMesEtablissements } from '@/features/configuration/api';
import { definirEtablissementActif } from '@/lib/etablissementActif';

/**
 * « Changer d'établissement » — sous-menu du compte, pour un compte mutualisé
 * sur plusieurs établissements (2026-09-24, demande du porteur : formateurs
 * affectés dans deux établissements, switcher sans se déconnecter).
 *
 * ⚠️ NE S'AFFICHE QUE S'IL Y A RÉELLEMENT UN CHOIX (2 établissements ou plus) :
 * pour la quasi-totalité des comptes, cette entrée n'aurait rien à proposer.
 *
 * ⚠️⚠️ UN RECHARGEMENT COMPLET, PAS UN SIMPLE `cache.clear()` (correction du
 * 2026-09-24, signalé par le porteur : « même si je change d'établissement, ça
 * reste les mêmes données — il faut que j'actualise la page pour que ça
 * change »). `queryClient.clear()` DÉTRUIT le cache, mais ne RÉVEILLE pas les
 * `useQuery` déjà montés : sans un nouveau rendu déclenché ailleurs, chaque
 * page continue d'afficher le résultat qu'elle avait en mémoire jusqu'à ce que
 * quelque chose d'autre la fasse se re-rendre — un rechargement manuel,
 * justement. `BoutonCollaborer.jsx` s'en tirait sans le savoir : il navigue
 * TOUJOURS vers une autre route après avoir vidé le cache, ce qui remonte tout
 * à neuf. Ici, changer d'établissement reste délibérément SUR LA MÊME page
 * (voir plus bas) — il n'y a donc aucune navigation pour forcer ce nouveau
 * rendu, d'où le rechargement complet.
 */
export default function SousMenuEtablissements() {
  const liste = useQuery({
    queryKey: ['etablissements', 'mes'],
    queryFn: chargerMesEtablissements,
    retry: false,
  });
  const courant = useQuery({
    queryKey: ['etablissement-courant'],
    queryFn: chargerEtablissementCourant,
    retry: false,
  });

  const etablissements = liste.data?.etablissements ?? [];
  if (etablissements.length < 2) return null;

  const actifId = courant.data?.etablissement?.id ?? null;

  function choisir(id) {
    if (id === actifId) return;
    definirEtablissementActif(id);
    // ⚠️ Voir la note ci-dessus : un simple rendu React ne suffit pas, il faut
    // que TOUT reparte à neuf, requêtes comprises.
    window.location.reload();
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Building2 />
        Changer d&apos;établissement
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-56">
        {etablissements.map((etablissement) => (
          <DropdownMenuItem
            key={etablissement.id}
            onSelect={() => choisir(etablissement.id)}
            className="gap-2"
          >
            <span className="min-w-0 flex-1 truncate">
              {etablissement.nomAbrege || etablissement.nom}
            </span>
            {etablissement.id === actifId && <Check className="size-4 shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
