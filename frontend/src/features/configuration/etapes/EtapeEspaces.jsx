import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Alerte from '@/components/common/Alerte';

/**
 * Étape 4 — espaces de travail.
 * ← public/setup.html:563-591
 *
 * « TEAMS » est proposé d'office : c'est la salle des cours synchrones, et
 * l'oublier rend impossible le placement de toute séance à distance.
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
 */
export default function EtapeEspaces({ valeur, onChange, lectureSeule = false }) {
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
        <p className="text-sm font-medium">
          Vos espaces{espaces.length > 0 && ` (${espaces.length})`}
        </p>

        {espaces.length === 0 ? (
          <Alerte type="info" titre="Au moins un espace est nécessaire">
            Sans salle, aucune séance ne peut être placée dans l&apos;emploi du temps.
          </Alerte>
        ) : (
          <div className="flex flex-wrap gap-2 rounded-lg border p-3">
            {espaces.map((espace) => (
              <span
                key={espace}
                className="inline-flex items-center gap-1.5 rounded-md bg-muted py-1 pl-3 pr-1.5 text-sm"
              >
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
          </div>
        )}
      </div>
    </div>
  );
}
