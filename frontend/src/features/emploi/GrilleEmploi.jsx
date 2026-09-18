import { useCallback, useMemo } from 'react';
import { JOURS, TYPES_COURS } from 'shared/constants';
import {
  anneeDuNomGroupe,
  creneauAEviter,
  indexerContraintes,
  LIGNES_FORMATEUR,
  LIGNES_GROUPE,
  SEANCES_JOUR,
  SEANCE_SOIR,
  AVANCEMENT_ELEVE,
  assemblerGrille,
  avancementModule,
  cleModule,
  detecterConflits,
  estSalleReelle,
  heuresParSujet,
  optionsDuFormateur,
  separerFusion,
  typeDeSeance,
} from 'shared/domain';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import {
  FOND_REDUIT,
  FOND_VACANCES,
  MARGE_PAGE,
  SEMAINE_PLEINE,
  couleurCharge,
} from '@/components/common/apparenceGrille';
import { cn } from '@/lib/utils';
import CaseEmploi from './CaseEmploi';
import { cleCase } from './selection';
import { ABREGES, BORD_PLEIN, BORD_TABLEAU, SEPARATION_JOUR } from './styles';

/**
 * La grille d'une semaine : sujets en lignes, jours × créneaux en colonnes.
 * ← `generateTimetable()` et `generateSoirTimetable()` de emploi.html
 *
 * ═══ TROIS LIGNES PAR SUJET ═══
 * Une case porte trois informations — avec qui, quoi, où — et les empiler dans
 * une cellule de 6 rem les rendrait illisibles. Elles occupent donc trois lignes
 * alignées, et l'œil descend une colonne pour lire une séance entière.
 *
 * ═══ ⚠️ UNE SEULE GRILLE POUR LES TROIS VUES ═══
 * Vue formateur, vue groupe et grille du soir ne diffèrent que par leur AXE et
 * leurs créneaux. L'existant en écrivait trois générateurs distincts — d'où des
 * comportements qui avaient dérivé entre eux.
 */
export default function GrilleEmploi({
  zoom = 100,
  sujets,
  seances,
  jours,
  axe = 'formateur',
  periode = 'jour',
  nomDuSujet = (sujet) => sujet,
  contexte = {},
  fiches,
  posees,
  selection = new Set(),
  brouillons = new Map(),
  conflits = new Set(),
  modeSelection = false,
  caseEnEdition = null,
  survolDepot = null,
  onChanger,
  onOuvrirCase,
  onFermerCase,
  onDebuterSelection,
  onEtendreSelection,
  onDeplacer,
  /*
   * ═══ MODE PLACEMENT (2026-09-14) ═══ Fourni par la modale de rattrapage : un
   * clic sur une case la DÉSIGNE au lieu d'ouvrir une liste — groupe, module et
   * salle viennent de l'absence. Sans lui, la grille garde sa saisie ordinaire.
   */
  onPlacerCase,
}) {
  /*
   * ⚠️ LA SEULE FONCTION CRÉÉE ICI POUR LES 1 224 CASES. `onChanger`,
   * `onOuvrirCase`, `onFermerCase`, `onDeplacer` et `onPlacerCase` viennent
   * DÉJÀ tout faits du parent (mémorisés par `useCallback` côté `PageEmploi`)
   * et sont repassés tels quels, sans enveloppe, à chaque `CaseEmploi` — c'est
   * ce qui rend son `memo` efficace. `onSelectionner` est la seule exception :
   * il faut choisir entre `onDebuterSelection` et `onEtendreSelection` selon
   * `shiftKey`, un branchement que seule la case connaît au moment du clic.
   * Mémorisée ici, elle reste UNE SEULE référence pour toute la grille au lieu
   * d'une fermeture neuve par case et par rendu.
   */
  const onSelectionner = useCallback(
    (evenement, contexte) =>
      evenement.shiftKey ? onEtendreSelection?.(contexte) : onDebuterSelection?.(contexte),
    [onEtendreSelection, onDebuterSelection]
  );

  const lignes = useMemo(
    () => assemblerGrille({ sujets, seances, axe, periode }),
    [sujets, seances, axe, periode]
  );

  const creneaux = periode === 'soir' ? [SEANCE_SOIR] : SEANCES_JOUR;
  const intitules = axe === 'groupe' ? LIGNES_GROUPE : LIGNES_FORMATEUR;
  const etatDuJour = useMemo(() => new Map((jours ?? []).map((j) => [j.jour, j])), [jours]);

  /* Les colonnes à plat — l'ordre exact des cases d'une ligne, pour savoir qui
     est le voisin de gauche et de droite d'une case sélectionnée. */
  const colonnes = useMemo(
    () => JOURS.flatMap((jour) => creneaux.map((creneau) => ({ jour, creneau }))),
    [creneaux]
  );
  const indexDuSujet = useMemo(() => new Map(sujets.map((sujet, rang) => [sujet, rang])), [sujets]);

  /*
   * ⚠️ LES DEUX AXES, PAS SEULEMENT CELUI AFFICHÉ. En vue par formateur, la
   * liste des GROUPES doit dire la charge du groupe — l'autre axe, donc — et
   * réciproquement. `assemblerGrille` n'en calcule qu'un.
   */
  const chargeFormateurs = useMemo(() => heuresParSujet(seances, 'formateur'), [seances]);
  const chargeGroupes = useMemo(() => heuresParSujet(seances, 'groupe'), [seances]);

  /*
   * ═══ ⚠️ QUI EST DÉJÀ PRIS SUR CHAQUE CRÉNEAU ═══
   * Les listes doivent pouvoir dire « ce groupe a déjà cours à cette heure », et
   * l'ÉTEINDRE — sans quoi on le choisit, on l'envoie, et le serveur le refuse
   * après coup. Le refus est juste, mais il arrive trop tard : la bonne place
   * d'un conflit est AVANT le clic.
   *
   * ⚠️ PAR CRÉNEAU, PAS PAR JOUR. Un groupe a quatre séances dans une journée :
   * éteindre tout ce qui est occupé « ce jour-là » désactiverait presque toute la
   * liste. C'est le CRÉNEAU — jour + séance + période — qui ne peut porter qu'un
   * cours, et c'est très exactement ce que le serveur contrôle.
   */
  const parCreneau = useMemo(() => {
    const table = new Map();
    for (const s of seances) {
      const cle = `${s.jour}||${s.seance}||${s.periode}`;
      if (!table.has(cle)) table.set(cle, []);
      table.get(cle).push(s);
    }
    return table;
  }, [seances]);

  /*
   * Les options de chaque formateur, calculées UNE fois pour la grille entière.
   * Les recalculer par case referait le parcours des 258 affectations 1 224 fois
   * — c'est la mesure d'Affectations qui l'impose.
   */
  /*
   * ⚠️ DEUX JEUX PAR FORMATEUR — PRÉSENTIEL ET SYNCHRONE. Ce n'est pas un
   * raffinement : ce ne sont pas les mêmes groupes. Un cours en salle réunit UNE
   * classe ; une séance à distance est mutualisée et se pose sur le libellé
   * FUSIONNÉ que la carte a affecté. Les mélanger, comme avant, offrait
   * « GM101 », « GM102 » ET « GM101 GM102 » dans la même liste, sans rien qui
   * dise lequel choisir.
   */
  const options = useMemo(() => {
    const table = new Map();
    for (const f of contexte.formateurs ?? []) {
      table.set(f.matricule, {
        [TYPES_COURS.PRESENTIEL]: optionsDuFormateur(contexte.affectations ?? [], f.matricule, {
          type: TYPES_COURS.PRESENTIEL,
        }),
        [TYPES_COURS.SYNCHRONE]: optionsDuFormateur(contexte.affectations ?? [], f.matricule, {
          type: TYPES_COURS.SYNCHRONE,
        }),
      });
    }
    return table;
  }, [contexte.formateurs, contexte.affectations]);

  /*
   * ═══ ⚠️ LES LISTES SONT MISES EN CACHE, PAS RECONSTRUITES PAR CASE ═══
   * `optionsDeLaCase` était appelée pour CHACUNE des 1 224 cases à chaque rendu,
   * et chaque appel allouait un tableau neuf — soit ~1 224 tableaux jetés
   * aussitôt, à chaque frappe, à chaque survol pendant un glissement de
   * sélection.
   *
   * Or ces listes ne dépendent que du FORMATEUR (pour les groupes) ou du couple
   * FORMATEUR + GROUPE (pour les modules) : il y en a quelques dizaines de
   * distinctes, pas 1 224. Le cache les construit une fois par grille.
   *
   * Effet de bord recherché : la prop `options` redevient STABLE d'un rendu à
   * l'autre, ce qui rend enfin utile le `memo` de `CaseEmploi`.
   */
  const listes = useMemo(() => {
    const salles = (contexte.salles ?? []).filter((salle) => salle.toUpperCase() !== 'TEAMS');
    const sallesCommunes = [
      { valeur: 'TEAMS', libelle: 'TEAMS' },
      ...salles.map((salle) => ({ valeur: salle, libelle: salle })),
    ];

    return {
      // Deux variantes seulement : la case porte une absence, ou non.
      sallePresente: [{ valeur: MARQUE_ABSENT, libelle: '⛔ Marquer absent' }, ...sallesCommunes],
      salleAbsente: [{ valeur: MARQUE_PRESENT, libelle: '✓ Marquer présent' }, ...sallesCommunes],
      // ⚠️ Un RATTRAPAGE ne se marque pas absent : le serveur le refuserait
      // (il ferait d'un rattrapage une nouvelle absence à rattraper).
      sallesSeules: sallesCommunes,
      formateurs: (contexte.formateurs ?? []).map((f) => ({
        valeur: f.matricule,
        libelle: f.nom,
      })),
      // ⚠️ INDEXÉES PAR `matricule||type` : les groupes d'une séance en salle et
      // ceux d'une séance à distance ne sont pas la même liste.
      groupes: new Map(
        [...options].flatMap(([matricule, jeux]) =>
          Object.entries(jeux).map(([type, jeu]) => [
            `${matricule}||${type}`,
            jeu.groupes.map((groupe) => ({ valeur: groupe, libelle: groupe })),
          ])
        )
      ),
      // Les modules se construisent à la DEMANDE : le couple formateur+groupe
      // n'est pas connu d'avance, et la plupart ne seront jamais ouverts.
      modules: new Map(),
    };
  }, [options, contexte.salles, contexte.formateurs]);

  /*
   * ═══ ⚠️ QUI MANQUE SUR CETTE LIGNE, CE JOUR-LÀ ═══
   * Les vacances ferment l'établissement — toute la colonne. Un STAGE ne ferme
   * qu'un GROUPE, une FORMATION qu'une PERSONNE : la ligne concernée se
   * verrouille, les autres restent ouvertes. C'est la règle déjà écrite dans le
   * chronogramme, et elle est la même ici.
   *
   * ⚠️ ON NE REGARDE QUE LA PORTÉE DE L'AXE. En vue par formateur, une ligne se
   * ferme sur une FORMATION ; en vue par groupe, sur un STAGE. L'autre motif ne
   * s'applique qu'à des cases déjà remplies — les verrouiller empêcherait de
   * retirer une séance qui n'aurait pas dû s'y trouver.
   */
  const absenceDuSujet = useCallback(
    (sujet, jour) => {
      const etat = etatDuJour.get(jour);
      if (!etat) return null;

      /*
       * ⚠️ LES BORNES VOYAGENT AVEC LE MOTIF (2026-08-26). La carte au survol
       * répond « jusqu'à quand ? » — sans les dates, elle ne saurait dire que ce
       * que la couleur de la case dit déjà.
       */
      if (axe === 'groupe') {
        /*
         * ═══ ⚠️ LE GEL DE RENTRÉE PORTE SUR L'ANNÉE DE FORMATION ═══
         * (2026-09-02.) Il se lit dans le NOM du groupe — « DEVOWFS201 » → 2 —
         * et ferme la ligne des seuls groupes qui ne sont pas encore rentrés.
         *
         * ⚠️ IL PASSE AVANT LE STAGE, comme côté serveur : sa portée est plus
         * large — toute une année de formation — et un groupe qui n'est pas
         * rentré n'est pas « en stage », il n'existe pas encore.
         *
         * ⚠️ ET RIEN EN VUE PAR FORMATEUR : un enseignant n'a pas d'année de
         * formation, il a ses 2ᵉ années le même jour. C'est la règle déjà posée
         * pour les stages, dans l'autre sens.
         */
        const gel = (etat.rentreesGelees ?? []).find(
          (r) => r.anneeFormation === anneeDuNomGroupe(sujet)
        );
        if (gel) {
          return {
            motif: 'rentree',
            libelle: `Rentrée le ${gel.date}`,
            debut: null,
            fin: gel.date,
          };
        }

        const stage = (etat.stages ?? []).find((s) => memeNom(s.groupe, sujet));
        return stage
          ? { motif: 'stage', libelle: stage.libelle, debut: stage.debut, fin: stage.fin }
          : null;
      }

      const formation = (etat.formations ?? []).find((f) => memeNom(f.matricule, sujet));
      return formation
        ? {
            motif: 'formation',
            libelle: formation.libelle,
            debut: formation.debut,
            fin: formation.fin,
          }
        : null;
    },
    [etatDuJour, axe]
  );

  /*
   * ═══ ⚠️ CE GROUPE EST-IL DÉJÀ PRIS SUR CE CRÉNEAU, AILLEURS DANS LA GRILLE ?
   * ═══
   * La grille range une séance sur la ligne de son groupe EXACT
   * (`indexerSeances`). Trois cas fabriquent donc une case qui PARAÎT libre
   * alors que les stagiaires sont en cours :
   *   - le groupe FQ — « ACADA101 (FQ) » a sa ligne, GM101 et GM102 la leur,
   *     et rien ne reliait les trois à l'écran ;
   *   - la FUSION — « GM101 GM102 » n'a AUCUNE ligne, la séance n'apparaît
   *     nulle part sur celles de ses membres ;
   *   - le SUFFIXE — « GE102 (GC) » et « GE102 » sont deux lignes distinctes.
   * Le serveur refusait bien la saisie, mais après coup. La case se ferme
   * désormais, et dit par quoi.
   *
   * ⚠️ EN VUE PAR GROUPE SEULEMENT. En vue par formateur, la ligne est une
   * PERSONNE : elle reste libre même quand un groupe ne l'est pas, et c'est la
   * liste déroulante qui porte déjà la mention « PRIS ».
   *
   * ⚠️ JAMAIS SUR UNE CASE REMPLIE. C'est la règle déjà écrite pour les stages
   * et les formations : verrouiller une séance déjà posée empêcherait de retirer
   * précisément ce qui n'aurait pas dû s'y trouver.
   *
   * ⚠️ ON INTERROGE `detecterConflits`, LA FONCTION DU SERVEUR — pas une
   * comparaison écrite ici. Elle seule connaît les trois cas ci-dessus, et une
   * seconde règle finirait par diverger (§4.2 du plan).
   */
  const occupationDuSujet = useCallback(
    (sujet, cellule, contenu) => {
      if (axe !== 'groupe' || contenu) return null;

      const surLeCreneau = parCreneau.get(`${cellule.jour}||${cellule.seance}||${periode}`);
      if (!surLeCreneau?.length) return null;

      const conflit = detecterConflits({ groupe: sujet }, surLeCreneau, {
        groupesFq: contexte.groupesFq ?? VIDE,
      }).find((c) => c.type === 'groupe');

      return conflit ? { par: conflit.seance.groupe, module: conflit.seance.module } : null;
    },
    [axe, parCreneau, periode, contexte.groupesFq]
  );

  /*
   * ═══ CRÉNEAUX À ÉVITER ET SALLES ATTRIBUÉES (2026-09-17) ═══
   * ← `autoGenConstraints` de emploi.html. En saisie manuelle, un créneau déclaré
   * à éviter NE SE FERME PAS (décision du porteur) : la case le dit, la liste des
   * formateurs aussi, et le directeur reste libre de poser la séance.
   */
  const indexContraintes = useMemo(
    () => indexerContraintes(contexte.contraintesFormateurs ?? VIDE),
    [contexte.contraintesFormateurs]
  );

  if (sujets.length === 0) return null;

  return (
    /*
     * ═══ ⚠️ LA SEMAINE ENTIÈRE TIENT DANS L'ÉCRAN ═══
     * `table-fixed w-full` : les 24 colonnes se PARTAGENT la largeur au lieu de
     * la réclamer. Une grille à défilement horizontal oblige à faire glisser
     * pour comparer le lundi et le vendredi — or c'est exactement ce qu'on
     * regarde quand on place une séance. Sur un écran étroit les codes se
     * replient sur deux lignes ; sur un écran de bureau, où cette page se
     * travaille, il reste de la place.
     */
    /*
     * ⚠️ `zoom` ET NON `transform: scale()` — c'est le choix déjà fait pour le
     * chronogramme, et il vaut ici pour la même raison : une mise à l'échelle par
     * transformation ne recalcule PAS la mise en page. La grille garderait la
     * largeur d'origine et déborderait, au lieu de se resserrer dans l'écran.
     * `zoom` refait le calcul, donc `table-fixed w-full` continue de faire tenir
     * les six jours.
     */
    /*
     * ═══ ⚠️⚠️ `overflow-clip` ET NON `overflow-hidden` ═══
     * (2026-08-26, demande du porteur : l'en-tête des jours doit rester en vue
     * quand on descend dans la grille.)
     *
     * Les deux coupent aux coins arrondis, mais `hidden` crée EN PLUS un
     * conteneur de défilement : le `sticky` de l'en-tête s'accrochait alors à ce
     * cadre-ci, qui ne défile jamais — donc il ne bougeait pas d'un pixel, sans
     * qu'aucune erreur ne le signale. `clip` coupe SANS créer ce conteneur :
     * l'en-tête s'accroche au vrai défilement, celui de la page.
     */
    <div className="overflow-clip rounded-lg border" style={{ zoom: zoom / 100 }}>
      <table className="w-full table-fixed select-none border-separate border-spacing-0 text-xs">
        <colgroup>
          <col className="w-[6.5rem]" />
          <col className="w-[2.25rem]" />
          {JOURS.flatMap((jour) => creneaux.map((creneau) => <col key={`${jour}-${creneau}`} />))}
        </colgroup>

        {/*
          ⚠️ EN-TÊTE SANS FOND GRIS (2026-08-25, demande du porteur). Sur une
          grille où les cases portent déjà six teintes de sens — stage,
          formation, vacances, férié, présentiel, distanciel — une bande grise
          en tête ajoutait une septième surface colorée qui, elle, ne veut rien
          dire. Ce sont les TRAITS qui structurent désormais l'en-tête.
        */}
        {/*
          ═══ ⚠️ LE FOND BLANC EST CE QUI REND L'EN-TÊTE COLLANT POSSIBLE ═══
          Les cases de jour sont VOLONTAIREMENT sans fond (décision ci-dessus) —
          mais un en-tête transparent qui reste en place laisse défiler les
          séances EN TRANSPARENCE dessous, et plus rien ne se lit. Le fond est
          donc posé sur le `thead`, PAS sur les cellules : il passe DERRIÈRE
          elles, si bien que l'ambre d'un férié et le bleu des vacances gardent
          exactement le rendu qu'ils avaient sur la page blanche — ils se
          composaient déjà sur du blanc. Aucune teinte ne change.

          ═══ ⚠️⚠️ `top: 0` NE SUFFISAIT PAS, ET LE DÉFAUT ÉTAIT VISIBLE ═══
          Chrome accroche un élément collant au bord du CONTENU du conteneur, pas
          à celui de sa zone visible : avec les 24 px de marge que la coquille
          pose sur toutes les pages, l'en-tête s'immobilisait 24 px trop bas — et
          **50 cellules du corps défilaient dans cette bande**, mesurées. On
          remonte donc de la valeur de cette marge.

          ⚠️ ET LE ZOOM LA DIVISE. `zoom` divise toutes les longueurs du
          sous-arbre : à 50 %, un `top: -24px` ne vaut plus que 12 px réels et la
          moitié de la bande fuit à nouveau. La valeur est donc DIVISÉE par le
          zoom pour que le décalage rendu reste constant, quel que soit le palier.
        */}
        <thead
          className="sticky z-20 bg-background text-tableau-tete-foreground"
          style={{ top: `${-MARGE_PAGE / (zoom / 100)}px` }}
        >
          <tr>
            {/*
              ⚠️ LE GRIS RESTE SUR CES DEUX CELLULES (2026-08-25, demande du
              porteur). Elles ne coiffent pas le calendrier : elles coiffent les
              INTITULÉS DE LIGNE, qui gardent eux aussi leur fond dans le corps.
              Le retrait du gris visait la bande au-dessus des jours — là où une
              teinte de plus entrait en concurrence avec celles qui portent un
              sens. Ici, il marque au contraire la colonne fixe.
            */}
            <th
              rowSpan={2}
              className="border-b border-r bg-tableau-tete px-2 py-2 text-left text-foreground"
            >
              {axe === 'groupe' ? 'Groupe' : 'Formateur'}
            </th>
            <th rowSpan={2} className={cn('border-b bg-tableau-tete', BORD_TABLEAU)} />

            {JOURS.map((jour) => (
              <EnTeteJour
                key={jour}
                jour={jour}
                dernier={jour === JOURS.at(-1)}
                etat={etatDuJour.get(jour)}
                colonnes={creneaux.length}
              />
            ))}
          </tr>

          <tr>
            {JOURS.flatMap((jour) =>
              creneaux.map((creneau, rang) => (
                <th
                  key={`${jour}-${creneau}`}
                  className={cn(
                    'border-b px-0.5 py-1 text-center text-[0.65rem] font-normal',
                    // ⚠️ LE TRAIT ÉPAIS TOMBE SUR LA DERNIÈRE COLONNE DU JOUR.
                    // Sans lui, 24 colonnes identiques : on compte les créneaux
                    // à la main pour savoir de quel jour on est en train de lire.
                    // ⚠️ Sauf tout à DROITE : là, ce n'est plus une séparation
                    // entre deux jours mais le BORD du tableau — il est plein.
                    // ⚠️ PLEIN DANS L'EN-TÊTE, pointillé dans le corps : en
                    // tête, le trait DÉLIMITE le jour ; dans la grille, il ne
                    // fait que séparer deux colonnes de saisie.
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
          {lignes.map((ligne) =>
            intitules.map((intitule, rang) => (
              <tr key={`${ligne.sujet}-${intitule}`}>
                {rang === 0 && (
                  <th
                    scope="rowgroup"
                    rowSpan={intitules.length}
                    className={cn(
                      /*
                       * ⚠️ CENTRÉ (2026-08-25, demande du porteur). Aligné à
                       * gauche, le nom flottait dans une colonne de 6,5 rem que
                       * les noms courts ne remplissent pas — et la charge, déjà
                       * centrée sous lui, paraissait décalée par rapport à lui.
                       */
                      'border-b border-r px-2 py-1.5 text-center align-top',
                      /*
                       * ⚠️ LA CASE ENTIÈRE PREND LA COULEUR DE LA CHARGE — fond
                       * ET texte, la même que portait le badge seul. Deux
                       * intensités (ligne pâle, badge soutenu) donnaient deux
                       * signaux pour un seul fait, et le badge de 30 px se
                       * cherchait quand même sur dix-sept lignes. Ici c'est le
                       * NOM qui se colore : c'est lui qu'on lit d'abord.
                       */
                      ligne.heures ? couleurCharge(ligne.heures) : 'bg-card'
                    )}
                  >
                    {/* ⚠️ SUR SA PROPRE LIGNE : accolée au nom, la charge se
                        lisait comme la fin de celui-ci — « AISSI 0 h ». */}
                    <span
                      className="block text-[0.7rem] font-medium leading-tight"
                    >
                      {nomDuSujet(ligne.sujet)}
                    </span>
                    {/*
                      La charge de la semaine, sur le bloc de tête : c'est là
                      qu'on la cherche quand on décide où placer la séance
                      suivante.

                      ⚠️ MÊMES COULEURS QUE LE TOTAL DU CHRONOGRAMME
                      (`couleurCharge`) : gris tant que rien n'est posé — zéro
                      n'est pas un manque, et toute la grille serait en alerte au
                      début de la saisie —, bleu tant qu'il reste de la place,
                      vert à la semaine PLEINE, rouge au-delà. Les seuils
                      `surcharge` / `eleve` de l'ancien badge disaient autre
                      chose, à deux écrans d'écart.
                    */}
                    {/*
                      ⚠️ CENTRÉE ET ENCADRÉE. Alignée à gauche sous un nom qui
                      tient souvent sur deux lignes, la charge se lisait comme la
                      suite de ce nom. Le cadre en fait une VALEUR, pas un
                      morceau de libellé.

                      ⚠️ PLUS DE CADRE DU TOUT (décision du porteur,
                      2026-08-25). Le bloc de tête est DÉJÀ un rectangle coloré,
                      nom compris : y encadrer la charge dessinait une boîte dans
                      la boîte, et le trait pesait plus que le nombre qu'il
                      entourait. Les deux essais précédents — cadre gris, puis
                      cadre suivant le texte — cherchaient à corriger la couleur
                      d'un trait dont le tort était d'exister.

                      Toujours PAS de fond propre : celui de la case suffit,
                      sinon deux rectangles colorés se superposent.
                    */}
                    <span
                      className="mt-1 block px-1 py-0.5 text-center text-[0.7rem] font-semibold tabular-nums"
                    >
                      {ligne.heures} h
                    </span>
                  </th>
                )}

                {/* ⚠️ ABRÉGÉ, ET SON SENS EN INFOBULLE : la colonne ne fait plus
                    que 2,25 rem — c'est ce que coûte l'affichage des six jours,
                    et « Formateur » n'y entre pas. */}
                <td
                  className={cn(
                    'border-b bg-tableau-tete/50 text-center text-[0.6rem] uppercase text-tableau-tete-foreground',
                    BORD_TABLEAU
                  )}
                >
                  {ABREGES[intitule] ?? intitule.slice(0, 3)}
                </td>

                {ligne.cases.map((cellule, colonne) => {
                  const cle = cleCase(ligne.sujet, cellule.jour, cellule.seance, periode);
                  /*
                   * ⚠️ LE BROUILLON L'EMPORTE sur ce qui est enregistré : c'est
                   * ce que la personne vient de choisir, et le perdre au rendu
                   * suivant ferait paraître la case sourde à la saisie.
                   */
                  const seance = brouillons.get(cle) ?? cellule.contenu;

                  return (
                    <CaseEmploi
                      key={cle}
                      /*
                       * ⚠️ `cellule` PASSÉE TELLE QUELLE, PAS RECOMPOSÉE. Un
                       * `{ ...cellule, cle, contenu: seance }` neuf à chaque
                       * rendu casse le `memo` de `CaseEmploi` même quand rien
                       * n'a changé pour cette case précise — `cle` et `seance`
                       * (déjà calculés ci-dessus) partent donc en props à part.
                       * `cellule` elle-même vient de `lignes`, mémorisé plus
                       * haut : sa référence est stable tant que `sujets`,
                       * `seances`, `axe` et `periode` ne bougent pas.
                       */
                      cellule={cellule}
                      cle={cle}
                      seance={seance}
                      periode={periode}
                      champ={intitule}
                      axe={axe}
                      etat={etatDuJour.get(cellule.jour)}
                      fiches={fiches}
                      posees={posees}
                      seanceDuSujet={rang === 0 ? { total: ligne.heures, niveau: ligne.niveau } : null}
                      selectionnee={selection.has(cle)}
                      enConflit={conflits.has(cle)}
                      enEdition={caseEnEdition?.cle === cle && caseEnEdition?.champ === intitule}
                      modeSelection={modeSelection}
                      /*
                       * ⚠️ SEULE LA PREMIÈRE LIGNE EST SAISISSABLE À LA SOURIS.
                       * Les trois lignes décrivent UNE séance : rendre les trois
                       * glissables ferait partir trois déplacements pour un seul
                       * geste, et le module quitterait son groupe.
                       */
                      deplacable={rang === 0}
                      survolee={survolDepot === cle}
                      absence={absenceDuSujet(ligne.sujet, cellule.jour)}
                      occupation={occupationDuSujet(ligne.sujet, cellule, seance)}
                      // En vue par groupe, c'est le formateur DE LA SÉANCE qui compte.
                      aEviter={creneauAEviter(
                        indexContraintes,
                        axe === 'groupe' ? seance?.formateurMatricule : ligne.sujet,
                        cellule.jour,
                        cellule.seance
                      )}
                      // Le nom de la ligne — la carte du verrou dit « les mêmes
                      // stagiaires que GM101 », ce qu'un nom de groupe seul ne
                      // laisse pas deviner quand c'est un FQ qui occupe.
                      sujet={ligne.sujet}
                      // Le motif ne s'écrit qu'une fois par case, sur la
                      // première des trois lignes : répété trois fois, il
                      // remplirait la colonne du jour.
                      premiereLigne={rang === 0}
                      // La dernière des trois lignes : c'est elle qui ferme le
                      // cadre pointillé d'un rattrapage.
                      derniereLigne={rang === intitules.length - 1}
                      placement={Boolean(onPlacerCase)}
                      onPlacer={onPlacerCase}
                      finDuJour={cellule.seance === creneaux[creneaux.length - 1]}
                      finDuTableau={colonne === colonnes.length - 1}
                      bords={
                        selection.has(cle)
                          ? bordsDuBloc({
                              selection,
                              sujets,
                              colonnes,
                              indexSujet: indexDuSujet.get(ligne.sujet),
                              colonne,
                              rang,
                              lignesParSujet: intitules.length,
                              periode,
                            })
                          : undefined
                      }
                      options={optionsDeLaCase({
                        intitule,
                        axe,
                        sujet: ligne.sujet,
                        seance,
                        options,
                        listes,
                        enEdition: caseEnEdition?.cle === cle && caseEnEdition?.champ === intitule,
                        fiches,
                        posees,
                        chargeFormateurs,
                        chargeGroupes,
                        // Ce qui occupe DÉJÀ ce créneau — pour éteindre ce qui
                        // serait refusé.
                        surLeCreneau:
                          parCreneau.get(`${cellule.jour}||${cellule.seance}||${periode}`) ?? VIDE,
                        // La composition des groupes FQ : c'est elle qui fait
                        // dire « PRIS » à un constituant pendant que son FQ
                        // siège. Le serveur applique la MÊME règle.
                        groupesFq: contexte.groupesFq ?? VIDE,
                        // Qui manque CE JOUR-LÀ — pour éteindre les options qui
                        // ne peuvent pas avoir cours.
                        etatDuJour: etatDuJour.get(cellule.jour),
                        contraintes: indexContraintes,
                        jour: cellule.jour,
                        creneau: cellule.seance,
                      })}
                      /*
                       * ⚠️ LES SIX GESTIONNAIRES REPARTENT SANS ENVELOPPE.
                       * Chacun venait avant d'une fermeture créée ICI, à ce
                       * point de la boucle, à CHAQUE rendu de la grille — donc
                       * une fonction neuve par case et par rendu, qui rendait
                       * inutile le `memo` de `CaseEmploi` : recevant une prop
                       * différente à chaque fois, il ne pouvait jamais
                       * conclure que rien n'avait changé. La case reconstitue
                       * elle-même le contexte (`cle`, `sujet`, `cellule`,
                       * `periode`, `champ`) à partir de ses propres props —
                       * déjà toutes présentes — et les fonctions d'origine
                       * (mémorisées côté page) descendent identiques pour les
                       * 1 224 cases.
                       */
                      onChanger={onChanger}
                      onOuvrir={onOuvrirCase}
                      onFermer={onFermerCase}
                      onDeplacer={onDeplacer}
                      onSelectionner={onSelectionner}
                    />
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Jetons de la liste des salles : ils changent le STATUT, pas la salle.
 * ⚠️ Préfixés `__` pour ne jamais entrer en collision avec un nom de salle réel
 * — « ABSENT » en était un dans l'existant, et une salle ainsi nommée devenait
 * impossible à saisir.
 */
export const MARQUE_ABSENT = '__absent__';
export const MARQUE_PRESENT = '__present__';

/**
 * L'en-tête d'un jour : son nom, sa date, et ce qui le ferme.
 *
 * ⚠️ LA CARTE AU SURVOL PLUTÔT QU'UN `title` NATIF — c'est le choix déjà fait
 * pour les semaines du chronogramme, et la même raison vaut ici : sur un jour à
 * la fois férié ET en vacances, la bulle du système se superposerait à la carte.
 * Une seule explication par colonne.
 */
function EnTeteJour({ jour, etat, colonnes, dernier }) {
  const contenu = (
    <th
      colSpan={colonnes}
      className={cn(
        'border-b px-2 py-1.5 text-center font-medium text-foreground',
        // ⚠️ PLEINS EN TÊTE : l'en-tête ENCADRE les jours, il ne les sépare pas
        // seulement — c'est lui qui donne sa structure au tableau depuis qu'il
        // n'a plus de fond. SAUF LE DERNIER, qui ne sépare aucun jour : c'est le
        // bord du tableau, et il se rend simple comme celui de gauche.
        dernier ? BORD_TABLEAU : BORD_PLEIN,
        // ⚠️ L'état se marque par JOUR : un férié isolé ferme le mardi sans rien
        // changer au reste de la semaine.
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

  const stages = etat?.stages ?? [];
  const formations = etat?.formations ?? [];
  const aDire = etat?.vacances || etat?.ferie || stages.length > 0 || formations.length > 0;

  if (!aDire) return contenu;

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>{contenu}</HoverCardTrigger>

      <HoverCardContent side="bottom" className="w-auto max-w-64 p-3">
        <p className="text-sm font-medium">
          {jour} {etat.date}
        </p>

        {etat.ferie && (
          <>
            <p className="mt-1 text-sm">{etat.ferie.intitule}</p>

            {/* ⚠️ `dir="rtl"` : sans lui, chiffres et parenthèses d'un intitulé
                arabe se rendent à l'envers. Même traitement que le calendrier
                des stages. */}
            {etat.ferie.intituleAr && (
              <p dir="rtl" lang="ar" className="mt-0.5 text-sm text-muted-foreground">
                {etat.ferie.intituleAr}
              </p>
            )}

            <p className="mt-2 text-xs text-muted-foreground">
              {etat.ferie.estime
                ? 'Date estimée — fête lunaire, confirmée quelques jours avant.'
                : 'Jour férié — aucune séance ne peut y être placée.'}
            </p>
          </>
        )}
        {/* ⚠️ `vacances` est un BOOLÉEN côté serveur, pas la période : il n'y a
            pas de nom à afficher ici. Le calendrier des vacances se consulte
            dans Paramètres. */}
        {etat.vacances && (
          <p className="mt-1 text-sm text-muted-foreground">Vacances — saisie bloquée.</p>
        )}

        {/*
          ⚠️ C'EST ICI QU'ON APPREND POURQUOI UNE LIGNE EST VERROUILLÉE. Un stage
          ou une formation ne ferment qu'une ligne : rien dans l'en-tête ne
          pouvait le dire, et les infobulles natives ont été retirées de la
          grille. La carte du jour NOMME donc qui manque.
        */}
        <ListeAbsents titre="En stage" entrees={stages.map((s) => s.groupe)} />
        <ListeAbsents
          titre="En formation"
          entrees={formations.map((f) => f.nom || f.matricule)}
        />
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * Les absents d'un jour, dans la carte de l'en-tête.
 *
 * ⚠️ BORNÉE À SIX NOMS, le reste compté. Une semaine de stage peut concerner
 * quinze groupes : la liste entière chasserait de la carte le motif du férié,
 * qu'on est venu lire.
 */
function ListeAbsents({ titre, entrees }) {
  if (entrees.length === 0) return null;

  return (
    <p className="mt-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{titre} : </span>
      {entrees.slice(0, 6).join(', ')}
      {entrees.length > 6 && ` … et ${entrees.length - 6} autre(s)`}
    </p>
  );
}

/**
 * Quels côtés d'une case touchent l'EXTÉRIEUR de la sélection.
 *
 * ⚠️ UN SUJET OCCUPE TROIS LIGNES, et les trois partagent une seule clé de
 * sélection. Le trait du haut ne tombe donc que sur la première (Groupe) et
 * celui du bas sur la dernière (Salle) — posés sur les trois, ils dessineraient
 * trois bandes empilées au lieu d'un rectangle.
 */
function bordsDuBloc({
  selection,
  sujets,
  colonnes,
  indexSujet,
  colonne,
  rang,
  lignesParSujet,
  periode,
}) {
  const selectionnee = (rangSujet, rangColonne) => {
    const sujet = sujets[rangSujet];
    const cible = colonnes[rangColonne];
    if (!sujet || !cible) return false;
    return selection.has(cleCase(sujet, cible.jour, cible.creneau, periode));
  };

  return {
    haut: rang === 0 && !selectionnee(indexSujet - 1, colonne),
    bas: rang === lignesParSujet - 1 && !selectionnee(indexSujet + 1, colonne),
    gauche: !selectionnee(indexSujet, colonne - 1),
    droite: !selectionnee(indexSujet, colonne + 1),
  };
}

/**
 * Ce que la liste d'une case propose.
 *
 * ⚠️ LES OPTIONS VIENNENT DES AFFECTATIONS, jamais de la liste complète : offrir
 * tous les groupes laisserait poser un cours que personne n'a été affecté à
 * donner. Le module dépend du groupe déjà choisi, pour la même raison.
 */
/**
 * Ce que la liste d'une case propose, ET ce qu'on sait de chaque proposition.
 *
 * ═══ ⚠️ LES REPÈRES SONT DANS LA LISTE, PAS SEULEMENT SUR LA CASE ═══
 * On choisit un groupe pour savoir s'il reste de la place, et un module pour
 * savoir ce qui manque encore : lire ces chiffres APRÈS avoir choisi oblige à
 * revenir en arrière. L'existant les portait déjà en attributs sur ses
 * `<option>` (`data-semester`, `data-regional`, `data-progress`,
 * emploi.html:5288).
 *
 * ⚠️ `meta` N'EST CALCULÉ QUE POUR LA CASE OUVERTE (`enEdition`). Les listes
 * sont construites pour les 1 224 cases à chaque rendu — n'y attacher des
 * indicateurs que là où ils seront lus évite 6 000 objets jetés aussitôt.
 */
function optionsDeLaCase({
  intitule,
  axe,
  sujet,
  seance,
  options,
  listes,
  enEdition,
  fiches,
  posees,
  chargeFormateurs,
  chargeGroupes,
  surLeCreneau = VIDE,
  groupesFq = VIDE,
  etatDuJour,
  contraintes,
  jour,
  creneau,
}) {
  /*
   * ⚠️ LE CONFLIT SE CHERCHE AVEC `detecterConflits`, LA MÊME FONCTION QUE LE
   * SERVEUR — pas avec une comparaison écrite ici. Elle sait qu'un libellé
   * fusionné occupe CHACUN de ses groupes, que « GE102 (GC) » et « GE102 » sont
   * la même classe, et que TEAMS n'occupe aucune salle. Une seconde règle aurait
   * éteint des options que le serveur accepte, ou l'inverse.
   *
   * Le candidat ne porte QUE le champ testé : les deux autres, laissés vides,
   * ne déclenchent rien — sans quoi un formateur déjà pris ferait paraître pris
   * TOUS les groupes de sa liste.
   */
  const dejaPris = (champ, valeur, genre) =>
    detecterConflits({ id: seance?.id, [champ]: valeur }, surLeCreneau, { groupesFq }).some(
      (conflit) => conflit.type === genre
    );

  if (intitule === 'Salle') {
    /*
     * ⚠️ L'ABSENCE SE MARQUE DEPUIS LA LIGNE « SALLE », comme dans l'existant où
     * l'on y saisissait « ABSENT ». La différence : elle ne REMPLACE plus la
     * salle — `Seance.statut` porte le fait, et l'on continue de savoir où le
     * cours aurait dû avoir lieu.
     *
     * « TEAMS » n'est pas un local : plusieurs séances peuvent l'employer en même
     * temps, et le serveur ne lui oppose aucun conflit. Il est proposé en tête —
     * ⚠️ mais SANS DOUBLON : certains établissements l'ont aussi saisi dans leurs
     * espaces, et deux entrées de même valeur cassent l'identité des enfants
     * React.
     */
    const base =
      seance?.statut === 'absent'
        ? listes.salleAbsente
        : seance?.statut === 'rattrape'
          ? listes.sallesSeules
          : listes.sallePresente;
    if (!enEdition) return base;

    /*
     * ═══ LES SALLES ATTRIBUÉES AU FORMATEUR PASSENT EN TÊTE (2026-09-17) ═══
     * Juste après les marques d'absence, dans l'ordre où l'établissement les a
     * cochées. Aucune salle n'est retirée : l'attribution est une préférence.
     */
    const matriculeSalle = axe === 'groupe' ? seance?.formateurMatricule : sujet;
    const attribuees = contraintes?.get(String(matriculeSalle ?? '').trim())?.espaces ?? VIDE;
    const marques = base.filter((option) => option.valeur.startsWith('__'));
    const salles = base.filter((option) => !option.valeur.startsWith('__'));
    const ordonnees = [
      ...marques,
      ...attribuees.map((nom) => salles.find((option) => option.valeur === nom)).filter(Boolean),
      ...salles.filter((option) => !attribuees.includes(option.valeur)),
    ];

    return ordonnees.map((option) => {
      /*
       * ⚠️ LES DEUX MARQUES ET « TEAMS » NE S'ÉTEIGNENT JAMAIS. Les marques ne
       * sont pas des salles ; TEAMS n'est pas un local, et dix séances peuvent
       * l'employer au même moment — c'est déjà ce que dit `estSalleReelle`.
       */
      const pris = estSalleReelle(option.valeur) && dejaPris('salle', option.valeur, 'salle');
      const attribuee = attribuees.includes(option.valeur);
      if (!pris && !attribuee) return option;
      return { ...option, desactive: pris, meta: { pris, attribuee } };
    });
  }

  if (intitule === 'Formateur') {
    if (!enEdition) return listes.formateurs;
    // La charge de la SEMAINE, pour voir d'un coup qui a encore de la place.
    return listes.formateurs.map((option) => {
      /*
       * ⚠️ UN FORMATEUR EN FORMATION NE PEUT PAS ÊTRE CHOISI, même depuis la
       * ligne d'un groupe. Le verrouillage de LIGNE ne joue qu'en vue par
       * formateur : sans ce contrôle, la vue par groupe laissait affecter
       * quelqu'un qui n'est pas dans l'établissement ce jour-là.
       */
      const absent = (etatDuJour?.formations ?? []).some((f) => memeNom(f.matricule, option.valeur));
      const pris = !absent && dejaPris('formateurMatricule', option.valeur, 'formateur');

      return {
        ...option,
        desactive: absent || pris,
        meta: {
          heures: chargeFormateurs?.get(option.valeur) ?? 0,
          pris,
          absence: absent ? 'en formation' : null,
          // Signalé, jamais éteint : la décision reste au directeur.
          aEviter: creneauAEviter(contraintes, option.valeur, jour, creneau),
        },
      };
    });
  }

  // Le formateur de la ligne, ou celui déjà posé dans la case en vue par groupe.
  const matricule = axe === 'groupe' ? seance?.formateurMatricule : sujet;
  const jeux = options.get(matricule);
  if (!jeux) return VIDE;

  /*
   * ⚠️⚠️ C'EST LA SALLE QUI DIT DE QUEL TYPE EST LA SÉANCE. « TEAMS » n'est pas
   * un local : la séance est à DISTANCE, donc mutualisée, et ses groupes sont
   * les libellés FUSIONNÉS de la carte. Toute autre salle — ou aucune — désigne
   * un cours en salle, qui ne réunit qu'une classe à la fois.
   *
   * Conséquence sur l'ORDRE DE SAISIE, et elle est voulue : pour poser une
   * séance mutualisée, on choisit TEAMS d'abord. Le brouillon retient ce choix,
   * et les listes de groupes et de modules s'y accordent aussitôt.
   */
  const type = typeDeSeance(seance);
  const jeu = jeux[type];

  if (intitule === 'Groupe') {
    const base = listes.groupes.get(`${matricule}||${type}`) ?? VIDE;
    if (!enEdition) return base;

    return base.map((option) => {
      /*
       * ⚠️ UN GROUPE EN STAGE N'A PAS COURS — et le dire ici évite de le
       * choisir en vue par formateur, où la ligne appartient à la personne et ne
       * peut donc rien en savoir.
       *
       * ⚠️ POUR UNE FUSION, IL FAUT QUE **TOUS** SES GROUPES SOIENT PARTIS.
       * Une séance à distance pour « GM101 GM102 » dont seul GM102 est en stage
       * a bien lieu — pour GM101. L'éteindre priverait de cours un groupe
       * présent.
       */
      const membres = separerFusion(option.valeur);

      /*
       * ═══ ⚠️⚠️ LE GEL DE RENTRÉE SE DIT ICI, ET C'EST INDISPENSABLE ═══
       * (2026-09-03, signalé par le porteur : « en emploi il ne fige pas », et
       * la saisie répondait 400.)
       *
       * Le verrouillage de LIGNE ne joue qu'en vue par GROUPE. En vue par
       * FORMATEUR — celle par défaut — la ligne appartient à une personne, qui
       * n'a pas d'année de formation : rien ne pouvait donc dire qu'un groupe
       * n'était pas encore rentré, et le refus n'arrivait qu'APRÈS le clic.
       *
       * ⚠️⚠️ ET LA RÈGLE EST `some`, PAS `every` — contrairement au stage juste
       * en dessous. Le SERVEUR refuse dès qu'UN SEUL membre d'une fusion n'est
       * pas rentré : lui opposer un `every` laisserait l'option choisissable et
       * ramènerait exactement l'erreur qu'on vient de fermer. Le stage, lui,
       * n'est refusé par aucun garde serveur — son `every` reste une aide à la
       * saisie, pas un contrat.
       */
      const gel = membres
        .map((membre) =>
          (etatDuJour?.rentreesGelees ?? []).find(
            (r) => r.anneeFormation === anneeDuNomGroupe(membre)
          )
        )
        .find(Boolean);

      const absent =
        !gel &&
        membres.length > 0 &&
        membres.every((membre) =>
          (etatDuJour?.stages ?? []).some((stage) => memeNom(stage.groupe, membre))
        );
      const pris = !gel && !absent && dejaPris('groupe', option.valeur, 'groupe');

      return {
        ...option,
        desactive: Boolean(gel) || absent || pris,
        meta: {
          heures: chargeGroupes?.get(option.valeur) ?? 0,
          pris,
          // ⚠️ Le motif NOMME la date : « pas encore rentré » seul laisse
          // chercher jusqu'à quand, et c'est la question qu'on se pose.
          absence: gel ? `rentrée le ${gel.date}` : absent ? 'en stage' : null,
        },
      };
    });
  }

  const groupe = axe === 'groupe' ? sujet : seance?.groupe;
  const cle = `${matricule}||${type}||${groupe}`;
  let base = listes.modules.get(cle);

  if (!base) {
    base = (jeu.modulesParGroupe.get(groupe) ?? []).map((module) => ({
      valeur: module,
      libelle: module,
    }));
    listes.modules.set(cle, base);
  }

  if (!enEdition) return base;

  return base.map((option) => {
    const fiche = fiches?.get(cleModule(groupe, option.valeur));
    // Le type de la case — TEAMS ou salle — décide de la masse de référence.
    const avancement = avancementModule(fiches, posees, groupe, option.valeur, type);

    /*
     * ⚠️ « ACHEVÉ » VAUT POUR CE TYPE-LÀ, PAS POUR LE MODULE ENTIER. Un module
     * peut avoir fini ses 25 h en salle et n'avoir pas commencé ses 15 h à
     * distance : le dire « achevé » sans dire lequel enverrait chercher une
     * erreur là où il n'y en a pas. C'est la liste qui porte le contexte —
     * elle ne montre déjà que les groupes du type courant.
     *
     * ⚠️ ET IL EST ÉTEINT, parce que le serveur le REFUSERAIT : depuis le
     * contrôle de quota, une séance de plus sur une masse atteinte revient en
     * 409. Le proposer quand même ferait découvrir le refus après le clic.
     */
    const acheve = avancement !== null && avancement.taux >= AVANCEMENT_ELEVE;

    return {
      ...option,
      /*
       * ⚠️ SAUF S'IL EST DÉJÀ DANS LA CASE. On le remplace alors par lui-même —
       * cela ne consomme aucune heure de plus, et l'éteindre empêcherait de
       * rouvrir la liste sur la valeur en place.
       */
      desactive: acheve && option.valeur !== seance?.module,
      meta: {
        semestre: fiche?.semestre ?? null,
        estRegional: Boolean(fiche?.estRegional),
        taux: avancement?.taux ?? null,
        niveau: avancement?.niveau ?? null,
        acheve,
        typeAcheve: type,
      },
    };
  });
}

/** ⚠️ UN SEUL tableau vide, partagé : en allouer un par case défait le `memo`. */
const VIDE = [];

/**
 * Deux noms désignent-ils le même sujet ?
 *
 * ⚠️ Comparaison INSENSIBLE À LA CASSE ET AUX ESPACES : les stages et les
 * formations sont saisis dans « Paramètres », les séances viennent de la base
 * e-note, et une majuscule d'écart suffirait à ne jamais verrouiller la ligne.
 */
const memeNom = (a, b) =>
  String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase() &&
  String(a ?? '').trim() !== '';
