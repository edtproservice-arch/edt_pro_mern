import { useMemo, useState } from 'react';
import { Search, UserCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Liste des personnes de la base, à cocher pour leur créer un compte.
 * ← `#formateurs-list-container` / `#stagiaires-list-container` de profile.html
 *
 * ═══ CEUX QUI ONT DÉJÀ UN COMPTE RESTENT VISIBLES ═══
 * Ils sont marqués et non cochables, mais ils restent affichés. Les retirer
 * ferait rétrécir la liste d'un import à l'autre sans que le directeur
 * comprenne pourquoi — et il ne saurait plus qui est servi. C'est exactement ce
 * que le bouton « Sélectionner les nouveaux » de l'existant permettait de voir.
 */
export default function ListeCandidats({
  personnes,
  selection,
  onChange,
  libelle,
  anneeScolaire,
  aideVide,
}) {
  const [filtre, setFiltre] = useState('');

  const visibles = useMemo(() => {
    const motif = filtre.trim().toLowerCase();
    if (motif === '') return personnes;

    // Nom OU matricule : on cherche indifféremment par l'un ou l'autre, comme
    // le champ « Rechercher par nom ou matricule… » de l'existant.
    return personnes.filter(
      (personne) =>
        personne.nomComplet.toLowerCase().includes(motif) ||
        personne.identifiant.toLowerCase().includes(motif)
    );
  }, [personnes, filtre]);

  const nouveaux = personnes.filter((personne) => !personne.aDejaUnCompte);

  const basculer = (identifiant) =>
    onChange(
      selection.includes(identifiant)
        ? selection.filter((autre) => autre !== identifiant)
        : [...selection, identifiant]
    );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filtre}
            onChange={(evenement) => setFiltre(evenement.target.value)}
            placeholder="Rechercher par nom ou matricule…"
            className="h-9 pl-8"
          />
        </div>

        {/* ← « Sélectionner les nouveaux » : le geste courant après un import. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={nouveaux.length === 0}
          onClick={() => onChange(nouveaux.map((personne) => personne.identifiant))}
        >
          Sélectionner les nouveaux ({nouveaux.length})
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={selection.length === 0}
          onClick={() => onChange([])}
        >
          Désélectionner
        </Button>
      </div>

      <div className="max-h-80 divide-y overflow-y-auto rounded-lg border">
        {visibles.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            {personnes.length === 0 ? (
              /*
                ⚠️ « Aucun formateur dans la base » est presque toujours FAUX.
                La base est rangée par (établissement, ANNÉE) : une liste vide
                signifie neuf fois sur dix qu'on regarde la mauvaise année, pas
                que l'établissement n'a pas de formateurs. Le dire envoie
                chercher au mauvais endroit — d'où la mention de l'année et du
                sélecteur qui la change.
              */
              <>
                <p>
                  Aucun {libelle.toLowerCase()} dans la base
                  {/*
                    L'année est toujours citée : la base e-note ET la base
                    Konosys (depuis le 2026-09-14) sont rangées par année
                    scolaire. Une liste vide veut presque toujours dire qu'on
                    regarde une année où rien n'a été importé.
                  */}
                  {anneeScolaire ? ` de l’année ${anneeScolaire}-${anneeScolaire + 1}` : ''}.
                </p>
                <p className="mt-1 text-xs">
                  {aideVide ??
                    'Votre base est enregistrée par année scolaire. Si vous l’avez importée sur une autre année, changez-la avec le sélecteur en haut de la barre latérale.'}
                </p>
              </>
            ) : (
              <p>Aucun résultat pour cette recherche.</p>
            )}
          </div>
        )}

        {visibles.map((personne) => {
          const retenu = selection.includes(personne.identifiant);

          return (
            <label
              key={personne.identifiant}
              className={cn(
                'flex items-center gap-3 px-3 py-2 text-sm',
                personne.aDejaUnCompte ? 'cursor-default' : 'cursor-pointer hover:bg-muted'
              )}
            >
              <Checkbox
                checked={retenu}
                disabled={personne.aDejaUnCompte}
                onCheckedChange={() => basculer(personne.identifiant)}
              />

              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{personne.nomComplet}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {personne.identifiant}
                  {/*
                    L'adresse dit où partiront les identifiants. Une adresse de
                    remplacement « @placeholder.ofppt.ma » signale qu'aucun envoi
                    n'est possible — le directeur devra les transmettre lui-même.
                  */}
                  {personne.email ? ` · ${personne.email}` : ' · sans adresse'}
                </span>
              </span>

              {personne.aDejaUnCompte && (
                <Badge variant="outline" className="shrink-0 gap-1 font-normal">
                  <UserCheck className="h-3 w-3" />
                  Compte existant
                </Badge>
              )}
            </label>
          );
        })}
      </div>

      <p className="px-1 text-xs text-muted-foreground">
        {selection.length} {libelle.toLowerCase()}(s) sélectionné(s) sur {nouveaux.length} sans
        compte
      </p>
    </div>
  );
}
