import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import {
  LegendeCalendrier,
  Pastille,
  colonneSemaine,
  useDecorationCalendrier,
} from '@/components/common/decorationCalendrier';

/**
 * Calendrier de sélection d'une période — une PLAGE LIBRE.
 *
 * ═══ UN SEUL GESTE, POUR LES STAGES COMME POUR LES FORMATIONS ═══
 * (2026-08-26, demande du porteur — REVIENT sur la décision du 2026-08-17.)
 * Le stage se saisissait par SEMAINES ENTIÈRES, au motif qu'un établissement
 * envoie ses groupes du lundi au samedi. Ce n'est pas toujours vrai, et la
 * contrainte empêchait de saisir ce qui existe : un stage qui commence un
 * mercredi, ou qui s'arrête la veille d'un pont. Une formation dure déjà ce
 * qu'elle dure — les deux écrans emploient donc le même geste.
 *
 * ⚠️ LA COLONNE « SEM » RESTE, informative. Les établissements raisonnent en
 * semaines scolaires — « le stage de la S12 » — même quand les dates ne s'y
 * alignent pas ; et le chronogramme comme l'emploi du temps n'affichent QUE des
 * numéros de semaine. Sans elle, il faudrait les compter à la main pour
 * recouper.
 *
 * ═══ FÉRIÉS ET VACANCES SONT MONTRÉS ═══
 * Placer un stage sur les vacances scolaires ou une formation un jour férié n'a
 * pas de sens. Ils sont donc colorés, avec leur légende : les découvrir après
 * coup dans l'emploi du temps coûte une ressaisie.
 *
 * Les VACANCES reprennent le bleu clair du grand calendrier de la page
 * « Calendrier » — c'est la même notion, elle garde sa couleur d'un écran à
 * l'autre. La période EN COURS DE SÉLECTION prend donc le violet : elle n'existe
 * que le temps de la saisie, elle ne doit pas se confondre avec une donnée déjà
 * enregistrée.
 *
 * Un jour férié porte une CARTE AU SURVOL : la couleur seule dit qu'on ne peut
 * rien y placer, pas de quelle fête il s'agit ni si sa date est encore une
 * estimation lunaire — ce qui change tout pour une période qui la chevauche.
 *
 * ⚠️ Les numéros de semaine ne sont PAS ceux d'ISO 8601 : S1 est la semaine
 * contenant le 1er septembre, sans remise à zéro au 1er janvier. Le formateur
 * de react-day-picker est donc remplacé par la règle du domaine.
 */
/**
 * ═══ ⚠️ LA TEINTE DU CALENDRIER EST CELLE DE LA GRILLE ═══
 * Un stage se dessine en MAGENTA dans l'emploi du temps et le chronogramme, une
 * formation en GRIS : le calendrier où on les SAISIT doit parler la même langue,
 * sinon on trace une période dans une couleur et on la retrouve dans une autre.
 *
 * ⚠️ LE CYAN A ÉTÉ ABANDONNÉ (2026-08-25) — il ne se distinguait plus du bleu
 * pâle des vacances, qui est affiché SUR CE MÊME CALENDRIER. C'est ici que la
 * confusion coûtait le plus cher : on posait un stage sur des vacances en
 * croyant lire sa propre sélection.
 *
 * Les teintes de sélection sont plus SOUTENUES que celles de la grille : ici la
 * période est ce qu'on manipule, là-bas c'est un état de fond.
 */
const TEINTES = {
  // Le stage — magenta, comme la ligne verrouillée de la grille.
  pink: {
    selected:
      'data-[selected-single=true]:bg-accent-pink/70 data-[selected-single=true]:text-foreground data-[range-start=true]:bg-accent-pink/70 data-[range-start=true]:text-foreground data-[range-end=true]:bg-accent-pink/70 data-[range-end=true]:text-foreground',
    middle: 'data-[range-middle=true]:bg-accent-pink/35 data-[range-middle=true]:text-foreground',
    pastille: 'bg-accent-pink/70',
  },
  // La formation — gris, comme la ligne éteinte de la grille.
  gris: {
    selected:
      'data-[selected-single=true]:bg-zinc-400 data-[selected-single=true]:text-foreground data-[range-start=true]:bg-zinc-400 data-[range-start=true]:text-foreground data-[range-end=true]:bg-zinc-400 data-[range-end=true]:text-foreground',
    middle: 'data-[range-middle=true]:bg-zinc-300/70 data-[range-middle=true]:text-foreground',
    pastille: 'bg-zinc-400',
  },
};

export default function CalendrierPeriode({ valeur, onChange, anneeScolaire, couleur }) {
  /*
   * ⚠️ Le défaut suit le MODE, comme avant : la sélection par SEMAINES est celle
   * des stages, la plage libre celle des formations. Un appelant qui ne dit rien
   * garde donc la bonne teinte.
   */
  const classesCouleur = TEINTES[couleur] ?? TEINTES.gris;

  /* Langue, jours fériés, vacances et bornes — la MÊME décoration que tous les
     autres calendriers de saisie. */
  const decoration = useDecorationCalendrier(anneeScolaire, { classesCouleur });

  /*
    ⚠️ La couleur du jour retenu ne se règle PAS par `modifiersClassNames` :
    `CalendarDayButton` la pose lui-même en `data-[selected-single=true]:
    bg-primary`, sur le bouton, donc PAR-DESSUS la classe du `<td>`. C'est le
    `className` du bouton qu'il faut surcharger — d'où `classesCouleur`, que la
    décoration commune transmet à son bouton de jour.
  */
  const communs = {
    numberOfMonths: 2,
    defaultMonth: anneeScolaire ? new Date(anneeScolaire, 8, 1) : undefined,
    ...decoration,
  };

  return (
    <div className="space-y-2">
      <div className="rounded-lg border p-2">
        {/*
          ═══ ⚠️ PLAGE LIBRE, MÊME POUR UN STAGE ═══
          (2026-08-26, demande du porteur — REVIENT sur la décision du
          2026-08-17.) Le stage se sélectionnait par SEMAINES ENTIÈRES, au motif
          qu'un établissement envoie ses groupes du lundi au dimanche. Ce n'est
          pas toujours vrai, et la contrainte empêchait de saisir ce qui existe :
          un stage qui commence un mercredi, ou qui s'arrête la veille d'un pont.
          Les deux écrans emploient donc le même geste.

          ⚠️ LA COLONNE « SEM » RESTE, et c'est tout l'objet de la demande : les
          établissements raisonnent en semaines scolaires — « le stage de la S12 »
          — même quand les dates ne s'y alignent pas. Sans elle, il faudrait les
          compter à la main pour recouper avec le chronogramme et l'emploi du
          temps, qui n'affichent QUE des numéros de semaine.

          ⚠️ ELLE N'EST PLUS CLIQUABLE : ce serait un second mécanisme de
          sélection à côté de la plage, et cliquer une semaine en cours de saisie
          écraserait la borne déjà posée. Elle informe, elle ne commande pas.
        */}
        <Calendar
          {...communs}
          mode="range"
          selected={valeur}
          onSelect={onChange}
          showWeekNumber
          {...colonneSemaine(communs.components)}
        />
      </div>

      <LegendeCalendrier>
        <Pastille classe={classesCouleur.pastille} libelle="Période sélectionnée" />
      </LegendeCalendrier>
    </div>
  );
}

/** « AAAA-MM-JJ » en heure LOCALE — `toISOString()` décalerait d'un jour. */
export function enTexte(date) {
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}
