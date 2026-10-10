import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fr } from 'date-fns/locale';
import { ChevronDown } from 'lucide-react';
import {
  analyserSemaine,
  libelleSemaine,
  lundiDeLaSemaine,
  semaineAffichable,
  valeurSemaine,
} from 'shared/domain';
import { Button } from '@/components/ui/button';
import { Calendar, CalendarDayButton } from '@/components/ui/calendar';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { chargerCalendrier, chargerJoursFeries } from '@/features/configuration/api';
import { bornesCalendrier } from '@/lib/bornesCalendrier';
import { nombre } from '@/lib/nombres';
import { cn } from '@/lib/utils';
import { vacancesEffectives } from '@/lib/vacancesEffectives';

/**
 * Le libellé de la semaine courante, qui OUVRE le calendrier.
 * ← la colonne « Sem » cliquable de `profil-principal.js:2882`, déjà reprise
 *   pour les stages (`CalendrierPeriode`).
 *
 * ═══ ⚠️ LE LIBELLÉ EST LE DÉCLENCHEUR ═══
 * Un texte « S1 » à côté d'un bouton « Choisir » disait deux fois la même chose
 * et occupait deux fois la place : l'un nommait la semaine, l'autre proposait
 * d'en changer. Fusionnés, la semaine s'annonce ET s'ouvre — c'est le motif
 * habituel d'un sélecteur de date.
 *
 * ⚠️ LES NUMÉROS SONT CEUX DE L'ANNÉE SCOLAIRE, pas ISO 8601 : S1 est la semaine
 * du 1er septembre, sans remise à zéro au 1er janvier. `formatWeekNumber` ne
 * peut pas servir — il ne reçoit que le numéro ISO déjà calculé, jamais la date.
 * C'est le COMPOSANT `WeekNumber` qu'il faut remplacer, lui reçoit ses jours.
 */

/** ⚠️ `semaineDe` LÈVE sur autre chose qu'une `Date` : on garde en amont. */
const estDate = (valeur) => valeur instanceof Date && !Number.isNaN(valeur.getTime());

export default function SelecteurSemaine({
  semaine,
  anneeScolaire,
  remplies = [],
  /*
   * ═══ ⚠️ LE TAUX DE CONFORMITÉ, PAS SEULEMENT « REMPLIE » (2026-09-27,
   * demande du porteur : « S4 pas encore complet à 98 % → point orange, S5
   * complet à 100 % → vert, 0 % → rouge ») ═══
   * `remplies` ne dit que « des séances existent » — vrai dès la première
   * heure posée, même très loin du chronogramme. `completudes` porte le
   * VRAI taux, déjà calculé par `completudeDeLAnnee` pour cet usage précis
   * (voir son commentaire : « pour le calendrier »).
   *
   * ⚠️ OPTIONNEL, PAR COMPATIBILITÉ : les autres écrans qui réutilisent ce
   * sélecteur (Édition, Mon emploi du temps, rattrapage) ne le passent pas
   * encore — sans lui, le point retombe sur le simple vert de `remplies`,
   * inchangé pour eux.
   */
  completudes = [],
  onChanger,
}) {
  const [ouvert, setOuvert] = useState(false);

  /*
   * ⚠️ LE CALENDRIER MONTRE FÉRIÉS ET VACANCES. Sans eux, on choisit une semaine
   * qui n'existe pas — vacances scolaires, ou amputée de deux jours fériés — et
   * on ne le découvre qu'une fois la grille ouverte, à moitié verrouillée. Les
   * deux requêtes sont celles du calendrier des stages, donc déjà en cache.
   */
  const feries = useQuery({
    queryKey: ['jours-feries', anneeScolaire],
    queryFn: () => chargerJoursFeries(anneeScolaire),
    enabled: Boolean(anneeScolaire) && ouvert,
    retry: false,
  });

  const calendrier = useQuery({
    queryKey: ['calendrier'],
    queryFn: chargerCalendrier,
    enabled: ouvert,
    retry: false,
  });

  /*
   * ⚠️ LA MÊME ANCRE QUE LE RESTE DE L'APPLICATION (2026-09-25, demande du
   * porteur : « je veux que ça change dans TOUS les calendriers de la
   * plateforme »). Sans elle, ce sélecteur continuerait de numéroter S1 sur le
   * 1er septembre alors que le chronogramme et l'avancement l'ancrent déjà sur
   * la rentrée la plus précoce — la même semaine se lirait sous deux numéros
   * différents selon l'écran.
   */
  const rentrees = calendrier.data?.rentrees ?? [];
  const analyse = semaine ? analyserSemaine(semaine, rentrees) : null;

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
      // ⚠️ Établissement ET réseau — voir `vacancesEffectives`.
      vacancesEffectives(calendrier.data).map((periode) => ({
        from: new Date(`${periode.debut}T00:00:00`),
        to: new Date(`${periode.fin}T00:00:00`),
      })),
    [calendrier.data]
  );

  /* Les semaines qui portent déjà des séances, par leur valeur « 2026-W12 ». */
  const avecSeances = useMemo(
    () => new Set(remplies.filter((entree) => entree.seances > 0).map((entree) => entree.semaine)),
    [remplies]
  );

  /* Le taux de conformité de chaque semaine déjà calculée, par sa valeur. */
  const tauxParSemaine = useMemo(
    () => new Map(completudes.map((entree) => [entree.semaine, entree.taux])),
    [completudes]
  );

  // Hors de l'année active, une semaine choisie n'aurait aucune séance à
  // montrer et la grille reviendrait vide sans rien qui l'explique.
  const bornes = bornesCalendrier(anneeScolaire, rentrees);

  const choisir = useCallback(
    (jour) => {
      if (!estDate(jour)) return;
      onChanger(valeurSemaine(jour, rentrees));
      setOuvert(false);
    },
    [onChanger, rentrees]
  );

  /*
   * ⚠️ DÉCLARÉ APRÈS `choisir`, `bornes` et `avecSeances` : un `const` est
   * hoisté mais NON initialisé, et le lire plus haut lève un `ReferenceError`
   * au montage. Le build, lui, ne dit rien.
   *
   * ⚠️ MÉMORISÉ, et pas écrit en place. Un composant redéfini à chaque rendu est
   * un TYPE différent pour React : les 60 boutons de jour seraient démontés puis
   * remontés à chaque frappe, ce qui referme au passage la carte au survol.
   * C'est la leçon déjà écrite dans le calendrier des stages.
   */
  const composants = useMemo(
    () => ({
      DayButton: (proprietes) => <BoutonJour {...proprietes} feries={feriesParDate} />,
      WeekNumber: (proprietes) => (
        <NumeroSemaine
          {...proprietes}
          courante={semaine}
          avecSeances={avecSeances}
          tauxParSemaine={tauxParSemaine}
          bornes={bornes}
          rentrees={rentrees}
          anneeScolaire={anneeScolaire}
          onChoisir={choisir}
        />
      ),
    }),
    [feriesParDate, semaine, avecSeances, tauxParSemaine, bornes, rentrees, anneeScolaire, choisir]
  );


  return (
    /*
     * ⚠️ UN POPOVER ANCRÉ SOUS LE BOUTON, et rien de plus. C'est le BOUTON qui
     * est centré dans sa rangée (`justify-self-center`) : le panneau, aligné sur
     * lui, tombe donc au centre sans qu'on ait à le positionner.
     *
     * Deux fausses pistes écartées, notées pour ne pas y revenir : le centrer À
     * LA MAIN est impossible ici — le conteneur de Radix porte un `transform`,
     * qui devient le référentiel d'un `position: fixed`, et le panneau tombait
     * 240 px à côté ; et une boîte de DIALOGUE se centre bien, mais transforme un
     * choix d'un clic en une fenêtre à ouvrir puis à refermer.
     */
    <Popover open={ouvert} onOpenChange={setOuvert}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs">
          <strong className="text-sm">{libelleSemaine(semaine, { court: true })}</strong>
          {/* ⚠️ Sur téléphone, la forme compacte (« 14–20 sept ») : la longue
              repoussait à la ligne tout ce qui suit le sélecteur. */}
          {analyse && (
            <>
              <span className="hidden font-normal text-muted-foreground sm:inline">
                {periodeCourte(analyse)}
              </span>
              <span className="font-normal text-muted-foreground sm:hidden">
                {periodeCompacte(analyse)}
              </span>
            </>
          )}
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>

      {/* Aligné sur le bouton, qui est lui-même au centre de la rangée. */}
      <PopoverContent align="center" collisionPadding={16} className="w-auto p-3">
        <div className="flex flex-col items-center">
        <Calendar
          locale={fr}
          mode="default"
          numberOfMonths={2}
          defaultMonth={analyse?.debut ?? (anneeScolaire ? new Date(anneeScolaire, 8, 1) : undefined)}
          {...bornes}
          modifiers={{ ferie: datesFeriees, vacances: datesVacances }}
          modifiersClassNames={{
            // Les mêmes teintes que la grille et que le calendrier des stages :
            // ambre pour un férié, bleu clair pour les vacances.
            ferie: 'bg-warning/25 font-medium rounded-md',
            vacances: 'bg-primary/10 rounded-md',
          }}
          showWeekNumber
          formatters={{ formatWeekNumberHeader: () => 'Sem' }}
          classNames={{
            week_number_header:
              'w-[--cell-size] pr-2 select-none text-[0.7rem] font-medium uppercase tracking-wide text-primary',
            week_number: 'pr-2',
          }}
          components={composants}
          /*
           * ⚠️ LE FILTRE EST APPELÉ AVEC AUTRE CHOSE QU'UNE DATE. react-day-picker
           * évalue ses `Matcher` sur des valeurs qui ne sont pas toujours des
           * `Date` valides — et `semaineDe` LÈVE dans ce cas, ce qui démontait la
           * page entière au lieu de laisser un jour non sélectionné.
           */
          selected={(jour) => estDate(jour) && valeurSemaine(jour, rentrees) === semaine}
          onDayClick={choisir}
        />

          <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[0.7rem] text-muted-foreground">
            <Reperage classe="bg-warning/25">jour férié</Reperage>
            <Reperage classe="bg-primary/10">vacances</Reperage>
            {/*
              ⚠️ LA LÉGENDE SUIT CE QUE LE POINT MONTRE VRAIMENT (2026-09-27) :
              un taux de conformité quand `completudes` en porte un, le simple
              « remplie » d'avant sinon — jamais les deux en même temps,
              puisque l'un remplace l'autre pour cette semaine.
            */}
            {completudes.length > 0 ? (
              <>
                <Reperage classe="bg-destructive" ronde>
                  0 %
                </Reperage>
                <Reperage classe="bg-warning" ronde>
                  incomplète
                </Reperage>
                <Reperage classe="bg-accent-green" ronde>
                  complète
                </Reperage>
              </>
            ) : (
              <Reperage classe="bg-accent-green" ronde>
                semaine remplie
              </Reperage>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** « du 31 août au 6 sept. » — les DEUX bornes, pas seulement le lundi. */
const jourCourt = (date) =>
  date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', '');

function periodeCourte({ debut, fin }) {
  return `du ${jourCourt(debut)} au ${jourCourt(fin)}`;
}

/** « 14–20 sept », ou « 31 août–6 sept » quand la semaine change de mois. */
function periodeCompacte({ debut, fin }) {
  return debut.getMonth() === fin.getMonth()
    ? `${debut.getDate()}–${jourCourt(fin)}`
    : `${jourCourt(debut)}–${jourCourt(fin)}`;
}

function Reperage({ classe, ronde, children }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block size-2.5', ronde ? 'rounded-full' : 'rounded', classe)} />
      {children}
    </span>
  );
}

/**
 * Le numéro de semaine SCOLAIRE, cliquable.
 *
 * ⚠️ C'est NOTRE bouton : react-day-picker ne lui applique ni `disabled` ni la
 * sélection. Il porte donc lui-même la borne d'année — sans quoi les semaines
 * d'août affichées en bordure, qui appartiennent à l'année scolaire PRÉCÉDENTE
 * et s'y numérotent S48 à S52, ouvriraient une grille vide sans explication.
 */
function NumeroSemaine({
  week,
  courante,
  avecSeances,
  tauxParSemaine,
  bornes,
  rentrees = [],
  anneeScolaire,
  onChoisir,
  // `asChild` n'est pas un attribut DOM et n'a rien à faire sur un `<th>`.
  asChild,
  /*
   * ⚠️ EXCLU DU SPREAD (2026-09-27) : `children` porte le numéro ISO déjà
   * rendu par react-day-picker, et un `<th {...proprietes} />` qui ne l'exclut
   * pas le laisserait réapparaître à la place d'une cellule vide — la même
   * fuite corrigée dans `decorationCalendrier.jsx`.
   */
  children,
  ...proprietes
}) {
  const premierJour = week?.days?.[0]?.date;
  // Même garde que pour le filtre : une semaine sans jour exploitable rend une
  // cellule vide plutôt que de faire tomber la page.
  if (!estDate(premierJour)) return <th {...proprietes} />;

  const lundi = lundiDeLaSemaine(premierJour);
  const numero = Number.isInteger(anneeScolaire)
    ? semaineAffichable(anneeScolaire, premierJour, rentrees)
    : null;

  /*
   * ⚠️ ANTÉRIEURE À L'ANCRE : NI NUMÉRO NI BOUTON (2026-09-27, demande du
   * porteur : « il faut qu'il y ait un seul S1 »). `semaineDe` rangeait cette
   * semaine dans la S1 elle-même — juste pour CLASSER une donnée, pas pour
   * numéroter un calendrier — et la colonne répétait alors « 1 » sur autant de
   * lignes que de semaines antérieures à une rentrée tardive. Une semaine qui
   * n'existe pas encore dans l'année ne peut de toute façon s'ouvrir sur rien.
   */
  if (numero === null) {
    return (
      <th {...proprietes} className={cn(proprietes.className, 'p-0 align-middle')}>
        <span className="mx-auto block h-7 w-7" aria-hidden="true" />
      </th>
    );
  }

  const valeur = valeurSemaine(lundi, rentrees);
  const estCourante = valeur === courante;
  const remplie = avecSeances.has(valeur);

  /*
   * ═══ ⚠️ LE TAUX DE CONFORMITÉ, QUAND IL EXISTE, REMPLACE « REMPLIE »
   * (2026-09-27, demande du porteur) ═══ 0 % en rouge, 100 % en vert, tout le
   * reste en orange — la semaine qui a des séances mais n'est pas encore au
   * niveau du chronogramme (98 %, par exemple) ne peut plus se confondre avec
   * celle qui l'a atteint.
   */
  const taux = tauxParSemaine?.get(valeur);
  const conforme = typeof taux === 'number';
  const pastille = conforme
    ? taux === 100
      ? 'bg-accent-green'
      : taux === 0
        ? 'bg-destructive'
        : 'bg-warning'
    : remplie
      ? 'bg-accent-green'
      : null;
  const titrePastille = conforme ? ` — ${nombre(taux)} % conforme au chronogramme` : remplie ? ' — déjà remplie' : '';

  const horsAnnee =
    (bornes?.startMonth && lundi < bornes.startMonth) ||
    (bornes?.endMonth && lundi > bornes.endMonth);

  return (
    <th {...proprietes} className={cn(proprietes.className, 'p-0 align-middle')}>
      <button
        type="button"
        disabled={horsAnnee}
        onClick={() => onChoisir(lundi)}
        aria-pressed={estCourante}
        title={
          horsAnnee
            ? 'Cette semaine est hors de l’année scolaire active'
            : `Semaine ${numero}${titrePastille}`
        }
        className={cn(
          'relative mx-auto flex h-7 w-7 items-center justify-center rounded-md',
          'text-xs font-medium tabular-nums transition-colors',
          'disabled:pointer-events-none disabled:opacity-30',
          estCourante ? 'bg-primary text-primary-foreground' : 'text-primary hover:bg-primary/10'
        )}
      >
        {numero}
        {/* ⚠️ UNE PASTILLE, PAS UNE COULEUR DE FOND : le fond dit déjà quelle
            semaine est ouverte, et deux significations sur le même aplat ne se
            distinguent plus. */}
        {pastille && !estCourante && (
          <span className={cn('absolute bottom-0.5 size-1 rounded-full', pastille)} />
        )}
      </button>
    </th>
  );
}

/**
 * Un jour du calendrier — et, s'il est férié, la carte qui l'explique.
 *
 * ⚠️ SANS ELLE, LA COULEUR NE DIT RIEN. Un jour ambre au milieu du mois ne
 * nomme ni la fête ni son incertitude : les dates lunaires sont des ESTIMATIONS,
 * confirmées quelques jours avant, et un décalage déplace la semaine qu'on est
 * en train de choisir. C'est exactement la carte du calendrier des stages.
 */
function BoutonJour({ feries, ...proprietes }) {
  const bouton = <CalendarDayButton {...proprietes} />;
  const ferie = feries?.get(enTexte(proprietes.day?.date));
  if (!ferie) return bouton;

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      {/*
        ⚠️ LE DÉCLENCHEUR EST L'ENVELOPPE, PAS LE BOUTON. `CalendarDayButton`
        garde une `ref` interne pour la mise au point clavier et ne la transmet
        pas : la lui prendre par `asChild` casserait la navigation au clavier.
      */}
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
          {ferie.estime
            ? 'Date estimée — fête lunaire, confirmée quelques jours avant.'
            : 'Jour férié — aucune séance ne peut y être placée.'}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}

/** ⚠️ La date LOCALE, pas `toISOString()` : celui-ci passe par UTC et rend la
 *  veille pour tout ce qui suit minuit au Maroc. */
function enTexte(date) {
  if (!estDate(date)) return '';
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}
