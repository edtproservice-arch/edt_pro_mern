import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fr } from 'date-fns/locale';
import { CalendarDayButton } from '@/components/ui/calendar';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { chargerCalendrier, chargerJoursFeries } from '@/features/configuration/api';
import { bornesCalendrier } from '@/lib/bornesCalendrier';
import { semaineDe } from 'shared/domain';
import { cn } from '@/lib/utils';

/**
 * Ce que TOUT calendrier de saisie doit montrer : la langue, les jours fériés,
 * les vacances, et les bornes de l'année scolaire.
 *
 * ═══ ⚠️ UN SEUL ENDROIT, POUR TOUS LES CALENDRIERS ═══
 * Les stages, les formations et l'EFM régional posent tous une date dans la même
 * année, avec les mêmes empêchements. Recopier la décoration dans chaque écran,
 * c'est la garantie qu'elle divergera : l'un afficherait les vacances et l'autre
 * non, et l'on poserait un examen sur une semaine fermée sans que rien ne le
 * dise. C'est le §4.2 du plan appliqué à une mise en forme.
 *
 * ⚠️ LA LANGUE EN FAIT PARTIE. Sans `locale: fr`, react-day-picker rend
 * « September » et « Mo Tu We » — l'anglais, sur un écran entièrement français.
 */
export function useDecorationCalendrier(anneeScolaire, { classesCouleur } = {}) {
  const feries = useQuery({
    queryKey: ['jours-feries', anneeScolaire],
    queryFn: () => chargerJoursFeries(anneeScolaire),
    enabled: Boolean(anneeScolaire),
    retry: false,
  });

  const calendrier = useQuery({
    queryKey: ['calendrier'],
    queryFn: chargerCalendrier,
    retry: false,
  });

  const datesFeriees = useMemo(
    () => (feries.data?.joursFeries ?? []).map((jour) => new Date(`${jour.date}T00:00:00`)),
    [feries.data]
  );

  /** « AAAA-MM-JJ » → le férié, pour la carte au survol. */
  const feriesParDate = useMemo(
    () => new Map((feries.data?.joursFeries ?? []).map((jour) => [jour.date, jour])),
    [feries.data]
  );

  const datesVacances = useMemo(
    () =>
      (calendrier.data?.vacances ?? []).map((periode) => ({
        from: new Date(`${periode.debut}T00:00:00`),
        to: new Date(`${periode.fin}T00:00:00`),
      })),
    [calendrier.data]
  );

  /*
   * ⚠️ MÉMORISÉ, et pas écrit en place. Un composant redéfini à chaque rendu est
   * un TYPE différent pour React : les 60 boutons de jour seraient démontés puis
   * remontés à chaque frappe, ce qui referme au passage la carte au survol.
   */
  const composants = useMemo(
    () => ({
      DayButton: (proprietes) => (
        <BoutonJour {...proprietes} feries={feriesParDate} classesCouleur={classesCouleur} />
      ),
    }),
    [feriesParDate, classesCouleur]
  );

  return {
    locale: fr,
    // Le calendrier ne sort pas de l'année scolaire active — une date posée en
    // dehors serait enregistrée puis jamais retrouvée.
    ...bornesCalendrier(anneeScolaire),
    modifiers: { ferie: datesFeriees, vacances: datesVacances },
    modifiersClassNames: {
      ferie: 'bg-warning/20 font-medium rounded-md',
      // Le bleu clair du grand calendrier : même notion, même couleur.
      vacances: 'bg-primary/10 rounded-md',
    },
    components: composants,
  };
}

/**
 * Un jour du calendrier.
 *
 * Deux ajouts au bouton de shadcn :
 *   1. la SÉLECTION prend la couleur de ce qu'on saisit (magenta pour un stage,
 *      gris pour une formation) ;
 *   2. un jour FÉRIÉ porte une carte au survol — intitulé français et arabe.
 *
 * ⚠️ LE DÉCLENCHEUR EST L'ENVELOPPE, PAS LE BOUTON : `CalendarDayButton` garde
 * une `ref` interne pour la mise au point clavier et ne la transmet pas ; la lui
 * prendre par `asChild` casserait la navigation au clavier.
 */
export function BoutonJour({ feries, classesCouleur, ...proprietes }) {
  const bouton = (
    <CalendarDayButton
      {...proprietes}
      className={cn(classesCouleur?.selected, classesCouleur?.middle, proprietes.className)}
    />
  );

  const ferie = feries?.get(enTexte(proprietes.day.date));
  if (!ferie) return bouton;

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <div className="h-full w-full">{bouton}</div>
      </HoverCardTrigger>

      <HoverCardContent side="top" align="center" className="w-auto max-w-64 p-3">
        <p className="text-sm font-medium leading-snug">{ferie.intitule}</p>

        {/* `dir="rtl"` : sinon chiffres et parenthèses se rendent à l'envers. */}
        {ferie.intituleAr && (
          <p dir="rtl" lang="ar" className="mt-0.5 text-sm text-muted-foreground">
            {ferie.intituleAr}
          </p>
        )}

        <p className="mt-2 text-xs text-muted-foreground">
          {/*
            ⚠️ SEULES LES FÊTES LUNAIRES SONT DES ESTIMATIONS. À force d'être
            partout, la mention ne signalait plus rien et personne n'allait
            corriger celles qui en avaient besoin.
          */}
          {ferie.estime
            ? 'Date estimée — fête lunaire, confirmée quelques jours avant.'
            : 'Jour férié — aucune séance ne peut y être placée.'}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * La légende des teintes.
 *
 * Sans elle, l'ambre et le bleu ne s'expliquent pas : on voit des couleurs sans
 * savoir ce qu'elles interdisent.
 */
export function LegendeCalendrier({ children }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
      <Pastille classe="bg-warning/20" libelle="Jour férié" />
      <Pastille classe="bg-primary/10" libelle="Vacances" />
      {children}
    </div>
  );
}

export function Pastille({ classe, libelle }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block size-3 rounded-sm border', classe)} />
      {libelle}
    </span>
  );
}


/**
 * La colonne des SEMAINES SCOLAIRES, à passer à `<Calendar>`.
 *
 * ═══ ⚠️ POURQUOI ELLE EST ICI ET PLUS DANS UN SEUL ÉCRAN ═══
 * (2026-09-03, demande du porteur sur le calendrier national : « ajouter une
 * colonne semaine pour distinguer entre les semaines ».) Elle existait déjà
 * dans `CalendrierPeriode` — stages et formations. La recopier, c'était deux
 * numérotations à tenir cohérentes, et le jour où l'une aurait dérivé, la même
 * semaine se serait appelée S12 sur un écran et S13 sur l'autre. Or c'est
 * précisément ce numéro qui sert à recouper avec le chronogramme et l'emploi du
 * temps, qui n'affichent QUE des numéros de semaine.
 *
 * Usage : `<Calendar showWeekNumber {...colonneSemaine(communs.components)} />`
 */
export function colonneSemaine(composants = {}) {
  return {
    /*
     * ⚠️ `formatWeekNumber(numero, dateLib)` NE REÇOIT PAS DE DATE — son premier
     * argument est déjà le numéro ISO calculé par la bibliothèque. Impossible
     * d'en tirer la semaine SCOLAIRE, qui part du lundi de la semaine du
     * 1er septembre : on remplace donc le COMPOSANT, qui reçoit `week` et donc
     * ses jours.
     */
    components: { ...composants, WeekNumber: NumeroSemaine },
    /*
     * En-tête de la colonne : sans lui, une colonne de nombres à gauche du lundi
     * ne dit pas qu'il s'agit de semaines — on la lit comme une date ou un
     * numéro de ligne. L'existant l'intitulait déjà « Sem ».
     */
    formatters: { formatWeekNumberHeader: () => 'Sem' },
    classNames: {
      week_number_header:
        'w-[--cell-size] pr-2 select-none text-[0.7rem] font-medium uppercase tracking-wide text-primary',
      week_number: 'pr-2',
    },
  };
}

/**
 * Numéro de semaine SCOLAIRE — une ÉTIQUETTE, jamais un bouton.
 *
 * ⚠️ IL NE COMMANDE RIEN. Un clic qui retiendrait la semaine entière entrerait
 * en concurrence avec la borne qu'on est en train de poser — et l'écraserait
 * sans le dire.
 *
 * ⚠️ CE N'EST PAS UN NUMÉRO ISO 8601 : S1 est la semaine du 1er septembre, sans
 * remise à zéro au 1er janvier. C'est celui du chronogramme et de l'emploi du
 * temps, donc le seul avec lequel on puisse recouper.
 *
 * ⚠️ EN BLEU, en-tête compris. En gris, cette colonne se lisait comme une
 * numérotation de lignes — or ce sont des semaines SCOLAIRES, la seule donnée du
 * calendrier qui ne soit pas une date. Le bleu `primary` la détache des jours
 * sans rejouer aucune des teintes qui portent déjà un sens ici.
 */
function NumeroSemaine({ week, ...proprietes }) {
  const premierJour = week?.days?.[0]?.date;
  if (!premierJour) return <th {...proprietes} />;

  return (
    <th {...proprietes} className={cn(proprietes.className, 'p-0 align-middle')}>
      <span className="mx-auto flex h-7 w-7 items-center justify-center text-xs font-medium tabular-nums text-primary">
        {semaineDe(premierJour).numero}
      </span>
    </th>
  );
}

/** `Date` → « AAAA-MM-JJ », dans le fuseau LOCAL. */
function enTexte(date) {
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}
