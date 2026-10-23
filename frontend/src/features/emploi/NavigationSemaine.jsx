import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { analyserSemaine, valeurSemaine } from 'shared/domain';
import { Button } from '@/components/ui/button';
import SelecteurSemaine from './SelecteurSemaine';
import { cn } from '@/lib/utils';
import { useLocation } from 'react-router-dom';
import { empreinte, useEtatPartage } from '@/features/guidage/useEtatPartage';

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
  /* ⚠️ VOIR `SelecteurSemaine` : optionnel, purement transmis. */
  completudes = [],
  courante,
  /*
   * Distingue deux navigations de la MÊME page pendant le guidage (la fenêtre de
   * rattrapage d'une absence, celle d'un document) — sans quoi l'une piloterait l'autre.
   */
  cleGuidage = '',
}) {
  /*
   * ═══ LA SEMAINE AFFICHÉE EST PARTAGÉE, PAS LE CLIC SUR LA FLÈCHE (2026-10-23,
   * signalé par le porteur : « le directeur bascule vers S8, l'admin voit S7 ») ═══
   * « Semaine suivante » est un geste RELATIF : rejoué chez l'autre, il décale SA
   * semaine d'un cran — un seul clic perdu, ou deux écrans partis de semaines
   * différentes, et ils restaient décalés pour de bon. C'est donc la semaine
   * elle-même, en valeur ABSOLUE, qui voyage ; les flèches, le sélecteur et
   * « aujourd'hui » ne sont plus rejoués (`data-guidage-ignorer`).
   */
  const { pathname } = useLocation();
  useEtatPartage(`semaine.${empreinte(`${pathname}|${cleGuidage}`)}`, semaine ?? null, (valeur) => {
    if (typeof valeur === 'string' && valeur !== semaine) onChanger(valeur);
  });

  const analyse = semaine ? analyserSemaine(semaine) : null;

  const decaler = (decalage) => {
    if (!analyse) return;
    const date = new Date(analyse.debut);
    date.setDate(date.getDate() + decalage * 7);
    onChanger(valeurSemaine(date));
  };

  return (
    <div data-guidage-ignorer className={cn('flex items-center gap-1', className)}>
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
        completudes={completudes}
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
