import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Search, UserX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import Alerte from '@/components/common/Alerte';
import { cn } from '@/lib/utils';
import { chargerStagiaires } from './api';

/**
 * Détail d'un effectif : filière → groupe → stagiaires.
 *
 * ═══ POURQUOI UN ARBRE, ET NON UN TABLEAU FILTRÉ ═══
 * La question posée devant ces chiffres est « ma filière X est-elle bien
 * arrivée, et avec combien de groupes ? ». Un tableau à plat oblige à filtrer
 * pour y répondre, filière par filière. L'arbre montre la composition d'un coup
 * et ne charge la liste nominative que du groupe qu'on ouvre — 995 stagiaires
 * affichés d'emblée, c'est ce que faisait canvas.html.
 */
export default function DetailEffectifs({ statistiques }) {
  const [filtre, setFiltre] = useState('');
  const [groupeOuvert, setGroupeOuvert] = useState(null);

  const filieres = statistiques?.filieres ?? [];
  const motif = filtre.trim().toLowerCase();

  // Le filtre porte sur la filière ET sur ses groupes : chercher « DEV » doit
  // trouver la filière comme le groupe, on ne sait pas lequel l'utilisateur a
  // en tête.
  const visibles = filieres
    .map((filiere) => ({
      ...filiere,
      groupes: filiere.groupes.filter(
        (groupe) =>
          motif === '' ||
          groupe.nom.toLowerCase().includes(motif) ||
          filiere.nom.toLowerCase().includes(motif)
      ),
    }))
    .filter((filiere) => filiere.groupes.length > 0);

  if (filieres.length === 0) {
    return (
      <Alerte type="info" titre="Aucun stagiaire">
        Importez votre export Konosys avec le bouton ci-dessus : c&apos;est lui qui alimente cette
        page et les documents imprimés.
      </Alerte>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filtre}
          onChange={(evenement) => setFiltre(evenement.target.value)}
          placeholder="Filtrer par filière ou groupe…"
          className="h-9 pl-8"
        />
      </div>

      {visibles.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <UserX className="h-4 w-4 shrink-0" />
          Aucune filière ni groupe ne correspond à cette recherche.
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {visibles.map((filiere) => (
            <section key={filiere.nom} className="p-4">
              <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">{filiere.nom}</h3>
                <span className="text-xs text-muted-foreground">
                  {filiere.groupes.length} groupe(s) · {filiere.inscriptions} inscription(s)
                </span>
              </header>

              <div className="space-y-1">
                {filiere.groupes.map((groupe) => (
                  <Groupe
                    key={groupe.nom}
                    groupe={groupe}
                    ouvert={groupeOuvert === groupe.nom}
                    onBasculer={() =>
                      setGroupeOuvert(groupeOuvert === groupe.nom ? null : groupe.nom)
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** Un groupe, dont la liste nominative n'est chargée qu'à l'ouverture. */
function Groupe({ groupe, ouvert, onBasculer }) {
  const stagiaires = useQuery({
    queryKey: ['stagiaires', 'liste', groupe.nom],
    queryFn: () => chargerStagiaires({ groupe: groupe.nom }),
    // ⚠️ La requête n'est lancée QUE si le groupe est ouvert : monter la page
    // avec 40 groupes déclencherait sinon 40 appels d'un coup, pour un contenu
    // que personne ne regarde.
    enabled: ouvert,
    retry: false,
  });

  const liste = stagiaires.data?.stagiaires ?? [];

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={onBasculer}
        aria-expanded={ouvert}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
      >
        <ChevronRight
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', ouvert && 'rotate-90')}
        />
        <span className="min-w-0 flex-1 truncate font-medium">{groupe.nom}</span>
        <Badge variant="outline" className="shrink-0 font-normal tabular-nums">
          {groupe.total}
        </Badge>
      </button>

      {ouvert && (
        <div className="border-t px-3 py-2">
          {stagiaires.isError ? (
            <p className="text-sm text-destructive">{stagiaires.error.message}</p>
          ) : stagiaires.isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : (
            <ol className="space-y-0.5 text-sm">
              {liste.map((stagiaire, rang) => (
                <li key={stagiaire.id} className="flex gap-2">
                  <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">
                    {rang + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">
                      {stagiaire.nom} {stagiaire.prenom}
                      {/* `dir="rtl"` : sinon chiffres et parenthèses s'inversent. */}
                      {stagiaire.nomArabe && (
                        <span dir="rtl" lang="ar" className="mx-2 text-xs text-muted-foreground">
                          {stagiaire.nomArabe} {stagiaire.prenomArabe}
                        </span>
                      )}
                      <span className="ml-2 tabular-nums text-xs text-muted-foreground">
                        {stagiaire.matricule}
                      </span>
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
