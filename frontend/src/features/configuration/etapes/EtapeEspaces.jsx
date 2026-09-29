import { useState } from 'react';
import { Plus, Share2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Alerte from '@/components/common/Alerte';

/**
 * Étape 4 — espaces de travail.
 * ← public/setup.html:563-591
 *
 * « TEAMS » est proposé d'office : c'est la salle des cours synchrones, et
 * l'oublier rend impossible le placement de toute séance à distance.
 *
 * ⚠️ IL EST MÊME CRÉÉ D'OFFICE (2026-09-19, demande du porteur) : dans l'assistant, la
 * liste part avec « TEAMS » ; sur la page Paramètres, il est posé quand la liste est
 * VIDE (établissement neuf). Ce n'est pas ce composant qui le pose, mais son appelant —
 * lui seul sait si la liste vient d'être chargée ou d'être vidée par la personne, et
 * un « TEAMS » retiré exprès ne doit pas revenir tout seul.
 */
const SUGGESTIONS = [
  'Salle 1',
  'Salle 2',
  'Salle 3',
  'Salle 4',
  'Salle 5',
  'Salle 6',
  'Salle 7',
  'Salle 8',
  'Atelier',
  'TEAMS',
];

/**
 * @param {boolean} [props.lectureSeule]  invité « peut consulter » (Phase 5bis,
 *   étape d3) : la liste se LIT — ni saisie, ni suggestions, ni croix. Masqués
 *   plutôt que désactivés : un champ grisé laisse chercher comment l'activer.
 * @param {import('react').ReactNode} [props.actionsListe]  posé sur la ligne du titre « Vos espaces »,
 *   à droite — l'assistant n'en fournit pas.
 * @param {{ empruntes: Array<{libelle: string, proprietaire: {nom: string}}>, partagees: Map<string, string[]> }} [props.mutualises]
 *   les salles MUTUALISÉES (2026-09-23) : celles qu'on nous prête, rangées dans la liste mais
 *   sans croix (elles ne sont pas à nous), et nos salles prêtées, marquées. L'assistant n'en
 *   fournit pas — un établissement neuf n'a encore rien partagé.
 */
export default function EtapeEspaces({
  valeur,
  onChange,
  lectureSeule = false,
  actionsListe = null,
  mutualises = null,
}) {
  const empruntes = mutualises?.empruntes ?? [];
  const partagees = mutualises?.partagees ?? new Map();
  const [saisie, setSaisie] = useState('');
  const espaces = valeur ?? [];

  const ajouter = (nom) => {
    const propre = String(nom).trim();
    if (!propre) return;

    // Comparaison insensible à la casse, comme setup.html:985.
    if (espaces.some((e) => e.toLowerCase() === propre.toLowerCase())) {
      setSaisie('');
      return;
    }

    onChange([...espaces, propre]);
    setSaisie('');
  };

  const retirer = (nom) => onChange(espaces.filter((e) => e !== nom));

  const restantes = SUGGESTIONS.filter(
    (s) => !espaces.some((e) => e.toLowerCase() === s.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/*
        La consigne passe en encart : posée en titre de page, elle entrait en
        concurrence avec celui de l'écran qui l'accueille — l'assistant comme la
        page de réglages en portent déjà un.
      */}
      {/* <Alerte type="info" titre="Listez vos espaces de travail">
        Ajoutez vos salles. N&apos;oubliez pas « TEAMS » pour les cours à distance.
      </Alerte> */}

      {!lectureSeule && (
      <div className="flex gap-2">
        <Input
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              ajouter(saisie);
            }
          }}
          placeholder="Nom d'un espace…"
        />
        <Button onClick={() => ajouter(saisie)} disabled={!saisie.trim()}>
          <Plus className="h-4 w-4" />
          Ajouter
        </Button>
      </div>
      )}

      {!lectureSeule && restantes.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Suggestions</p>
          <div className="flex flex-wrap gap-2">
            {restantes.map((suggestion) => (
              <Button
                key={suggestion}
                variant="outline"
                size="sm"
                onClick={() => ajouter(suggestion)}
              >
                <Plus className="h-3.5 w-3.5" />
                {suggestion}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">
            Vos espaces{espaces.length > 0 && ` (${espaces.length})`}
            {empruntes.length > 0 && (
              <span className="font-normal text-muted-foreground">
                {' '}
                + {empruntes.length} mutualisé{empruntes.length > 1 ? 's' : ''}
              </span>
            )}
          </p>
          {/* Les actions de l'appelant, à l'autre bout de la ligne (la page Espaces y met « Mutualiser »). */}
          {actionsListe}
        </div>

        {espaces.length === 0 ? (
          <Alerte type="info" titre="Au moins un espace est nécessaire">
            Sans espace, aucune séance ne peut être placée dans l&apos;emploi du temps.
          </Alerte>
        ) : (
          <>
            {/* « TEAMS » est créé d'office : seul, il ne permet aucun cours en présentiel. */}
            {espaces.every((e) => e.trim().toUpperCase() === 'TEAMS') && (
              <Alerte type="info" titre="Ajoutez au moins un espace physique">
                « TEAMS » (cours à distance) est déjà là. Ajoutez vos salles ou ateliers pour placer
                les cours en présentiel.
              </Alerte>
            )}
          <div className="flex flex-wrap gap-2 rounded-lg border p-3">
            {espaces.map((espace) => (
              <span
                key={espace}
                className="inline-flex items-center gap-1.5 rounded-md bg-muted py-1 pl-3 pr-1.5 text-sm"
                title={
                  partagees.has(espace)
                    ? `Partagée avec ${partagees.get(espace).join(', ')}`
                    : undefined
                }
              >
                {partagees.has(espace) && (
                  <Share2 className="size-3.5 text-primary" aria-label="Salle partagée" />
                )}
                {espace}
                {!lectureSeule && (
                <button
                  type="button"
                  onClick={() => retirer(espace)}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-destructive"
                  aria-label={`Supprimer ${espace}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                )}
              </span>
            ))}

            {/*
              Les salles PRÊTÉES par un autre établissement, à la suite des nôtres : utilisables
              chez nous, mais pas à nous — teinte `primary` et pas de croix. Les retirer se
              décide chez leur propriétaire, jamais d'un clic sur une pastille qui ressemble
              aux nôtres.
            */}
            {empruntes.map((emprunte) => (
              <span
                key={emprunte.libelle}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-3 py-1 text-sm"
                title={`Mutualisée — prêtée par ${emprunte.proprietaire.nom}`}
              >
                <Share2 className="size-3.5 text-primary" aria-hidden="true" />
                {emprunte.libelle}
              </span>
            ))}
          </div>

          </>
        )}
      </div>
    </div>
  );
}
