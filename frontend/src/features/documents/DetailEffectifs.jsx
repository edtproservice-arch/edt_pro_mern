import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Search, UserX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import Alerte from '@/components/common/Alerte';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { chargerStagiaires } from './api';
import { useEtatPartage } from '@/features/guidage/useEtatPartage';

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
  // Le filtre et le groupe déplié, partagés pendant le guidage (2026-10-04).
  useEtatPartage('documents.effectifs', { filtre, groupe: groupeOuvert ?? null }, (valeur) => {
    if (!valeur || typeof valeur !== 'object') return;
    setFiltre(typeof valeur.filtre === 'string' ? valeur.filtre : '');
    setGroupeOuvert(typeof valeur.groupe === 'string' ? valeur.groupe : null);
  });

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
        <div className="border-t">
          {stagiaires.isError ? (
            <p className="px-3 py-2 text-sm text-destructive">{stagiaires.error.message}</p>
          ) : stagiaires.isLoading ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Chargement…</p>
          ) : (
            <TableauStagiaires groupe={groupe.nom} liste={liste} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * La liste nominative d'un groupe, en TABLEAU (2026-09-23, demande du porteur :
 * « toutes les données des stagiaires, de manière structurée »). Une colonne par
 * donnée : on compare d'une ligne à l'autre, ce qu'une ligne de texte ne permet pas.
 *
 * ⚠️ LE TABLEAU DÉFILE EN LARGEUR, PAS LA PAGE : dix colonnes ne tiennent pas
 * sur un écran étroit.
 */
function TableauStagiaires({ groupe, liste }) {
  if (liste.length === 0) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">Aucun stagiaire dans ce groupe.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table className="text-xs">
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="w-10 text-right">N°</TableHead>
            <TableHead>Matricule (CEF)</TableHead>
            <TableHead>Nom et prénom</TableHead>
            <TableHead className="text-right">الاسم الكامل</TableHead>
            <TableHead>CIN</TableHead>
            <TableHead>Date de naissance</TableHead>
            <TableHead>Lieu de naissance</TableHead>
            <TableHead>E-mail</TableHead>
            <TableHead>Niveau · année</TableHead>
            <TableHead>Autres groupes</TableHead>
            <TableHead>Site</TableHead>
            <TableHead>Date d'inscription</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {liste.map((stagiaire, rang) => {
            // Le groupe ouvert est déjà dans l'en-tête : on ne liste que les AUTRES (FQ…).
            const autres = (stagiaire.groupes ?? []).filter((g) => g !== groupe);
            return (
              <TableRow key={stagiaire.id}>
                <TableCell className="text-right tabular-nums text-muted-foreground">{rang + 1}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{stagiaire.matricule}</TableCell>
                <TableCell className="whitespace-nowrap font-medium">
                  {[stagiaire.nom, stagiaire.prenom].filter(Boolean).join(' ') || '—'}
                </TableCell>
                {/* `dir="rtl"` : sinon chiffres et parenthèses s'inversent. */}
                <TableCell dir="rtl" lang="ar" className="whitespace-nowrap text-right">
                  {[stagiaire.nomArabe, stagiaire.prenomArabe].filter(Boolean).join(' ') || '—'}
                </TableCell>
                <TableCell className="whitespace-nowrap">{stagiaire.cin || '—'}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{stagiaire.dateNaissance || '—'}</TableCell>
                <TableCell className="whitespace-nowrap">{stagiaire.lieuNaissance || '—'}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {stagiaire.email ? (
                    <a href={`mailto:${stagiaire.email}`} className="hover:underline">
                      {stagiaire.email}
                    </a>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {[stagiaire.niveau, stagiaire.annee].filter(Boolean).join(' · ') || '—'}
                </TableCell>
                <TableCell>
                  {autres.length ? (
                    <div className="flex flex-wrap gap-1">
                      {autres.map((g) => (
                        <Badge key={g} variant="outline" className="font-normal">
                          {g}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">{stagiaire.site || '—'}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{stagiaire.dateInscription || '—'}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
