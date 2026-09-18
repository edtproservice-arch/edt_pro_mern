import { memo, useMemo } from 'react';
/*
 * ⚠️ `JOURS` VIENT DES CONSTANTES, PAS DU DOMAINE. Le barillet du domaine en
 * ré-exportait un second, de SEPT jours — celui qui sert à calculer des dates.
 * L'écran dessinait alors une colonne « Dimanche » que le domaine ne remplissait
 * jamais, et l'en-tête ne tombait plus en face des cases. Le doublon a été
 * renommé, cet import reste explicite.
 */
import { JOURS } from 'shared/constants';
import { assemblerConsultation, contenuLigne } from 'shared/domain';
import {
  CASE_SAISISSABLE,
  FOND_PRESENTIEL,
  FOND_REDUIT,
  FOND_SYNCHRONE,
  FOND_VACANCES,
  FOND_EFM,
  MARGE_PAGE,
  VALEUR_EFM,
  VALEUR_PRESENTIEL,
  VALEUR_SYNCHRONE,
  VALEUR_VIDE,
  PASTILLE_RATTRAPAGE,
  couleurCharge,
} from '@/components/common/apparenceGrille';
import { ABREGES, BORD_PLEIN, BORD_TABLEAU, SEPARATION_JOUR } from '@/features/emploi/styles';
import { cn } from '@/lib/utils';

/**
 * La semaine, en lecture seule, sur l'axe demandé.
 * ← `displayGlobalSchedule()` et les trois `display*Schedule()` de edition.html
 *
 * ═══ ⚠️ LE MÊME TABLEAU QUE « EMPLOI », SANS LES INDICATEURS ═══
 * (demande du porteur, 2026-08-26.) Mêmes traits de jour, mêmes fonds, mêmes
 * couleurs de valeur, même colonne d'intitulés abrégés, même couleur de charge
 * sur le bloc de tête. Ce qui disparaît, ce sont les REPÈRES DE SAISIE —
 * l'étoile EFM régional, le badge de semestre, le taux d'avancement : ils
 * servent à décider où poser une séance, et on ne pose rien ici.
 *
 * ═══ ⚠️ UNE SEULE GRILLE POUR LES DEUX VUES ═══
 * La vue GLOBALE et la vue DÉTAILLÉE ne diffèrent que par le NOMBRE de sujets et
 * par l'ORIENTATION du tableau. L'existant en écrivait quatre générateurs
 * (`displayGlobalSchedule`, `displayTeacherSchedule`, `displayGroupSchedule`,
 * `displaySalleSchedule`), qui avaient fini par diverger sur les libellés et sur
 * le traitement des fusions.
 *
 * ═══ ⚠️ RIEN NE S'Y SAISIT ═══
 * Pas de liste déroulante, pas de glisser-déposer, pas de sélection. C'est ce
 * qui permet d'afficher les 17 formateurs d'un coup sans le coût mesuré sur la
 * page d'édition : une case n'est qu'une cellule de texte.
 */
function GrilleConsultation({
  zoom = 100,
  sujets,
  seances,
  axe,
  lignes,
  periode,
  creneaux,
  jours,
  nomsFormateurs,
  entete,
  libelle,
  /**
   * Facultatif : rend les cases qui portent une séance CLIQUABLES (l'appel des
   * stagiaires, F9, 2026-09-14). Reçoit `{ cellule, date }`. Sans lui, la grille
   * reste la lecture seule de « Édition », inchangée.
   * ⚠️ À STABILISER PAR `useCallback` chez l'appelant : il traverse `LigneSujet`,
   * mémoïsé — une fonction neuve à chaque rendu re-rendrait toute la grille.
   */
  onChoisirCase,
}) {
  const assemblees = useMemo(
    () => assemblerConsultation({ sujets, seances, axe, periode }),
    [sujets, seances, axe, periode]
  );

  const etatDuJour = useMemo(() => new Map((jours ?? []).map((j) => [j.jour, j])), [jours]);

  if (sujets.length === 0) return null;

  return (
    /*
     * ⚠️ `table-fixed w-full` : les 24 colonnes se PARTAGENT la largeur, comme
     * sur « Emploi ». Un tableau à défilement horizontal oblige à faire glisser
     * pour comparer le lundi et le vendredi — or c'est exactement ce qu'on
     * regarde en lisant une semaine.
     */
    /*
     * ⚠️ `overflow-clip` ET NON `overflow-hidden` : les deux coupent aux coins
     * arrondis, mais `hidden` crée EN PLUS un conteneur de défilement — le
     * `sticky` de l'en-tête s'y accrocherait, à un cadre qui ne défile jamais,
     * et ne bougerait pas d'un pixel. Piège déjà payé sur « Emploi ».
     */
    <div className="overflow-clip rounded-lg border" style={{ zoom: zoom / 100 }}>
      <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
        <colgroup>
          <col className="w-[6.5rem]" />
          <col className="w-[2.25rem]" />
          {JOURS.flatMap((jour) => creneaux.map((creneau) => <col key={`${jour}-${creneau}`} />))}
        </colgroup>

        {/*
          En-tête sans fond gris, sauf les deux cellules de coin : elles
          coiffent les INTITULÉS DE LIGNE, pas le calendrier.

          ═══ ⚠️ IL RESTE EN VUE QUAND ON DESCEND ═══ (2026-08-26, comme
          « Emploi ».) C'est ici qu'il sert le plus : la vue globale empile des
          dizaines de sujets, et sans lui on perd le jour qu'on est en train de
          lire au bout de trois lignes.

          ⚠️ LE FOND BLANC EST SUR LE `thead`, PAS SUR LES CELLULES : il passe
          DERRIÈRE elles, si bien que l'ambre d'un férié et le bleu des vacances
          gardent exactement le rendu qu'ils avaient sur la page. Sans lui, les
          séances défileraient en transparence sous l'en-tête.

          ⚠️ `print:static` : à l'impression, le navigateur répète DÉJÀ le
          `thead` en tête de chaque page. Le laisser collant l'y superposerait à
          la première ligne du tableau.

          ⚠️ `top` remonte de la marge de page et se DIVISE par le zoom — voir
          `MARGE_PAGE` dans `apparenceGrille`, où les deux pièges sont détaillés.
        */}
        <thead
          className="sticky z-20 bg-background text-tableau-tete-foreground print:static"
          style={{ top: `${-MARGE_PAGE / (zoom / 100)}px` }}
        >
          <tr>
            <th
              rowSpan={2}
              className="border-b border-r bg-tableau-tete px-2 py-2 text-center text-foreground"
            >
              {entete}
            </th>
            <th rowSpan={2} className={cn('border-b bg-tableau-tete', BORD_TABLEAU)} />

            {JOURS.map((jour) => {
              const etat = etatDuJour.get(jour);
              return (
                <th
                  key={jour}
                  colSpan={creneaux.length}
                  className={cn(
                    'border-b px-2 py-1.5 text-center font-medium text-foreground',
                    // ⚠️ PLEINS EN TÊTE : l'en-tête ENCADRE les jours — c'est
                    // lui qui donne sa structure au tableau depuis qu'il n'a
                    // plus de fond. SAUF LE DERNIER : il ne sépare aucun jour,
                    // c'est le bord du tableau, et il se rend simple comme
                    // celui de gauche.
                    jour === JOURS.at(-1) ? BORD_TABLEAU : BORD_PLEIN,
                    etat?.vacances && FOND_VACANCES,
                    etat?.ferie && FOND_REDUIT
                  )}
                >
                  <span className="block">{jour}</span>
                  <span className="block text-[0.65rem] font-normal text-muted-foreground">
                    {etat?.date ? `${etat.date.slice(8, 10)}/${etat.date.slice(5, 7)}` : ''}
                  </span>
                </th>
              );
            })}
          </tr>

          <tr>
            {JOURS.flatMap((jour) =>
              creneaux.map((creneau, rang) => (
                <th
                  key={`${jour}-${creneau}`}
                  className={cn(
                    'border-b px-0.5 py-1 text-center text-[0.65rem] font-normal',
                    rang !== creneaux.length - 1
                      ? 'border-r'
                      : jour === JOURS.at(-1)
                        ? BORD_TABLEAU
                        : BORD_PLEIN
                  )}
                >
                  {creneau}
                </th>
              ))
            )}
          </tr>
        </thead>

        <tbody>
          {assemblees.map((ligne) => (
            <LigneSujet
              key={ligne.sujet}
              ligne={ligne}
              libelle={libelle?.(ligne.sujet) ?? ligne.sujet}
              lignes={lignes}
              creneaux={creneaux}
              nomsFormateurs={nomsFormateurs}
              etatDuJour={etatDuJour}
              onChoisirCase={onChoisirCase}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Un sujet : trois lignes qui décrivent les mêmes cases.
 *
 * ⚠️ LE NOM ET LES HEURES SUR LA PREMIÈRE LIGNE SEULEMENT (`rowSpan`) : les
 * répéter trois fois ferait lire trois sujets là où il n'y en a qu'un.
 */
const LigneSujet = memo(function LigneSujet({
  ligne,
  libelle,
  lignes,
  creneaux,
  nomsFormateurs,
  etatDuJour,
  onChoisirCase,
}) {
  return (
    <>
      {lignes.map((intitule, rang) => (
        <tr key={intitule}>
          {rang === 0 && (
            <th
              scope="rowgroup"
              rowSpan={lignes.length}
              className={cn(
                'border-b border-r px-2 py-1.5 text-center align-top',
                // ⚠️ LA CASE ENTIÈRE PREND LA COULEUR DE LA CHARGE, comme sur
                // « Emploi » : c'est le NOM qu'on lit d'abord, donc c'est lui
                // qui doit porter le signal.
                ligne.heures ? couleurCharge(ligne.heures) : 'bg-card'
              )}
            >
              <span className="block text-[0.7rem] font-medium leading-tight">{libelle}</span>
              <span className="mt-0.5 block text-[0.65rem] leading-none tabular-nums">
                {ligne.heures} h
              </span>
            </th>
          )}

          {/* ⚠️ ABRÉGÉ : « Formateur » n'entre pas dans 2,25 rem. */}
          <th
            scope="row"
            className={cn(
              'border-b bg-tableau-tete px-0.5 py-0.5 text-center text-[0.6rem] font-normal text-muted-foreground',
              BORD_TABLEAU
            )}
          >
            {ABREGES[intitule] ?? intitule.slice(0, 3)}
          </th>

          {ligne.cases.map((cellule, colonne) => (
            <Cellule
              key={`${cellule.jour}-${cellule.seance}`}
              cellule={cellule}
              intitule={intitule}
              nomsFormateurs={nomsFormateurs}
              etat={etatDuJour.get(cellule.jour)}
              finDuJour={(colonne + 1) % creneaux.length === 0}
              finDuTableau={colonne === ligne.cases.length - 1}
              onChoisir={onChoisirCase}
            />
          ))}
        </tr>
      ))}
    </>
  );
});

/**
 * Une case : la même boîte que sur « Emploi », sans ce qui sert à saisir.
 */
function Cellule({ cellule, intitule, nomsFormateurs, etat, finDuJour, finDuTableau, onChoisir }) {
  const texteBase = contenuLigne(cellule.seances, intitule, nomsFormateurs);
  const premiere = cellule.seances[0];
  const absente = premiere && cellule.seances.every((seance) => seance.statut === 'absent');
  const rattrapage = cellule.seances.some((seance) => seance.statut === 'rattrape');
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
  const cliquable = Boolean(onChoisir) && Boolean(premiere);
  // Un BOUTON quand la case s'ouvre, un simple texte sinon : un bouton inerte
  // dans chaque case vide ferait tabuler 1 224 fois pour rien.
  const Contenu = cliquable ? 'button' : 'span';

  return (
    <td
      className={cn(
        /*
         * ⚠️ `overflow-hidden` : sans lui, un contenu plus large que la colonne
         * DÉBORDE par-dessus ses voisines — « ABDESSAMAD AIT TALEB / AHMED
         * TAIA » recouvrait deux cases (signalé par le porteur). `table-fixed`
         * fige la largeur de la colonne, il ne borne pas ce qu'on y met.
         */
        'overflow-hidden border-b p-0 text-center align-middle',
        // ⚠️ Pointillé entre deux jours, PLEIN au bord du tableau : c'est la
        // règle de la grille d'édition, et deux écrans qui montrent la même
        // semaine ne peuvent pas la structurer différemment.
        !finDuJour ? 'border-r' : finDuTableau ? BORD_TABLEAU : SEPARATION_JOUR,
        // ⚠️ UN FÉRIÉ NE COLORE QUE SON EN-TÊTE ; les VACANCES ferment la
        // colonne entière. Même règle que sur « Emploi » et le chronogramme.
        etat?.vacances && FOND_VACANCES,
        efm && !etat?.vacances && FOND_EFM,
        premiere && !efm && !absente && !etat?.vacances && (aDistance ? FOND_SYNCHRONE : FOND_PRESENTIEL),
        absente && 'bg-destructive/10'
      )}
    >
      <Contenu
        {...(cliquable
          ? { type: 'button', onClick: () => onChoisir({ cellule, date: etat?.date ?? null }) }
          : {})}
        className={cn(
          CASE_SAISISSABLE,
          /*
           * ⚠️ UN BLOC, PAS UN CONTENEUR FLEX. Un élément flex ne descend pas
           * sous la largeur de son contenu sans `min-w-0` : le texte gardait sa
           * largeur naturelle et sortait de la case au lieu de se replier.
           *
           * ⚠️ ET `overflow-wrap: anywhere`, pas `break-words` : celui-ci ne
           * coupe un mot que s'il est SEUL sur sa ligne. « GMOEMFM201 » suivait
           * un « / » et débordait donc sans jamais être coupé.
           *
           * Le corps descend à 0,6 rem — sur 24 colonnes, un nom de formateur
           * joint à un autre n'a pas d'autre issue que de rétrécir ET de se
           * replier.
           */
          'flex min-h-7 w-full min-w-0 items-center justify-center px-0.5 py-0.5',
          'whitespace-normal [overflow-wrap:anywhere] text-[0.6rem] leading-[1.15]',
          // La case garde le cadre de « Emploi », mais pas son survol : rien ne
          // s'ouvre ici, et un cadre qui apparaît promettrait une saisie.
          // ⚠️ SAUF QUAND ELLE S'OUVRE (l'appel) : le cadre au survol dit alors
          // exactement ce qu'il promet.
          cliquable ? 'cursor-pointer hover:border-primary/60' : 'hover:border-transparent',
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
        {/* La pastille ↺ d'un rattrapage, sur la ligne Module comme dans la
            grille d'édition (2026-09-14). */}
        {rattrapage && intitule === 'Module' && (
          <span className={PASTILLE_RATTRAPAGE + ' mr-0.5'} aria-label="Rattrapage">
            ↺
          </span>
        )}
        {texte}
      </Contenu>
    </td>
  );
}

export default memo(GrilleConsultation);
