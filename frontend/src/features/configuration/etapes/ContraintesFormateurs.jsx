import { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DialogueContraintes from './DialogueContraintes';
import { estTeams, identifiantFormateur } from './filtresFormateurs';

/**
 * Résumé « Disponibilité et salles » d'un formateur, et le filtre par salle.
 * ← profil-contraintes.js
 *
 * Les règles de filtrage (`identifiantFormateur`, `peutUtiliser`…) vivent dans
 * `filtresFormateurs.js` : pures, donc testées.
 */
export { estTeams, identifiantFormateur, peutUtiliser } from './filtresFormateurs';

const TOUTES = '__toutes__';

export function FiltreSalle({ salles, valeur, onChange }) {
  // TEAMS compris : c'est un espace attribué à tous, et on peut vouloir le vérifier.
  if (salles.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Espace attribué</span>
      <Select value={valeur || TOUTES} onValueChange={(choix) => onChange(choix === TOUTES ? '' : choix)}>
        <SelectTrigger className="h-8 w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TOUTES}>Tous les espaces</SelectItem>
          {salles.map((salle) => (
            <SelectItem key={salle} value={salle}>
              {salle}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Le résumé de la ligne, et le bouton qui ouvre la modale. */
export function ColonneContraintes({ formateur, contraintes, salles, lectureSeule }) {
  const [ouvert, setOuvert] = useState(false);
  const espaces = contraintes?.espaces ?? [];
  const creneaux = contraintes?.indisponibilites?.length ?? 0;
  // « TEAMS » d'abord, et seulement s'il est déclaré : attribué à tous, sans rien écrire.
  const attribues = [...(salles.some(estTeams) ? ['TEAMS'] : []), ...espaces];

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-auto w-full justify-start gap-2 px-2 py-1 text-left font-normal"
        onClick={() => setOuvert(true)}
      >
        <CalendarClock className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 text-xs leading-tight">
          <span className="block truncate">
            {attribues.length === 0 ? 'Aucun espace attribué' : attribues.join(', ')}
          </span>
          <span className={creneaux > 0 ? 'block text-destructive' : 'block text-muted-foreground'}>
            {creneaux === 0 ? 'Toujours disponible' : `${creneaux} créneau(x) d'indisponibilité`}
          </span>
        </span>
      </Button>

      <DialogueContraintes
        ouvert={ouvert}
        onOuvertChange={setOuvert}
        formateur={identifiantFormateur(formateur)}
        nom={formateur.nomComplet}
        salles={salles}
        initiales={contraintes}
        lectureSeule={lectureSeule}
      />
    </>
  );
}
