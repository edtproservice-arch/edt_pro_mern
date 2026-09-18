import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { analyserSemaine, valeurSemaine } from 'shared/domain';
import { Button } from '@/components/ui/button';
import SelecteurSemaine from './SelecteurSemaine';
import { cn } from '@/lib/utils';

/**
 * Navigation d'une semaine à l'autre — flèches + sélecteur + « cette semaine ».
 *
 * ← extrait le 2026-09-04 (demande du porteur : « le bouton calendrier je veux
 * qu'il être comme celui en page Emploi et Édition en session directeur »).
 *
 * ═══ ⚠️ TROISIÈME OCCURRENCE, DONC EXTRACTION ═══
 * Ce bloc vivait identique dans `PageEmploi.jsx` (en fonction locale) et dans
 * `PageEdition.jsx` (recopié inline, avec le même commentaire de mesure) : deux
 * exemplaires qui auraient fini par diverger au premier ajustement, exactement
 * le défaut du §4.2. « Mon emploi du temps » (F14) en demande un troisième —
 * c'est le point où ce projet extrait toujours, plutôt que de recopier une
 * troisième fois.
 *
 * ⚠️ CE BLOC NE PORTE QUE LES FLÈCHES ET LE BOUTON, et c'est délibéré : les
 * deux flèches ont la MÊME largeur, donc centrer le bloc revient à centrer le
 * BOUTON. « Cette semaine » et un compteur à côté le décalaient de 105 px,
 * mesuré sur « Emploi » — ils vivent ailleurs dans la barre, jamais ici.
 */
export default function NavigationSemaine({
  className,
  semaine,
  onChanger,
  anneeScolaire,
  remplies = [],
  courante,
}) {
  const analyse = semaine ? analyserSemaine(semaine) : null;

  const decaler = (decalage) => {
    if (!analyse) return;
    const date = new Date(analyse.debut);
    date.setDate(date.getDate() + decalage * 7);
    onChanger(valeurSemaine(date));
  };

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        aria-label="Semaine précédente"
        onClick={() => decaler(-1)}
      >
        <ChevronLeft className="size-4" />
      </Button>

      <SelecteurSemaine
        semaine={semaine}
        anneeScolaire={anneeScolaire}
        remplies={remplies}
        onChanger={onChanger}
      />

      <Button
        variant="outline"
        size="icon"
        className="size-8"
        title="Revenir à la semaine du jour"
        aria-label="Revenir à la semaine du jour"
        disabled={semaine === courante}
        onClick={() => onChanger(courante)}
      >
        <CalendarDays className="size-4" />
      </Button>

      <Button
        variant="outline"
        size="icon"
        className="size-8"
        aria-label="Semaine suivante"
        onClick={() => decaler(1)}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
