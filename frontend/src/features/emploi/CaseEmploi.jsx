import { memo } from 'react';
import { Star } from 'lucide-react';
import { TYPES_COURS } from 'shared/constants';
import { avancementModule, typeDeSeance } from 'shared/domain';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import BadgeAvancement from '@/components/common/BadgeAvancement';
import BadgeSemestre from '@/components/common/BadgeSemestre';
import { cn } from '@/lib/utils';
import {
  CASE_SAISISSABLE,
  FOND_PRESENTIEL,
  FOND_SYNCHRONE,
  FOND_AVANT_RENTREE,
  FOND_FORMATION,
  FOND_STAGE,
  FOND_VACANCES,
  FOND_EFM,
  VALEUR_EFM,
  VALEUR_PRESENTIEL,
  VALEUR_SYNCHRONE,
  VALEUR_VIDE,
  FOND_BROUILLON_RATTRAPAGE,
  PASTILLE_RATTRAPAGE,
  TRAIT_RATTRAPAGE,
  couleurCharge,
  couleurChargeTexte,
} from '@/components/common/apparenceGrille';
import CarteModule from './CarteModule';
import CarteVerrou from './CarteVerrou';
import { BORD_TABLEAU, SEPARATION_JOUR } from './styles';

/**
 * Une case de la grille : une liste par ligne, et ses indicateurs.
 * ← la cellule de emploi.html — `custom-select-wrapper`, `semester-badge`,
 *   `regional-star`, `progress-badge`, `hour-badge`
 *
 * ═══ ⚠️ LE `Select` DE SHADCN N'EST MONTÉ QUE POUR LA CASE EN COURS ═══
 * La grille compte 17 formateurs × 3 lignes × 24 colonnes = **1 224 cases**.
 * Monter un `Select` de Radix dans chacune, c'est très exactement ce qui avait
 * figé la page Affectations — 780 listes, 15 900 nœuds, mesurés.
 *
 * Les cases au repos rendent donc un simple BOUTON, dessiné comme un
 * `SelectTrigger` ; le vrai composant Radix ne remplace ce bouton que sur la
 * case qu'on ouvre, et il s'ouvre du même clic. On a l'apparence et le
 * comportement de shadcn — panneau, navigation au clavier, coche sur la valeur
 * retenue — pour UNE liste montée, pas 1 224.
 */
function CaseEmploi({
  cellule,
  champ,
  axe,
  etat,
  options,
  fiches,
  posees,
  seanceDuSujet,
  selectionnee,
  enConflit,
  enEdition,
  modeSelection,
  absence,
  occupation,
  aEviter = false,
  sujet,
  premiereLigne,
  derniereLigne,
  deplacable,
  survolee,
  finDuJour,
  finDuTableau,
  bords,
  placement = false,
  onChanger,
  onOuvrir,
  onFermer,
  onSelectionner,
  onDeplacer,
  onPlacer,
}) {
  const seance = cellule.contenu;
  const absent = seance?.statut === 'absent';
  /*
   * ═══ UNE SÉANCE DE RATTRAPAGE (2026-09-14) ═══
   * Elle garde la couleur de sa NATURE — vert en salle, violet à distance : c'est
   * un cours comme un autre, compté comme tel. Ce qui la distingue se POSE
   * par-dessus : un cadre pointillé orange autour de la séance entière et la
   * pastille ↺ (décision C du porteur — la grille compte déjà six couleurs de
   * sens, une septième pour le fond aurait brouillé les autres).
   *
   * Le BROUILLON — placé d'un clic dans la modale, pas encore enregistré — prend
   * un fond orange pâle à la place du vert : il n'existe pas encore, et ne doit
   * pas se lire comme un cours posé.
   */
  const rattrapage = seance?.statut === 'rattrape';
  const brouillonRattrapage = Boolean(seance?.brouillonRattrapage);
  /*
   * ⚠️ QUATRE CAUSES, DEUX PORTÉES. Vacances et férié ferment l'ÉTABLISSEMENT —
   * toute la colonne. Un stage ne ferme qu'un GROUPE, une formation qu'une
   * PERSONNE : `absence` ne vaut que pour la ligne courante, et c'est la grille
   * qui l'a calculée sur la portée de son axe.
   */
  const ferme = etat?.vacances || etat?.ferie || Boolean(absence) || Boolean(occupation);
  /*
   * ⚠️ « TEAMS » N'EST PAS UNE SALLE, c'est une séance À DISTANCE — et le
   * violet est déjà sa couleur sur la carte d'affectations et dans le
   * chronogramme. La rendre verte comme un cours en salle ferait chercher un
   * local qui n'existe pas.
   */
  const aDistance = String(seance?.salle ?? '').toUpperCase() === 'TEAMS';

  const valeur = !seance
    ? ''
    : champ === 'Module'
      ? seance.module
      : champ === 'Salle'
        ? seance.salle
        : axe === 'groupe'
          ? seance.formateurMatricule
          : seance.groupe;

  const libelle = options.find((option) => option.valeur === valeur)?.libelle ?? valeur;

  return (
    <td
      data-case={cellule.cle}
      /*
       * ⚠️ LE GLISSEMENT NE PEUT PAS SERVIR À DEUX CHOSES À LA FOIS. En mode
       * sélection il trace un rectangle ; hors de ce mode il DÉPLACE la séance.
       * C'est la raison d'être du bouton de mode — l'existant avait le même.
       */
      draggable={deplacable && !placement && !modeSelection && Boolean(seance) && !ferme}
      onMouseDown={modeSelection ? onSelectionner : undefined}
      onDragStart={(evenement) => {
        evenement.dataTransfer.effectAllowed = 'copyMove';
        // Le presse-papiers du navigateur veut une charge utile, sinon Firefox
        // n'amorce pas le glissement.
        evenement.dataTransfer.setData('text/plain', cellule.cle);
        onDeplacer?.({ phase: 'debut', cle: cellule.cle });
      }}
      onDragOver={(evenement) => {
        if (!onDeplacer) return;
        // Sans `preventDefault`, la case n'est pas une destination valide et le
        // curseur affiche « interdit » partout.
        evenement.preventDefault();
        evenement.dataTransfer.dropEffect = evenement.ctrlKey ? 'copy' : 'move';
        onDeplacer({ phase: 'survol', cle: cellule.cle });
      }}
      onDrop={(evenement) => {
        evenement.preventDefault();
        onDeplacer?.({ phase: 'depot', cle: cellule.cle, copie: evenement.ctrlKey });
      }}
      onDragEnd={() => onDeplacer?.({ phase: 'fin' })}
      className={cn(
        'border-b p-0 text-center align-middle transition-colors',
        // ⚠️ LE DERNIER TRAIT NE SÉPARE PAS DEUX JOURS : c'est le bord droit du
        // tableau. Pointillé, le cadre semblait s'effilocher de ce côté.
        !finDuJour ? 'border-r' : finDuTableau ? BORD_TABLEAU : SEPARATION_JOUR,
        /*
         * ⚠️ UN FÉRIÉ NE COLORE QUE SON EN-TÊTE, PAS LA COLONNE ENTIÈRE. Une
         * bande ambre sur dix-sept lignes attire l'œil comme un blocage majeur,
         * alors qu'il s'agit d'UN jour — et c'est déjà la règle du chronogramme,
         * écrite en toutes lettres dans sa cellule. Les VACANCES, elles, gardent
         * leur aplat : elles ferment une PÉRIODE, et c'est bien la colonne
         * entière qui est hors service.
         */
        etat?.vacances && FOND_VACANCES,
        /*
         * ⚠️ LES MÊMES FONDS QUE LE CHRONOGRAMME, importés du module commun :
         * les deux écrans montrent la même absence, et deux teintes différentes
         * obligeraient à réapprendre le code en passant de l'un à l'autre.
         */
        absence?.motif === 'stage' && FOND_STAGE,
        absence?.motif === 'formation' && FOND_FORMATION,
        absence?.motif === 'rentree' && FOND_AVANT_RENTREE,
        /*
         * ⚠️ UN APLAT GRIS NEUTRE, PAS UNE TRAME. Les trames disent « quelqu'un
         * MANQUE » — stage, formation ; les aplats disent « cette case n'est pas
         * disponible » — vacances, férié. Un groupe déjà en cours ailleurs
         * relève du second : personne ne manque, la place est prise. Et le gris
         * ne rejoue aucune des couleurs qui portent déjà un sens dans la grille.
         */
        occupation && 'bg-muted',
        /*
         * ═══ UN CRÉNEAU À ÉVITER SE TEINTE, IL NE SE FERME PAS (2026-09-17) ═══
         * Sur une case VIDE seulement : une séance posée garde la couleur de sa
         * nature, et c'est la mention « à éviter » qui avertit.
         */
        aEviter && !ferme && !seance && 'bg-destructive/[0.06]',
        /*
         * ⚠️ UN EFM PREND L'AMBRE DE SON étoile régionale, pas le vert d'un
         * cours : ce n'est pas une heure de programme, et la couleur doit le
         * dire avant qu'on ne lise le badge.
         */
        seance?.estEfm && !ferme && FOND_EFM,
        seance &&
          !seance.estEfm &&
          !absent &&
          !ferme &&
          !brouillonRattrapage &&
          (aDistance ? FOND_SYNCHRONE : FOND_PRESENTIEL),
        brouillonRattrapage && FOND_BROUILLON_RATTRAPAGE,
        absent && 'bg-destructive/10',
        /*
         * ⚠️ UNE SÉANCE DÉPLAÇABLE PREND LE CURSEUR DE DÉPLACEMENT. Rien
         * d'autre à l'écran ne dit qu'une case se saisit — on ne tente pas un
         * geste dont on ignore l'existence.
         */
        deplacable && !placement && seance && !modeSelection && !ferme && 'cursor-grab active:cursor-grabbing',
        modeSelection && !ferme && 'cursor-cell',
        // La SÉLECTION l'emporte visuellement : c'est elle qu'on manipule.
        selectionnee && 'bg-primary/10',
        // La DESTINATION d'un dépôt est plus marquée encore, et en pointillé :
        // elle n'existe que le temps du geste, contrairement à une sélection.
        survolee && 'bg-primary/25 outline-dashed outline-2 -outline-offset-2 outline-primary',
        enConflit && 'ring-1 ring-inset ring-destructive'
      )}
      /*
       * ⚠️ LE CADRE NE TOMBE QUE SUR LE POURTOUR DU BLOC. Encadrer chaque case
       * donnait un damier de vingt-quatre boîtes ; ce qu'on manipule est UN
       * rectangle, et c'est lui qui doit se voir. `bords` dit quels côtés de la
       * case touchent l'extérieur de la sélection.
       *
       * En ombre INTERNE plutôt qu'en bordure : une bordure changerait la
       * largeur des colonnes, et la grille sauterait à chaque sélection.
       */
      style={
        selectionnee
          ? contourDuBloc(bords)
          : rattrapage
            ? /*
               * ⚠️ LE MÊME PROCÉDÉ QUE LA SÉLECTION : un seul cadre autour des
               * TROIS lignes de la séance — haut sur la première, bas sur la
               * dernière. Posé sur chacune, il dessinerait trois boîtes empilées.
               */
              contourDuBloc(
                { haut: premiereLigne, bas: derniereLigne, gauche: true, droite: true },
                TRAIT_RATTRAPAGE
              )
            : undefined
      }
    >
      {/*
        ⚠️ EN COLONNE, PLUS EN LIGNE. Côte à côte, les indicateurs mangeaient la
        moitié d'une case de 34 px et le code du module s'y réduisait à « E… ».
        Sur leur propre ligne, ils laissent la largeur entière au libellé — qui
        peut alors s'afficher EN ENTIER, en se repliant.
      */}
      <div className="flex flex-col items-stretch gap-0.5 px-0.5 py-0.5">

        {enEdition ? (
          <Select
            defaultOpen
            value={valeur || undefined}
            onValueChange={(choix) => onChanger(champ, choix === VIDE ? '' : choix)}
            onOpenChange={(ouvert) => {
              if (!ouvert) onFermer?.();
            }}
          >
            <SelectTrigger
              size="sm"
              className={cn(CASE_SAISISSABLE, 'h-7 border-ring px-1 text-[0.7rem] shadow-none [&>svg]:hidden')}
            >
              <SelectValue placeholder="—" />
            </SelectTrigger>

            <SelectContent className="max-h-64">
              {/* Une entrée explicite pour retirer : Radix refuse la valeur vide,
                  et sans elle on ne pourrait plus que remplacer, jamais effacer. */}
              <SelectItem value={VIDE} className="text-muted-foreground">
                — vider
              </SelectItem>
              {options.map((option) => (
                /*
                  ⚠️ FIGÉ, PAS MASQUÉ. Une option qui disparaît laisse chercher
                  pourquoi le groupe n'est plus proposé ; éteinte, elle dit à la
                  fois qu'elle existe et pourquoi elle ne peut pas être choisie.
                */
                <SelectItem
                  key={option.valeur}
                  value={option.valeur}
                  disabled={option.desactive}
                >
                  <span className="flex w-full items-center justify-between gap-3">
                    <span className="truncate">{option.libelle}</span>
                    <ReperesOption meta={option.meta} />
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          /*
            ⚠️ LA CARTE EXPLIQUE LE VERROU (2026-08-26, demande du porteur). Sans
            elle, une case éteinte ne disait rien à l'œil : son motif ne vivait
            que dans l'`aria-label`. Elle s'efface entièrement — sans un nœud de
            plus — dès que la case n'est ni verrouillée ni occupée.
          */
          <CarteVerrou
            absence={absence}
            occupation={occupation}
            sujet={sujet}
            modeSelection={modeSelection}
          >
          <button
            type="button"
            disabled={ferme}
            // En mode sélection le bouton laisse passer le glissement : sinon
            // tracer un rectangle ouvrirait une liste à chaque case traversée.
            tabIndex={modeSelection ? -1 : 0}
            onMouseDown={(evenement) => {
              if (modeSelection) return;
              evenement.stopPropagation();
            }}
            /*
             * ⚠️ EN MODE PLACEMENT (modale de rattrapage), LE CLIC PLACE — il
             * n'ouvre aucune liste : groupe, module et salle viennent de
             * l'absence.
             */
            onClick={() => {
              if (modeSelection) return;
              if (placement) onPlacer?.();
              else onOuvrir?.();
            }}
            aria-label={
              absence
                ? `${MOTIF[absence.motif]} — ${absence.libelle || 'sans intitulé'}`
                : occupation
                  ? `Créneau pris par ${occupation.par}`
                  : aEviter
                    ? 'Créneau à éviter — indisponibilité déclarée du formateur'
                    : undefined
            }
            className={cn(
              /*
               * ⚠️ LA MÊME BOÎTE QUE LA CELLULE DU CHRONOGRAMME : bordure
               * révélée au survol, coins arrondis, chiffres alignés. Le chevron
               * est retiré — à 31 px de large il mangeait le tiers de la case
               * pour redire ce que le survol montre déjà.
               */
              CASE_SAISISSABLE,
              /*
               * ⚠️ `min-h-7` ET NON `h-7` : la case doit pouvoir GRANDIR quand
               * le libellé se replie sur deux lignes. Une hauteur fixe l'aurait
               * simplement fait déborder sous la bordure.
               */
              'min-h-7 whitespace-normal break-words px-0.5 py-0.5 text-[0.65rem] leading-tight',
              modeSelection && 'pointer-events-none',
              !modeSelection && !ferme && 'cursor-pointer',
              absent
                ? 'font-semibold text-destructive line-through'
                : !valeur
                  ? VALEUR_VIDE
                  : /* ⚠️ L'EFM AVANT LE TYPE : une surveillance se passe en
                       salle, donc `aDistance` est faux et elle prenait le vert
                       d'un cours. Ce n'est pas un cours. */
                    seance?.estEfm
                    ? VALEUR_EFM
                    : aDistance
                      ? VALEUR_SYNCHRONE
                      : VALEUR_PRESENTIEL,
              ferme && 'cursor-not-allowed opacity-60'
            )}
          >
            {/* ⚠️ PLUS DE `truncate` : c'est la demande — « GM101 » et
                « EGTSI106 » doivent se lire ENTIERS, quitte à passer sur deux
                lignes. Une case dont le contenu est coupé à « E… » n'apprend
                rien et oblige à survoler. */}
            {/*
              ⚠️ UNE CASE VIDE RESTE VIDE (2026-08-25, demande du porteur). Le
              tiret ne disait rien de plus que le blanc, et répété sur les mille
              cases libres d'une semaine en début de saisie, il faisait une trame
              de traits où la grille ne se lisait plus. Le bouton garde son
              `min-h-7` : il reste cliquable, et la mise en page ne bouge pas
              quand une séance s'y pose.
            */}
            {/*
              ⚠️ LA CASE GELÉE DIT PAR QUOI. Un gris muet laisserait chercher
              pourquoi ce créneau ne s'ouvre pas — et la réponse est ailleurs
              dans la grille, sur une autre ligne. Le nom du groupe qui occupe
              (« ACADA101 (FQ) ») la donne d'un regard. Les infobulles natives
              ayant été retirées de la grille, c'est le seul endroit possible.
            */}
            <span className="w-full text-center">
              {occupation && premiereLigne ? (
                <span className="block truncate text-[0.6rem] font-medium text-muted-foreground">
                  {occupation.par}
                </span>
              ) : (
                libelle
              )}
              {/* Une fois par case, sur la première ligne. */}
              {aEviter && premiereLigne && !ferme && (
                <span className="block text-[0.55rem] font-semibold uppercase leading-tight text-destructive">
                  à éviter
                </span>
              )}
            </span>
          </button>
          </CarteVerrou>
        )}

        {/*
          ⚠️ LES INDICATEURS PASSENT SOUS LE NOM DU MODULE. Au-dessus, ils
          arrivaient AVANT ce qu'ils qualifient : l'œil lisait « 1 · 31 % » sans
          savoir de quoi, puis le code. En dessous, on lit d'abord le module,
          puis ce qu'on sait de lui — l'ordre naturel d'une légende.

          ⚠️⚠️ LA CARTE S'OUVRE SUR LES INDICATEURS, PAS SUR LE NOM DU MODULE
          (décision du porteur, 2026-08-25). Le nom occupe presque toute la case
          et c'est par là qu'on la traverse : la carte s'ouvrait alors en plein
          milieu d'une sélection, sur une case qu'on ne faisait que franchir. Les
          badges sont une CIBLE — on ne les vise que si on veut en savoir plus.
        */}
        {champ === 'Module' && (
          <SousCarte seance={seance} modeSelection={modeSelection}>
            <Indicateurs seance={seance} fiches={fiches} posees={posees} absent={absent} />
          </SousCarte>
        )}

        {/*
          Le badge d'heures ne vit que sur la PREMIÈRE ligne : posé sur les
          trois, il répéterait le même nombre côte à côte trois fois.
        */}
        {champ !== 'Module' && champ !== 'Salle' && seance && !absent && (
          <BadgeHeures heures={seanceDuSujet} />
        )}
      </div>
    </td>
  );
}

/**
 * ⚠️ LE MOTIF EST LU, PAS SURVOLÉ. Les infobulles natives ont été retirées de la
 * grille ; `aria-label` le dit aux lecteurs d'écran sans rouvrir une bulle noire
 * à chaque case franchie. À l'œil, c'est la carte de l'en-tête de jour qui
 * NOMME les groupes en stage et les formateurs en formation.
 */
/*
 * ⚠️ TOUT MOTIF AJOUTÉ À `disponibilite()` DOIT AVOIR SON LIBELLÉ ICI. Sans lui,
 * l'`aria-label` d'une case gelée rend « undefined — … » : la case se ferme
 * correctement, mais un lecteur d'écran n'apprend rien de la raison. Constaté à
 * l'écran le 2026-09-02 en ajoutant la rentrée.
 */
const MOTIF = {
  stage: 'Groupe en stage',
  formation: 'Formateur en formation',
  rentree: 'Pas encore la rentrée',
};

/**
 * La carte au survol, posée sur la RANGÉE D'INDICATEURS d'une case Module.
 *
 * ⚠️ ELLE NE S'OUVRE PAS EN MODE SÉLECTION. Tracer un rectangle balaie des
 * dizaines de cases : une carte qui se déplie au passage masque la grille qu'on
 * est en train de sélectionner. Un appui sur Ctrl rend la lecture.
 *
 * Sans module, sans groupe, ou en mode sélection, l'enveloppe s'efface
 * complètement : `children` est rendu tel quel, sans le moindre nœud de plus.
 */
function SousCarte({ seance, modeSelection, children }) {
  if (modeSelection || !seance?.module || !seance?.groupe) return children;

  return (
    <CarteModule groupe={seance.groupe} module={seance.module}>
      {children}
    </CarteModule>
  );
}

/**
 * Les quatre côtés du contour d'une sélection, EN POINTILLÉS.
 *
 * ⚠️ NI `box-shadow` NI `border`. Une ombre ne peut pas être pointillée ; une
 * bordure le peut, mais les côtés haut et gauche ont une largeur nulle dans
 * cette grille — leur en donner une décalerait toute la mise en page à chaque
 * sélection. On dessine donc les traits en FONDS superposés, qui n'occupent
 * aucune place.
 *
 * ⚠️ `currentColor` est INUTILISABLE ici — la case porte sa propre couleur de
 * texte. La teinte est donc écrite en clair, celle de `--primary`.
 */
function contourDuBloc(bords = {}, trait = 'hsl(209 100% 43%)') {
  const tirets = (sens) =>
    `repeating-linear-gradient(${sens}, ${trait} 0 4px, transparent 4px 8px)`;

  const cotes = [];
  if (bords.haut) cotes.push([tirets('90deg'), '100% 2px', 'left top', 'repeat-x']);
  if (bords.bas) cotes.push([tirets('90deg'), '100% 2px', 'left bottom', 'repeat-x']);
  if (bords.gauche) cotes.push([tirets('180deg'), '2px 100%', 'left top', 'repeat-y']);
  if (bords.droite) cotes.push([tirets('180deg'), '2px 100%', 'right top', 'repeat-y']);

  if (cotes.length === 0) return undefined;

  return {
    backgroundImage: cotes.map((c) => c[0]).join(', '),
    backgroundSize: cotes.map((c) => c[1]).join(', '),
    backgroundPosition: cotes.map((c) => c[2]).join(', '),
    backgroundRepeat: cotes.map((c) => c[3]).join(', '),
  };
}

/**
 * Ce qu'on sait d'une PROPOSITION, montré dans la liste elle-même.
 *
 * ⚠️ ON CHOISIT AVEC CES CHIFFRES, PAS APRÈS. Un groupe se retient parce qu'il
 * lui reste de la place, un module parce qu'il n'est pas encore couvert : les
 * lire une fois le choix fait oblige à revenir en arrière. L'existant les
 * portait déjà en attributs sur ses `<option>` (emploi.html:5288).
 */
function ReperesOption({ meta }) {
  if (!meta) return null;

  // Une liste de GROUPES ou de FORMATEURS : la charge de la semaine.
  if (meta.heures !== undefined) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        {/* ⚠️ L'ABSENCE PASSE AVANT « PRIS » : un groupe en stage n'a pas cours
            du tout, ce qui prime sur le fait qu'un créneau soit occupé. */}
        {meta.absence ? <Jeton>{meta.absence}</Jeton> : meta.pris && <Jeton>pris</Jeton>}
        {!meta.absence && !meta.pris && meta.aEviter && <Jeton>à éviter</Jeton>}
        <span
          className={cn(
            'rounded px-1 text-[0.65rem] font-medium tabular-nums',
            couleurCharge(meta.heures)
          )}
        >
          {meta.heures} h
        </span>
      </span>
    );
  }

  // Une liste de SALLES : rien à dire, sauf qu'elle est déjà occupée.
  if (meta.pris || meta.attribuee) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        {meta.attribuee && <Jeton>attribuée</Jeton>}
        {meta.pris && <Jeton>pris</Jeton>}
      </span>
    );
  }

  // Une liste de MODULES : ⭐ régional, semestre, avancement.
  return (
    <span className="flex shrink-0 items-center gap-1">
      {meta.estRegional && <Star className="size-2.5 fill-warning text-warning" />}

      <BadgeSemestre semestre={meta.semestre} />

      {/* ⚠️ « ACHEVÉ » DIT DE QUEL TYPE il l'est : un module peut avoir fini ses
          heures en salle sans avoir commencé celles à distance. */}
      {meta.acheve ? (
        <Jeton>
          achevé {meta.typeAcheve === TYPES_COURS.SYNCHRONE ? 'à distance' : 'en présentiel'}
        </Jeton>
      ) : (
        <BadgeAvancement avancement={meta} />
      )}
    </span>
  );
}

/**
 * Le motif pour lequel une option ne peut pas être choisie.
 *
 * ⚠️ EN GRIS, PAS EN ROUGE. L'option est déjà éteinte : y ajouter un rouge
 * d'alerte ferait passer pour un problème ce qui n'est qu'un état normal — un
 * groupe qui a cours ailleurs, un module qui a fini ses heures.
 */
const Jeton = ({ children }) => (
  <span className="shrink-0 whitespace-nowrap rounded bg-muted px-1 text-[0.6rem] font-medium uppercase tracking-wide text-muted-foreground">
    {children}
  </span>
);

/**
 * ⚠️ RADIX REFUSE UN `SelectItem` DE VALEUR VIDE — il s'en sert pour « rien de
 * choisi ». Il faut donc un jeton, traduit en chaîne vide à la sortie.
 */
const VIDE = '__vider__';

/**
 * ⭐ EFM régional · semestre · taux d'avancement.
 *
 * ⚠️ PAS DE TAUX SUR UNE SÉANCE ABSENTE : le cours n'a pas eu lieu, et afficher
 * son avancement là ferait croire qu'il compte. C'est ce que fait l'existant,
 * qui masque le badge dans ce cas.
 */
function Indicateurs({ seance, fiches, posees, absent }) {
  if (!seance?.module) return null;

  /*
   * ═══ ⚠️ UNE SURVEILLANCE N'A PAS DE TAUX ═══
   * Le surveillant n'enseigne pas, et le module n'avance pas pendant son propre
   * examen — c'est déjà la règle de `heuresPosees`. Afficher « 0 % » ou un taux
   * figé laisserait chercher pourquoi il ne bouge pas ; le badge dit ce que la
   * case EST.
   */
  if (seance.estEfm) {
    return (
      <span className="flex items-center justify-center">
        <span className="rounded bg-warning px-1 text-[0.55rem] font-semibold leading-4 text-white">
          EFM
        </span>
      </span>
    );
  }

  const fiche = fiches?.get(`${String(seance.groupe).trim().toUpperCase()}||${String(seance.module).trim().toUpperCase()}`);
  /*
   * ⚠️ LE TAUX SE RAPPORTE À LA MASSE DE SON TYPE. Une séance en salle se mesure
   * au présentiel prévu, une séance TEAMS au synchrone : rapportées au total,
   * 42,5 h de cours en salle s'affichaient à 106 % d'un quota de 40 h alors
   * qu'elles dépassent de 70 % les 25 h qui leur étaient destinées — la masse à
   * distance, intacte, absorbait l'écart.
   */
  const avancement = absent
    ? null
    : avancementModule(fiches, posees, seance.groupe, seance.module, typeDeSeance(seance));

  return (
    <span className="flex flex-wrap items-center justify-center gap-0.5">
      {/* La pastille ↺ : ce cours rattrape une absence (2026-09-14). */}
      {seance.statut === 'rattrape' && (
        <span className={PASTILLE_RATTRAPAGE} aria-label="Rattrapage">
          ↺
        </span>
      )}

      {fiche?.estRegional && (
        <Star className="size-2.5 shrink-0 fill-warning text-warning" />
      )}

      <BadgeSemestre semestre={fiche?.semestre} />

      <BadgeAvancement avancement={avancement} />
    </span>
  );
}

/**
 * La charge de la semaine, sur la case — ← `hour-badge` de l'existant.
 *
 * ⚠️ SANS AUCUN FOND. La case porte DÉJÀ le sien — vert pour une séance placée,
 * violet à distance, bleu en vacances : un second aplat par-dessus faisait un
 * rectangle dans le rectangle, et l'œil s'y arrêtait avant de lire le groupe.
 * Seule la couleur du texte signale la charge.
 *
 * ⚠️ ELLE VIENT DE `couleurChargeTexte`, comme l'en-tête de ligne. Le badge
 * testait encore `niveau`, resté sur les anciens seuils : « sous-charge » N'EXISTE
 * PAS — `niveauCharge` ne rend que `surcharge`, `eleve` ou `normal` — et
 * « eleve », le cas le plus courant, ne correspondait à aucune branche : le
 * nombre s'affichait en NOIR, sans rien dire de la charge.
 */
function BadgeHeures({ heures }) {
  if (!heures?.total) return null;

  return (
    <span
      /*
       * ⚠️ PLUS GRAND ET EN GRAS. À 0,55 rem et en `font-medium`, ce nombre se
       * lisait moins bien que le code du groupe posé juste au-dessus — alors
       * qu'il n'a plus de fond depuis qu'on l'a retiré, et que rien d'autre ne
       * le détache. C'est la charge de la semaine : elle décide de la case
       * suivante, elle doit se lire sans effort.
       */
      className={cn(
        'shrink-0 px-0.5 text-[0.65rem] font-bold leading-tight tabular-nums',
        couleurChargeTexte(heures.total)
      )}
    >
      {heures.total}h
    </span>
  );
}

/*
 * ⚠️ MÉMORISÉE. 1 224 cases se rendent à chaque frappe sans cela — et c'est la
 * mesure faite sur Affectations qui l'impose, pas une précaution de principe.
 */
export default memo(CaseEmploi);
