import { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DialogueContraintes from './DialogueContraintes';

/**
 * Colonne « Disponibilité et salles » du tableau des formateurs, et son filtre.
 * ← profil-contraintes.js
 */

/** L'identifiant d'un formateur de la base — la règle de `parseBase`. */
export function identifiantFormateur(formateur) {
  const matricule = String(formateur?.matricule ?? '').trim();
  return matricule !== '' ? matricule : String(formateur?.nomComplet ?? '').trim();
}

/**
 * Ce formateur peut-il être placé dans cette salle ?
 * ⚠️ AUCUNE SALLE COCHÉE = AUCUNE RESTRICTION (décision du porteur) : il reste
 * retenu par le filtre, comme partout ailleurs.
 */
export function peutUtiliser(contraintes, salle) {
  const espaces = contraintes?.espaces ?? [];
  return espaces.length === 0 || espaces.includes(salle);
}

const TOUTES = '__toutes__';

export function FiltreSalle({ salles, valeur, onChange }) {
  const reelles = salles.filter((s) => String(s).toUpperCase() !== 'TEAMS');
  if (reelles.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Qui peut utiliser</span>
      <Select value={valeur || TOUTES} onValueChange={(choix) => onChange(choix === TOUTES ? '' : choix)}>
        <SelectTrigger className="h-8 w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TOUTES}>toutes les salles</SelectItem>
          {reelles.map((salle) => (
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
            {espaces.length === 0 ? 'Toutes les salles' : espaces.join(', ')}
          </span>
          <span className={creneaux > 0 ? 'block text-destructive' : 'block text-muted-foreground'}>
            {creneaux === 0 ? 'Toujours disponible' : `${creneaux} créneau(x) à éviter`}
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
