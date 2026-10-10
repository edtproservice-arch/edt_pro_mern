import { useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { lundiDeLaSemaine, semaineAffichable } from 'shared/domain';
import { chargerCalendrier, chargerJoursFeries } from '@/features/configuration/api';
import { Maximize2, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { vacancesEffectives } from '@/lib/vacancesEffectives';

/**
 * Les périodes en FRISE ANNUELLE — une ligne par sujet, une colonne par semaine
 * scolaire, chaque période en barre (2026-10-10, demande du porteur : « un
 * affichage comme un calendrier pour mieux distinguer les périodes »).
 *
 * ═══ POURQUOI UNE FRISE ET PAS UN CALENDRIER MENSUEL ═══ La question qu'on
 * pose à cette page est « qui part QUAND, et en même temps que qui ? ». Un
 * calendrier par mois répond pour UN jour ; la frise montre l'année entière
 * d'un regard, et deux groupes en stage la même semaine s'y lisent l'un sous
 * l'autre. C'est la forme du chronogramme, que l'établissement connaît déjà.
 *
 * ⚠️ AU JOUR PRÈS, PAS À LA SEMAINE : la barre est placée par sa date de début
 * et sa durée, en pourcentage de l'année affichée. Arrondir à la semaine
 * aurait fait se toucher deux stages séparés d'un week-end.
 *
 * Les VACANCES (bleu) et les JOURS FÉRIÉS (ambre) sont peints sur toute la
 * hauteur, avec leur intitulé dans une bande d'en-tête (2026-10-10, demande du
 * porteur) — mêmes teintes que les calendriers de saisie : un stage posé
 * dessus se voit tout de suite.
 *
 * ⚠️ LES VACANCES DU RÉSEAU EN PLUS DE CELLES DE L'ÉTABLISSEMENT — voir
 * `vacancesEffectives`, la même règle que les calendriers de saisie.
 */

const NOMBRE_SEMAINES = 46; // de la semaine du 1er septembre à mi-juillet
const UN_JOUR = 86400000;

// Une teinte par RANG de période dans la ligne : deux stages d'un même groupe
// ne se confondent pas, même collés.
const TEINTES = [
  'bg-primary text-primary-foreground',
  'bg-accent-pink text-white',
  'bg-emerald-600 text-white',
  'bg-amber-500 text-white',
];

/*
 * ═══ ZOOM : JOUR, SEMAINE, MOIS (2026-10-10, demande du porteur) ═══ Trois
 * échelles, en PIXELS PAR JOUR. Tout le reste (barres, vacances, fériés) est
 * placé en POURCENTAGE de la piste : changer d'échelle n'élargit que la piste,
 * et rien d'autre n'est à recalculer.
 *   - Mois : l'année tient d'un regard (≈ la largeur d'un écran) ;
 *   - Semaine : les semaines se lisent, les dates des barres s'écrivent ;
 *   - Jour : une colonne par jour, numérotée — pour caler un stage au jour près.
 */
const ECHELLES = [
  { valeur: 'mois', libelle: 'Mois', pxParJour: 3.2 },
  { valeur: 'semaine', libelle: 'Semaine', pxParJour: 10 },
  { valeur: 'jour', libelle: 'Jour', pxParJour: 30 },
];
const LARGEUR_ETIQUETTE = 160; // la colonne des noms, `w-40`
const INITIALES = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

/**
 * Une case d'en-tête de semaine — badges et carte au survol du CHRONOGRAMME
 * (`EnteteSemaine` / `Badges` de GrilleChronogramme.jsx, 2026-10-10, demande
 * du porteur : « le même pour jour férié avec hover card ») : « VAC » sur une
 * semaine de vacances, « N JF » sur une semaine qui porte N jours fériés, et au
 * survol la semaine, ses dates, l'intitulé (français et arabe) de chaque férié.
 */
function EnteteSemaine({ lundi, numero, echelle, vacances, feries }) {
  const dimanche = new Date(lundi);
  dimanche.setDate(dimanche.getDate() + 6);
  const court = (date) => date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

  const contenu = (
    <div
      className={cn(
        'flex flex-1 flex-col items-center gap-0.5 overflow-hidden border-r py-1 text-center tabular-nums text-primary',
        vacances.length > 0 ? 'bg-primary/10' : feries.length > 0 && 'bg-warning/25'
      )}
    >
      {numero ? (echelle === 'mois' ? numero : `S${numero}`) : ''}
      {vacances.length > 0 && (
        <span className="rounded bg-primary/20 px-0.5 text-[0.5rem] font-semibold leading-tight text-primary">VAC</span>
      )}
      {feries.length > 0 && (
        <span className="whitespace-nowrap rounded bg-warning/40 px-0.5 text-[0.5rem] font-semibold leading-tight text-foreground">
          {feries.length} JF
        </span>
      )}
    </div>
  );

  if (vacances.length === 0 && feries.length === 0) return contenu;

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>{contenu}</HoverCardTrigger>
      <HoverCardContent side="bottom" className="w-auto max-w-64 p-3">
        <p className="text-sm font-medium">
          {numero ? `Semaine ${numero} — ` : ''}du {court(lundi)} au {court(dimanche)}
        </p>
        {vacances.map((periode) => (
          <p key={`${periode.a}-${periode.b}`} className="mt-1 text-sm text-muted-foreground">
            Vacances{periode.intitule ? ` — ${periode.intitule}` : ''}.
          </p>
        ))}
        {feries.map((ferie) => (
          <div key={ferie.date} className="mt-2 border-t pt-2">
            <p className="text-sm font-medium">{ferie.intitule}</p>
            {/* `dir="rtl"` : sinon chiffres et parenthèses se rendent à l'envers. */}
            {ferie.intituleAr && (
              <p dir="rtl" lang="ar" className="text-sm text-muted-foreground">
                {ferie.intituleAr}
              </p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {new Date(`${ferie.date}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
              {' — '}
              {ferie.estime ? 'date estimée, fête lunaire confirmée quelques jours avant.' : 'jour férié.'}
            </p>
          </div>
        ))}
      </HoverCardContent>
    </HoverCard>
  );
}

/** « AAAA-MM-JJ » décalé de `n` jours, en heure LOCALE (pas de `toISOString`). */
function decaler(texte, n) {
  const date = new Date(`${texte}T00:00:00`);
  date.setDate(date.getDate() + n);
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}

/** La période telle que le glissement la propose. Un bord tiré ne passe jamais l'autre. */
function proposee(periode, { mode, decalage }) {
  if (mode === 'deplacer') return { debut: decaler(periode.debut, decalage), fin: decaler(periode.fin, decalage) };
  if (mode === 'debut') {
    const debut = decaler(periode.debut, decalage);
    return { debut: debut > periode.fin ? periode.fin : debut, fin: periode.fin };
  }
  const fin = decaler(periode.fin, decalage);
  return { debut: periode.debut, fin: fin < periode.debut ? periode.debut : fin };
}

const jourLocal = (texte) => new Date(`${texte}T00:00:00`);
const ecartJours = (a, b) => Math.round((b - a) / UN_JOUR);

/**
 * @param {object} [calendrierFourni] — la réponse de `/calendrier` déjà en main.
 * @param {Array}  [feriesFournis] — les jours fériés déjà en main.
 *   ⚠️ Pour les comptes formateur et stagiaire (« Mes stages », « Mes
 *   formations »), à qui `/calendrier` est fermé : la page les reçoit de
 *   `/consultation/periodes` et les passe ici — la frise n'interroge alors rien.
 */
export default function FrisePeriodes({ groupes, anneeScolaire, onRetirer, onDeplacer, calendrierFourni, feriesFournis }) {
  const calendrier = useQuery({
    queryKey: ['calendrier'],
    queryFn: chargerCalendrier,
    enabled: !calendrierFourni,
    retry: false,
  });
  // Même clé que `useDecorationCalendrier` : la requête est partagée, pas refaite.
  const feries = useQuery({
    queryKey: ['jours-feries', anneeScolaire],
    queryFn: () => chargerJoursFeries(anneeScolaire),
    enabled: Number.isInteger(anneeScolaire) && !feriesFournis,
    retry: false,
  });

  const [echelle, setEchelle] = useState('mois');
  const defilement = useRef(null);
  // Le point de l'année au centre de l'écran avant un zoom : il y reste après.
  const centre = useRef(null);
  const rang = ECHELLES.findIndex((e) => e.valeur === echelle);
  const { pxParJour } = ECHELLES[rang];

  const zoomer = (suivant) => {
    const boite = defilement.current;
    if (boite) {
      const piste = boite.scrollWidth - LARGEUR_ETIQUETTE;
      centre.current = (boite.scrollLeft + boite.clientWidth / 2 - LARGEUR_ETIQUETTE) / piste;
    }
    setEchelle(suivant);
  };

  /*
   * ═══ GLISSER-DÉPOSER (2026-10-10, demande du porteur) ═══ Glisser une barre
   * la DÉPLACE (même durée) ; tirer l'un de ses bords l'allonge ou la
   * raccourcit. Le pas est le JOUR, quelle que soit l'échelle : à l'échelle
   * « Mois », un jour fait 3 px — zoomer donne la précision.
   *
   * ⚠️ PAR POINTEUR, PAS PAR LE GLISSER-DÉPOSER HTML : celui-ci montre un
   * fantôme semi-transparent et ne dit la position qu'au dépôt. Ici la barre
   * elle-même suit la souris, ses dates écrites dessus.
   *
   * Le résultat est un BROUILLON, comme un ajout : la confirmation des séances
   * supprimées vient à l'enregistrement.
   */
  const [glisse, setGlisse] = useState(null);
  const [ouverte, setOuverte] = useState(null);
  // Le dernier appui a-t-il bougé ? Le clic qui suit un glissement ne doit rien ouvrir.
  const aBouge = useRef(false);

  const commencer = (evenement, index, mode) => {
    if (evenement.button !== 0) return;
    // Largeur RÉELLE d'un jour : la piste peut être plus large que `pxParJour` (minWidth 100 %).
    const piste = evenement.currentTarget.closest('[data-piste]');
    const pxJour = piste ? piste.clientWidth / (NOMBRE_SEMAINES * 7) : pxParJour;
    evenement.currentTarget.setPointerCapture?.(evenement.pointerId);
    setGlisse({ index, mode, x0: evenement.clientX, pxJour, decalage: 0, bouge: false });
  };

  useLayoutEffect(() => {
    if (!glisse) return undefined;
    const bouger = (evenement) => {
      const decalage = Math.round((evenement.clientX - glisse.x0) / glisse.pxJour);
      const bouge = glisse.bouge || Math.abs(evenement.clientX - glisse.x0) > 3;
      if (decalage !== glisse.decalage || bouge !== glisse.bouge) setGlisse({ ...glisse, decalage, bouge });
    };
    const lacher = () => {
      aBouge.current = glisse.bouge;
      const periode = periodeParIndex.get(glisse.index);
      if (glisse.bouge && periode && glisse.decalage !== 0 && onDeplacer) {
        onDeplacer(glisse.index, proposee(periode, glisse));
      }
      setGlisse(null);
    };
    const abandonner = () => setGlisse(null);
    const annuler = (evenement) => {
      if (evenement.key === 'Escape') abandonner();
    };
    window.addEventListener('pointermove', bouger);
    window.addEventListener('pointerup', lacher);
    window.addEventListener('pointercancel', abandonner);
    window.addEventListener('keydown', annuler);
    return () => {
      window.removeEventListener('pointermove', bouger);
      window.removeEventListener('pointerup', lacher);
      window.removeEventListener('pointercancel', abandonner);
      window.removeEventListener('keydown', annuler);
    };
  });

  useLayoutEffect(() => {
    const boite = defilement.current;
    if (!boite || centre.current === null) return;
    const piste = boite.scrollWidth - LARGEUR_ETIQUETTE;
    boite.scrollLeft = centre.current * piste + LARGEUR_ETIQUETTE - boite.clientWidth / 2;
    centre.current = null;
  }, [echelle]);

  if (!Number.isInteger(anneeScolaire)) return null;

  // L'index (rang dans la liste d'origine) → sa période, pour finir un glissement.
  const periodeParIndex = new Map(
    groupes.flatMap(({ entrees }) => entrees.map(({ periode, index }) => [index, periode]))
  );

  const donneesCalendrier = calendrierFourni ?? calendrier.data;
  const listeFeries = feriesFournis ?? feries.data?.joursFeries ?? [];
  const rentrees = donneesCalendrier?.rentrees ?? [];
  const debut = lundiDeLaSemaine(new Date(anneeScolaire, 8, 1));
  const totalJours = NOMBRE_SEMAINES * 7;
  const position = (date) => (Math.min(Math.max(ecartJours(debut, date), 0), totalJours) / totalJours) * 100;

  const semaines = Array.from({ length: NOMBRE_SEMAINES }, (_, rang) => {
    const lundi = new Date(debut);
    lundi.setDate(lundi.getDate() + rang * 7);
    return { lundi, numero: semaineAffichable(anneeScolaire, lundi, rentrees) };
  });

  // Chaque jour affiché — les mois se découpent au JOUR (et non à la semaine),
  // sinon leur bord tombe faux dès qu'on zoome.
  const jours = Array.from({ length: totalJours }, (_, decalage) => {
    const date = new Date(debut);
    date.setDate(date.getDate() + decalage);
    return date;
  });
  const mois = [];
  for (const date of jours) {
    const cle = `${date.getFullYear()}-${date.getMonth()}`;
    if (mois.at(-1)?.cle !== cle) mois.push({ cle, date, jours: 0 });
    mois.at(-1).jours += 1;
  }

  const unJour = 100 / totalJours;
  const vacances = vacancesEffectives(donneesCalendrier)
    .map((periode) => {
      const gauche = position(jourLocal(periode.debut));
      return { ...periode, gauche, largeur: position(jourLocal(periode.fin)) + unJour - gauche };
    })
    .filter((periode) => periode.largeur > 0);

  /* Les semaines « de vacances » — au moins 4 jours dedans, la règle de l'export
     Gantt — portent le badge VAC du chronogramme dans l'en-tête. */
  const intervallesVacances = vacancesEffectives(donneesCalendrier).map((p) => ({
    intitule: p.intitule,
    a: ecartJours(debut, jourLocal(p.debut)),
    b: ecartJours(debut, jourLocal(p.fin)),
  }));
  const vacancesDeSemaine = semaines.map((_, rang) =>
    intervallesVacances.filter(({ a, b }) => Math.min(b, rang * 7 + 6) - Math.max(a, rang * 7) + 1 >= 4)
  );
  const semainesVacances = vacancesDeSemaine.map((liste) => liste.length > 0);
  // Les fériés de chaque semaine — le badge « N JF » et la carte au survol du chronogramme.
  const feriesDeSemaine = semaines.map(() => []);
  for (const ferie of listeFeries) {
    const rang = Math.floor(ecartJours(debut, jourLocal(ferie.date)) / 7);
    if (rang >= 0 && rang < NOMBRE_SEMAINES) feriesDeSemaine[rang].push(ferie);
  }

  const joursFeries = listeFeries
    .map((ferie) => ({ ...ferie, gauche: position(jourLocal(ferie.date)) }))
    .filter((ferie) => ferie.gauche > 0 && ferie.gauche < 100);

  const aujourdhui = position(new Date());

  const fondPiste =
    echelle === 'jour'
      ? {
          backgroundImage:
            'linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px), linear-gradient(to right, hsl(var(--border) / 0.5) 1px, transparent 1px)',
          backgroundSize: `${100 / NOMBRE_SEMAINES}% 100%, ${100 / totalJours}% 100%`,
        }
      : {
          backgroundImage: 'linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px)',
          backgroundSize: `${100 / NOMBRE_SEMAINES}% 100%`,
        };

  return (
    <div className="space-y-2">
      {/*
        ⚠️ UN SEUL `ButtonGroup`, comme `CommandesZoom` d'Emploi et du chronogramme
        (2026-10-10, demande du porteur : « le même que le zoom d'Emploi ») :
        − · échelle · + · retour à la vue d'ensemble, collés, en `size-8`.
        L'échelle remplace le « 100 % » : ici on zoome par jour / semaine / mois.
      */}
      <div className="flex justify-end">
        <ButtonGroup aria-label="Échelle de la frise">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            disabled={rang === 0}
            onClick={() => zoomer(ECHELLES[rang - 1].valeur)}
            title="Dézoomer"
            aria-label="Dézoomer"
          >
            <ZoomOut className="size-3.5" />
          </Button>
          {ECHELLES.map(({ valeur, libelle }) => (
            <Button
              key={valeur}
              type="button"
              size="sm"
              variant={echelle === valeur ? 'default' : 'outline'}
              aria-pressed={echelle === valeur}
              className="h-8 px-3 text-xs"
              onClick={() => zoomer(valeur)}
            >
              {libelle}
            </Button>
          ))}
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            disabled={rang === ECHELLES.length - 1}
            onClick={() => zoomer(ECHELLES[rang + 1].valeur)}
            title="Zoomer"
            aria-label="Zoomer"
          >
            <ZoomIn className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            disabled={rang === 0}
            onClick={() => zoomer(ECHELLES[0].valeur)}
            title="Revenir à la vue de l’année"
            aria-label="Revenir à la vue de l’année"
          >
            <Maximize2 className="size-3.5" />
          </Button>
        </ButtonGroup>
      </div>

    <div ref={defilement} className="overflow-x-auto rounded-lg border">
      <div
        className="text-xs"
        style={{ width: `${LARGEUR_ETIQUETTE + totalJours * pxParJour}px`, minWidth: '100%' }}
      >
        {/* En-têtes : mois, puis numéros de semaine. */}
        <div className="flex border-b bg-muted/40">
          <div className="sticky left-0 z-20 w-40 shrink-0 border-r bg-muted/40" />
          <div className="flex flex-1">
            {mois.map(({ cle, date, jours: largeur }) => (
              <div
                key={cle}
                style={{ width: `${(largeur / totalJours) * 100}%` }}
                className="truncate border-r px-1 py-1 text-center font-medium capitalize"
              >
                {date.toLocaleDateString('fr-FR', { month: echelle === 'mois' ? 'short' : 'long', year: 'numeric' })}
              </div>
            ))}
          </div>
        </div>
        <div className="flex border-b">
          <div className="sticky left-0 z-20 w-40 shrink-0 border-r bg-background px-3 py-1 text-muted-foreground">
            Sem
          </div>
          <div className="flex flex-1">
            {semaines.map(({ lundi, numero }, rang) => (
              <EnteteSemaine
                key={lundi.getTime()}
                lundi={lundi}
                numero={numero}
                echelle={echelle}
                vacances={vacancesDeSemaine[rang]}
                feries={feriesDeSemaine[rang]}
              />
            ))}
          </div>
        </div>
        {echelle === 'jour' && (
          <div className="flex border-b">
            <div className="sticky left-0 z-20 w-40 shrink-0 border-r bg-background px-3 py-1 text-muted-foreground">
              Jour
            </div>
            <div className="flex flex-1">
              {jours.map((date) => (
                <div
                  key={date.getTime()}
                  title={date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                  className={cn(
                    'flex flex-1 flex-col items-center border-r py-0.5 leading-tight tabular-nums',
                    date.getDay() === 0 && 'bg-muted text-muted-foreground'
                  )}
                >
                  <span className="text-[0.55rem] text-muted-foreground">{INITIALES[date.getDay()]}</span>
                  <span>{date.getDate()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ⚠️ PLUS DE BANDE « Vacances · fériés » (2026-10-10, retirée à la demande
            du porteur) : les badges VAC / N JF de l'en-tête et leur carte au survol
            disent la même chose, et les colonnes restent peintes dans les lignes. */}

        {/* Une ligne par sujet. */}
        <div className="relative">
          {/* Fond commun : vacances et aujourd'hui, sous toutes les lignes. */}
          <div className="pointer-events-none absolute inset-y-0 left-40 right-0">
            {vacances.map((periode) => (
              <div
                key={`${periode.debut}-${periode.fin}`}
                className="absolute inset-y-0 bg-primary/10"
                style={{ left: `${periode.gauche}%`, width: `${periode.largeur}%` }}
              />
            ))}
            {joursFeries.map((ferie) => (
              <div
                key={ferie.date}
                className="absolute inset-y-0 min-w-[3px] bg-amber-400/40"
                style={{ left: `${ferie.gauche}%`, width: `${unJour}%` }}
              />
            ))}
            {aujourdhui > 0 && aujourdhui < 100 && (
              <div className="absolute inset-y-0 w-px bg-destructive" style={{ left: `${aujourdhui}%` }} />
            )}
          </div>

          {groupes.map(({ libelle, entrees }) => {
            const jours = entrees.reduce((total, { periode }) => total + ecartJours(jourLocal(periode.debut), jourLocal(periode.fin)) + 1, 0);
            return (
              <div key={libelle} className="flex border-b last:border-b-0 hover:bg-muted/30">
                <div className="sticky left-0 z-10 w-40 shrink-0 border-r bg-background px-3 py-1.5">
                  <div className="truncate font-medium">{libelle}</div>
                  <div className="text-[0.65rem] text-muted-foreground">
                    {entrees.length} période(s) · {jours} j
                  </div>
                </div>
                <div
                  data-piste=""
                  className="relative flex-1"
                  // Les traits de semaine, sans un nœud par case.
                  style={fondPiste}
                >
                  {entrees.map(({ periode, index }, rang) => {
                    // Pendant un glissement, la barre suit la souris : elle montre la période PROPOSÉE.
                    const enCours = glisse?.index === index ? proposee(periode, glisse) : periode;
                    const debutBarre = jourLocal(enCours.debut);
                    const finBarre = jourLocal(enCours.fin);
                    const gauche = position(debutBarre);
                    const largeur = Math.max(position(finBarre) + 100 / totalJours - gauche, 0.4);
                    const duree = ecartJours(debutBarre, finBarre) + 1;
                    const texte = `${debutBarre.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} → ${finBarre.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`;
                    const classes = cn(
                      'absolute inset-y-1.5 flex items-center overflow-hidden rounded px-1.5 text-left text-[0.65rem] font-medium shadow-sm',
                      TEINTES[rang % TEINTES.length]
                    );
                    const contenu = <span className="truncate">{duree * pxParJour >= 70 ? texte : ''}</span>;
                    const place = { left: `${gauche}%`, width: `${largeur}%` };
                    const cle = `${periode.debut}-${index}`;

                    if (!onRetirer) {
                      return (
                        <div key={cle} title={`${libelle} : ${texte} · ${duree} jour(s)`} className={classes} style={place}>
                          {contenu}
                        </div>
                      );
                    }

                    /*
                     * ⚠️ CLIQUER OUVRE UNE CONFIRMATION, IL NE SUPPRIME PAS : une
                     * barre se clique aussi par mégarde en lisant la frise. Le
                     * retrait reste ensuite un BROUILLON, comme dans la liste :
                     * rien ne part avant « Enregistrer ».
                     *
                     * ⚠️ LE POPOVER EST PILOTÉ ICI, PAS PAR SON DÉCLENCHEUR : un
                     * glissement se termine lui aussi par un clic, qui l'aurait
                     * ouvert à chaque déplacement. Il ne s'ouvre que si l'appui
                     * n'a PAS bougé (`aBouge`) — ou par Entrée au clavier.
                     */
                    return (
                      <Popover
                        key={cle}
                        open={ouverte === cle}
                        onOpenChange={(valeur) => {
                          if (!valeur) setOuverte(null);
                          // Clic (ou Entrée) sans glissement : la confirmation s'ouvre.
                          else if (!aBouge.current) setOuverte(cle);
                          aBouge.current = false;
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            title={`${libelle} : ${texte} · ${duree} jour(s) — glisser pour déplacer, tirer un bord pour allonger, cliquer pour supprimer`}
                            className={cn(
                              classes,
                              'touch-none select-none hover:ring-2 hover:ring-foreground/40 focus-visible:ring-2 focus-visible:ring-ring',
                              glisse?.index === index ? 'z-20 cursor-grabbing opacity-90 ring-2 ring-foreground/60' : 'cursor-grab'
                            )}
                            style={place}
                            onPointerDown={(evenement) => commencer(evenement, index, 'deplacer')}
                          >
                            {/* Les poignées des bords : tirer l'une allonge ou raccourcit la période. */}
                            {onDeplacer && (
                              <span
                                aria-hidden
                                className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-black/20"
                                onPointerDown={(evenement) => {
                                  evenement.stopPropagation();
                                  commencer(evenement, index, 'debut');
                                }}
                              />
                            )}
                            {contenu}
                            {onDeplacer && (
                              <span
                                aria-hidden
                                className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-black/20"
                                onPointerDown={(evenement) => {
                                  evenement.stopPropagation();
                                  commencer(evenement, index, 'fin');
                                }}
                              />
                            )}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 space-y-3 p-3 text-sm">
                          <div>
                            <div className="font-medium">{libelle}</div>
                            <div className="text-xs text-muted-foreground">
                              {texte} · {duree} jour(s)
                            </div>
                          </div>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="w-full"
                            onClick={() => {
                              setOuverte(null);
                              onRetirer(index);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                            Supprimer cette période
                          </Button>
                        </PopoverContent>
                      </Popover>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-sm bg-primary/20" /> Vacances
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-sm bg-amber-500" /> Jour férié
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-px bg-destructive" /> Aujourd&apos;hui
          </span>
          <span>
            {onRetirer
              ? onDeplacer
                ? 'Glissez une barre pour la déplacer, tirez un bord pour l’allonger, cliquez-la pour la supprimer.'
                : 'Survolez une barre pour ses dates exactes, cliquez-la pour la supprimer.'
              : 'Survolez une barre pour ses dates exactes.'}
          </span>
        </div>
      </div>
    </div>
    </div>
  );
}
