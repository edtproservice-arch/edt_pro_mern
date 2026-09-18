import { memo, useMemo } from 'react';
import { JOURS, PERIODES } from 'shared/constants';
import { SEANCES_JOUR, SEANCE_SOIR, assemblerConsultation, contenuLigne } from 'shared/domain';
import {
  FOND_PRESENTIEL,
  FOND_REDUIT,
  FOND_SYNCHRONE,
  FOND_VACANCES,
  FOND_EFM,
  VALEUR_EFM,
  VALEUR_PRESENTIEL,
  VALEUR_SYNCHRONE,
  VALEUR_VIDE,
  PASTILLE_RATTRAPAGE,
  couleurCharge,
} from '@/components/common/apparenceGrille';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';

/**
 * L'emploi du temps d'UN sujet, à la verticale.
 * ← `displayTeacherSchedule()` / `displayGroupSchedule()` / `displaySalleSchedule()`
 *   de edition.html (maquette fournie par le porteur, 2026-08-26)
 *
 * ═══ ⚠️ TRANSPOSÉ PAR RAPPORT À LA VUE GLOBALE, ET C'EST LE POINT ═══
 * La vue globale met les JOURS EN COLONNES pour comparer dix-sept personnes d'un
 * regard. Ici on n'en lit qu'une : les jours passent en LIGNES et les créneaux
 * en colonnes, ce qui donne quatre colonnes larges au lieu de vingt-quatre
 * étroites — le nom d'un module s'y lit en entier, sans repli ni troncature.
 * C'est la forme des trois tableaux détaillés de l'existant.
 */
function GrilleDetaillee({ zoom = 100, sujet, libelle, seances, axe, lignes, jours, nomsFormateurs }) {
  /*
   * ═══ ⚠️ LA COLONNE S5 N'APPARAÎT QUE SI LE SUJET A COURS LE SOIR ═══
   * (demande du porteur, 2026-08-26.) La grille du soir ne concerne que les
   * groupes « CDS » : l'ajouter à tout le monde donnerait à seize sujets sur
   * dix-sept une cinquième colonne vide, qu'on prendrait pour un oubli de
   * saisie. On la montre donc au SUJET qui en a, et à lui seul.
   *
   * ⚠️ DEUX ASSEMBLÉES, PAS UNE. `assemblerConsultation` filtre par PÉRIODE —
   * il le faut, « S5 du jour » et « S5 du soir » sont deux créneaux distincts
   * dans le modèle. On assemble donc les deux et on les recolle : c'est la
   * SEULE façon de montrer la semaine entière d'un sujet dans un seul tableau.
   */
  const { assemblee, creneaux } = useMemo(() => {
    const [jour] = assemblerConsultation({
      sujets: [sujet],
      seances,
      axe,
      periode: PERIODES.JOUR,
    });
    const [soir] = assemblerConsultation({
      sujets: [sujet],
      seances,
      axe,
      periode: PERIODES.SOIR,
    });

    const aDuSoir = soir.cases.some((c) => c.seances.length > 0);

    return {
      assemblee: {
        // Les heures COMPTENT LES DEUX : c'est la charge réelle de la semaine.
        heures: Math.round((jour.heures + soir.heures) * 100) / 100,
        cases: aDuSoir ? [...jour.cases, ...soir.cases] : jour.cases,
      },
      creneaux: aDuSoir ? [...SEANCES_JOUR, SEANCE_SOIR] : SEANCES_JOUR,
    };
  }, [sujet, seances, axe]);

  const etatDuJour = useMemo(() => new Map((jours ?? []).map((j) => [j.jour, j])), [jours]);

  /** La case d'un jour et d'un créneau — l'assemblée est une liste à plat. */
  const parCle = useMemo(
    () => new Map(assemblee.cases.map((c) => [`${c.jour}||${c.seance}`, c])),
    [assemblee]
  );

  return (
    /*
     * ⚠️ PAS D'EN-TÊTE COLLANT ICI, contrairement à la vue globale. Chaque sujet
     * a SON tableau de sept lignes : l'en-tête n'a pas le temps de sortir de
     * l'écran, et dix-sept en-têtes se disputant le haut de la fenêtre en
     * défilant se recouvriraient l'un l'autre. Le zoom, lui, vaut pour les deux.
     */
    <section className="overflow-clip rounded-lg border" style={{ zoom: zoom / 100 }}>
      {/*
        Le sujet EN TÊTE du tableau, avec ses heures : sur une page qui en
        empile dix-sept, une grille sans titre ne dit pas de qui elle parle.
      */}
      <header
        className={cn(
          'flex items-baseline justify-between gap-3 border-b px-3 py-2',
          // ⚠️ BLANC, PAS GRIS, À ZÉRO — demande du porteur (2026-09-05) :
          // `bg-tableau-tete` (gris) confondait une semaine VIDE avec un
          // en-tête de tableau, alors que `GrilleConsultation` et
          // `GrilleEmploi` rendent déjà `bg-card` pour ce même cas. Deux
          // écrans du même produit ne peuvent pas colorer « rien à
          // signaler » différemment (§4.2 du plan).
          assemblee.heures ? couleurCharge(assemblee.heures) : 'bg-card'
        )}
      >
        <h3 className="truncate text-sm font-semibold">{libelle}</h3>
        <span className="shrink-0 text-xs tabular-nums">{assemblee.heures} h</span>
      </header>

      <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
        {/*
          ⚠️ « JOUR » ET « INFO » SE RÉTRÉCISSENT SUR MOBILE (2026-09-05,
          demande du porteur) : à 88 px + 72 px fixes, elles engloutissaient
          près de la moitié d'un écran de 393 px avant même la première
          colonne de créneau — c'est CETTE PAGE (F14, consultée « au plus
          souvent sur mobile ») qui en payait le prix, en forçant les codes
          de groupe à se replier lettre par lettre. Sous `sm` (640 px), elles
          rendent à leurs jours/labels toute la place qu'il leur faut au lieu
          de la réserver d'office.
        */}
        <colgroup>
          <col className="w-16 sm:w-[5.5rem]" />
          <col className="w-14 sm:w-[4.5rem]" />
          {creneaux.map((creneau) => (
            <col key={creneau} />
          ))}
        </colgroup>

        <thead className="text-tableau-tete-foreground">
          <tr>
            <th className="border-b border-r bg-tableau-tete px-2 py-1.5 text-center text-foreground">
              Jour
            </th>
            <th className="border-b border-r bg-tableau-tete px-2 py-1.5 text-center text-foreground">
              Info
            </th>
            {creneaux.map((creneau) => (
              <th
                key={creneau}
                className="border-b border-r px-2 py-1.5 text-center font-medium text-foreground last:border-r-0"
              >
                {creneau}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {JOURS.map((jour) => {
            const etat = etatDuJour.get(jour);

            return lignes.map((intitule, rang) => (
              <tr key={`${jour}-${intitule}`}>
                {rang === 0 && <EnTeteJourTableau jour={jour} etat={etat} rowSpan={lignes.length} />}

                <th
                  scope="row"
                  className="border-b border-r bg-muted/40 px-1 py-1 text-center text-[0.7rem] font-normal text-muted-foreground break-words sm:px-2"
                >
                  {intitule}
                </th>

                {creneaux.map((creneau) => (
                  <Cellule
                    key={creneau}
                    cellule={parCle.get(`${jour}||${creneau}`)}
                    intitule={intitule}
                    nomsFormateurs={nomsFormateurs}
                    etat={etat}
                  />
                ))}
              </tr>
            ));
          })}
        </tbody>
      </table>
    </section>
  );
}

/**
 * L'en-tête d'une ligne de jour — et sa carte au survol quand il est FÉRIÉ.
 * ← demande du porteur (2026-09-04) : « en vue tableau je veux qu'il être
 * un hover card ». Même contenu que celle de `SelecteurSemaine.jsx`
 * (`BoutonJour`) : intitulé, traduction arabe, mention d'estimation.
 *
 * ⚠️ AUCUNE CARTE POUR LES VACANCES : elles n'ont ici qu'un booléen
 * (`etat.vacances`), sans intitulé de période à montrer — une carte n'y
 * répéterait que le fond bleu déjà visible.
 */
function EnTeteJourTableau({ jour, etat, rowSpan }) {
  const classe = cn(
    // ⚠️ `px-1` sur mobile : à `px-2`, l'espace repris à la colonne (88→64 px)
    // se reperdait aussitôt dans le rembourrage, et « Mercredi »/« Vendredi »
    // se coupaient en plein mot (« Mercre » / « di ») faute des quelques
    // pixels qui leur manquaient pour tenir sur une ligne.
    'border-b border-r px-1 py-1.5 text-center align-middle font-medium sm:px-2',
    // ⚠️ L'ÉTAT SE MARQUE SUR LE JOUR, sa ligne entière : ici c'est la ligne
    // qui EST le jour, quand la vue globale en fait une colonne.
    etat?.vacances ? FOND_VACANCES : etat?.ferie ? FOND_REDUIT : 'bg-tableau-tete'
  );

  const contenu = (
    <>
      {/* ⚠️ `break-words` PAS `[overflow-wrap:anywhere]` : le jour est SEUL
          sur sa ligne, il n'a besoin de se couper que s'il n'a vraiment pas
          la place — « Mercredi » et « Vendredi » sont les plus longs, et la
          colonne est désormais plus étroite sur mobile. */}
      <span className="block break-words">{jour}</span>
      <span className="block text-[0.65rem] font-normal text-muted-foreground">
        {etat?.date ? `${etat.date.slice(8, 10)}/${etat.date.slice(5, 7)}` : ''}
      </span>
    </>
  );

  if (!etat?.ferie) {
    return (
      <th scope="rowgroup" rowSpan={rowSpan} className={classe}>
        {contenu}
      </th>
    );
  }

  const ferie = etat.ferie;

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <th scope="rowgroup" rowSpan={rowSpan} className={cn(classe, 'cursor-help')}>
          {contenu}
        </th>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="center" className="w-auto max-w-64 p-3">
        <p className="text-sm font-medium leading-snug">{ferie.intitule}</p>
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

function Cellule({ cellule, intitule, nomsFormateurs, etat }) {
  const seances = cellule?.seances ?? [];
  const texteBase = contenuLigne(seances, intitule, nomsFormateurs);
  const premiere = seances[0];
  const absente = premiere && seances.every((seance) => seance.statut === 'absent');
  const rattrapage = seances.some((seance) => seance.statut === 'rattrape');
  const aDistance = String(premiere?.salle ?? '').toUpperCase() === 'TEAMS';
  const efm = Boolean(premiere?.estEfm);
  /*
   * ⚠️ PRÉFIXE EFM RÉGIONAL SUR LA LIGNE MODULE. La ligne « Module » d'une
   * séance EFM affiche « EFM régional M102 » pour la distinguer d'un cours
   * ordinaire — demande du porteur (2026-08-27).
   */
  const texte = efm && intitule === 'Module' && texteBase
    ? `EFM régional ${texteBase}`
    : texteBase;

  return (
    <td
      className={cn(
        /*
         * ⚠️ `overflow-hidden` : sans lui, un contenu plus large que la
         * colonne DÉBORDE par-dessus ses voisines — « GMOEMFM201 » sur deux
         * colonnes S1/S2 adjacentes se recouvrait (signalé par le porteur).
         * `table-fixed` fige la largeur de la colonne, il ne borne pas ce
         * qu'on y met — même défaut, même remède que sur `GrilleConsultation`.
         */
        'overflow-hidden border-b border-r px-2 py-1.5 text-center align-middle last:border-r-0',
        etat?.vacances && FOND_VACANCES,
        efm && !etat?.vacances && FOND_EFM,
        premiere && !efm && !absente && !etat?.vacances && (aDistance ? FOND_SYNCHRONE : FOND_PRESENTIEL),
        absente && 'bg-destructive/10',
        absente
          ? 'font-semibold text-destructive line-through'
          : !texte
            ? VALEUR_VIDE
            : /* ⚠️ L'EFM AVANT LE TYPE : une surveillance se passe en salle,
             donc `aDistance` est faux et elle prenait le vert d'un cours. */
          efm
          ? VALEUR_EFM
          : aDistance
              ? VALEUR_SYNCHRONE
              : VALEUR_PRESENTIEL
      )}
    >
      {/* ⚠️ UN TIRET, PAS UNE CASE VIDE : dans ce tableau les cases sont larges
          et peu nombreuses, et une colonne de blancs ne se lit plus comme une
          grille. C'est la forme de la maquette. Sur la vue GLOBALE, à
          1 224 cases, le même tiret ferait au contraire une trame illisible —
          d'où la différence assumée entre les deux. */}
      {/*
        ⚠️ `[overflow-wrap:anywhere]`, PAS `break-words` : celui-ci ne coupe
        un mot que s'il est SEUL sur sa ligne. « GMOEMFM201 » est un code sans
        espace — il ne se coupait donc jamais et débordait plutôt que de
        RETOURNER À LA LIGNE (demande du porteur, 2026-09-05).
      */}
      <span className="block whitespace-normal [overflow-wrap:anywhere]">
        {/* La pastille ↺ d'un rattrapage (2026-09-14), sur la ligne Module. */}
        {rattrapage && intitule === 'Module' && (
          <span className={PASTILLE_RATTRAPAGE + ' mr-1'} aria-label="Rattrapage">
            ↺
          </span>
        )}
        {texte || <span className="text-muted-foreground/60">–</span>}
      </span>
    </td>
  );
}

export default memo(GrilleDetaillee);
