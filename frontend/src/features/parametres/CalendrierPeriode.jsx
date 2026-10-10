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
  // ⚠️ `!` : la classe des vacances, posée sur la même cellule, ne doit pas
  // recouvrir la période — c'est la confusion que la teinte veut éviter.
  pink: {
    plage: '!bg-accent-pink/35 !rounded-none',
    bord: '!bg-accent-pink/70',
    attente: '!bg-accent-pink/70 !rounded-md ring-2 ring-inset ring-accent-pink',
    pastille: 'bg-accent-pink/70',
  },
  // La formation — gris, comme la ligne éteinte de la grille.
  gris: {
    plage: '!bg-zinc-300/70 !rounded-none',
    bord: '!bg-zinc-400',
    attente: '!bg-zinc-400 !rounded-md ring-2 ring-inset ring-zinc-500',
    pastille: 'bg-zinc-400',
  },
};

/**
 * ═══ PLUSIEURS PÉRIODES D'UN COUP (2026-10-10, demande du porteur) ═══
 * Un groupe part souvent deux ou trois fois dans l'année : les saisir une par
 * une obligeait à rouvrir le calendrier et à recocher les mêmes groupes.
 *
 * ⚠️ PLUS DE `mode="range"` : react-day-picker n'y tient qu'UNE plage. Les clics
 * sont donc arbitrés ici :
 *   - un premier clic pose le DÉBUT (case cerclée) ;
 *   - le suivant pose la FIN — dans un sens comme dans l'autre ; recliquer le
 *     même jour fait une période d'un jour ;
 *   - cliquer DANS une période déjà tracée la retire.
 * Deux périodes qui se chevauchent sont fusionnées : un même jour n'a pas à
 * être compté deux fois.
 *
 * @param {{plages: Array<{from: Date, to: Date}>, debut?: Date}} valeur
 */
export default function CalendrierPeriode({ valeur, onChange, anneeScolaire, couleur, existantes = [] }) {
  const plages = valeur?.plages ?? [];
  const debut = valeur?.debut;
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
    // Trois mois (2026-10-10, demande du porteur) : un trimestre d'un regard.
    numberOfMonths: 3,
    defaultMonth: anneeScolaire ? new Date(anneeScolaire, 8, 1) : undefined,
    ...decoration,
    modifiers: {
      ...decoration.modifiers,
      plage: plages,
      plage_debut: plages.map((p) => p.from),
      plage_fin: plages.map((p) => p.to),
      attente: debut ? [debut] : [],
      existante: existantes,
    },
    modifiersClassNames: {
      ...decoration.modifiersClassNames,
      plage: classesCouleur.plage,
      plage_debut: cn(classesCouleur.bord, '!rounded-l-md'),
      plage_fin: cn(classesCouleur.bord, '!rounded-r-md'),
      attente: classesCouleur.attente,
      /* Déjà enregistrée pour un sujet retenu : un CADRE en pointillés, pas un
         fond — le fond reste celui de la saisie en cours, qu'il ne faut pas
         confondre avec une donnée déjà en base. */
      existante: 'outline-dashed outline-2 -outline-offset-2 outline-destructive/60 rounded-md',
    },
  };

  const cliquer = (jour, modificateurs) => {
    if (modificateurs.disabled || modificateurs.hidden) return;

    if (debut) {
      const [from, to] = debut <= jour ? [debut, jour] : [jour, debut];
      onChange({ plages: fusionner([...plages, { from, to }]) });
      return;
    }

    const touchee = plages.find((p) => jour >= p.from && jour <= p.to);
    if (touchee) {
      onChange({ plages: plages.filter((p) => p !== touchee) });
      return;
    }

    onChange({ plages, debut: jour });
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
          onDayClick={cliquer}
          showWeekNumber
          {...colonneSemaine(communs.components, communs.rentrees, anneeScolaire)}
        />
      </div>

      <p className="px-1 text-xs text-muted-foreground">
        {debut
          ? 'Cliquez le dernier jour de cette période.'
          : 'Cliquez le premier puis le dernier jour de chaque période — autant de périodes que nécessaire. Cliquer une période la retire.'}
      </p>

      <LegendeCalendrier>
        <Pastille classe={classesCouleur.pastille} libelle="Période sélectionnée" />
        {existantes.length > 0 && (
          <Pastille
            classe="border-0 outline-dashed outline-2 -outline-offset-2 outline-destructive/60"
            libelle="Déjà déclarée pour les sujets retenus"
          />
        )}
      </LegendeCalendrier>
    </div>
  );
}

/**
 * Range les plages et fond celles qui se CHEVAUCHENT. Deux périodes bout à bout
 * restent deux : octobre puis novembre peuvent être deux stages distincts.
 */
function fusionner(plages) {
  const rangees = [...plages].sort((a, b) => a.from - b.from);
  const fusion = [];
  for (const plage of rangees) {
    const derniere = fusion[fusion.length - 1];
    if (derniere && plage.from <= derniere.to) {
      if (plage.to > derniere.to) derniere.to = plage.to;
    } else {
      fusion.push({ ...plage });
    }
  }
  return fusion;
}

/** « AAAA-MM-JJ » en heure LOCALE — `toISOString()` décalerait d'un jour. */
export function enTexte(date) {
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}
