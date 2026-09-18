import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Presentation, Star } from 'lucide-react';
import Teams from '@/components/icons/Teams';
import {
  FIN_SEMESTRE_1,
  PAS,
  PLAFOND_CELLULE,
  TYPES,
  plafondSemaine,
  poserCellule,
  totauxModule,
  verifierCellule,
  cleLigne,
  effacerAvecJumelles,
  massesCumulees,
  poserAvecJumelles,
  posesCumulees,
  totalSemaineFusionnee,
} from 'shared/domain';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import BadgeSemestre from '@/components/common/BadgeSemestre';
import { cn } from '@/lib/utils';
import CarteCellule from './CarteCellule';
import NavigationSemaines from './NavigationSemaines';
import {
  FOND_AVANT_RENTREE,
  FOND_AVANT_RENTREE_PARTIEL,
  FOND_FORMATION as FOND_FORMATION_COMMUN,
  FOND_PRESENTIEL as FOND_PRESENTIEL_COMMUN,
  FOND_FORMATION_PARTIEL,
  FOND_STAGE_PARTIEL,
  FOND_STAGE as FOND_STAGE_COMMUN,
  FOND_SYNCHRONE as FOND_SYNCHRONE_COMMUN,
  couleurCharge,
  CADRE_RATTRAPAGE,
  FOND_BROUILLON_RATTRAPAGE,
  PASTILLE_RATTRAPAGE,
  VALEUR_PRESENTIEL,
  VALEUR_SYNCHRONE,
} from '@/components/common/apparenceGrille';

/**
 * La grille d'un groupe : modules en lignes, 45 semaines en colonnes.
 * ← `#chronoTable` de profil-principal.js:5601-5925
 *
 * ═══ LES COLONNES FIXES, ET LEURS DÉCALAGES ═══
 * Quatre colonnes collent à GAUCHE — module, régional, semestre, formateur — et
 * cinq à DROITE : MHP, MHP synchrone, posé, posé synchrone, écart.
 *
 * ⚠️ Chaque décalage `left-*` / `right-*` est le CUMUL des largeurs qui le
 * précèdent. Une seule valeur fausse et deux colonnes se superposent : « Posé »
 * disparaissait sous « Posé S » et ne réapparaissait qu'en défilant à fond.
 * D'où les constantes ci-dessous, calculées une fois plutôt qu'écrites à la
 * main dans chaque classe.
 */
const LARGEURS = {
  module: 8, // rem
  regional: 2.5,
  semestre: 3,
  formateur: 11,
  stat: 3.5,
};

/** Décalage cumulé, en rem, des colonnes de gauche. */
const GAUCHE = {
  module: 0,
  regional: LARGEURS.module,
  semestre: LARGEURS.module + LARGEURS.regional,
  formateur: LARGEURS.module + LARGEURS.regional + LARGEURS.semestre,
};

/** Et de celles de droite, la dernière collée au bord. */
const DROITE = {
  mhp: LARGEURS.stat * 4,
  mhpSynchrone: LARGEURS.stat * 3,
  pose: LARGEURS.stat * 2,
  poseSynchrone: LARGEURS.stat,
  ecart: 0,
};

/** Valeurs proposées — celles de `hoursOptions` de l'existant. */
const HEURES = Array.from({ length: PLAFOND_CELLULE / PAS }, (_, rang) => (rang + 1) * PAS);

const rem = (valeur) => `${valeur}rem`;

/**
 * Le filet rouge qui coupe les deux semestres, après la S17.
 * ← le séparateur de semestre du chronogramme d'EDT Pro
 *
 * ⚠️ IL SE POSE SUR LES TROIS ÉTAGES — en-tête, corps, pied. Mis sur le seul
 * en-tête, il s'arrêterait à la première ligne, et sur 45 colonnes identiques
 * plus rien ne dirait où le semestre bascule : on compte alors les colonnes à
 * la main pour savoir de quel côté on saisit.
 *
 * ⚠️ Et il REMPLACE la bordure de droite au lieu de s'y ajouter : `border-r` est
 * déjà posé sur chaque cellule, et tailwind-merge ne garde que le dernier des
 * deux — d'où l'ordre, la variante rouge en dernier.
 */
const FIN_SEMESTRE = 'border-r-2 border-r-destructive';

const finDeSemestre = (semaine) => semaine.numero === FIN_SEMESTRE_1;

/** La semaine est-elle dans la plage en cours de glissement ? */
function estDansLeGlissement(remplissage, module, numero) {
  if (!remplissage || remplissage.module !== module || remplissage.jusqu === null) return false;

  const { depuis, jusqu } = remplissage;
  // Le glissement va dans les DEUX sens : on recopie aussi vers la gauche.
  return numero >= Math.min(depuis, jusqu) && numero <= Math.max(depuis, jusqu);
}

/*
 * ⚠️ Radix REFUSE la chaîne vide comme valeur d'un `SelectItem` — elle lui sert
 * à représenter « aucune sélection ». « Effacer » a donc besoin d'un jeton à
 * lui, converti à zéro heure au moment de poser.
 */
const VIDE = '__vide__';

/**
 * Semaine PLEINE, en heures — le repère des couleurs du pied de grille.
 *
 * En dessous il reste de la place, au-dessus la semaine déborde : le générateur
 * d'emploi du temps ne pourra pas tout caser, et l'écart se découvrirait bien
 * plus tard comme un retard du formateur.
 */
const SEMAINE_PLEINE = 30;

/**
 * Couleur du total d'une colonne — TEXTE ET FOND.
 *
 * Le fond seul ne suffit pas (trop pâle pour être lu à 45 colonnes), le texte
 * seul se perd dans une ligne de chiffres : les deux ensemble font ressortir la
 * semaine qui déborde sans avoir à la chercher.
 */
function couleurTotal(total, seuil) {
  /*
   * ⚠️ LA RÈGLE VIT DANS LE MODULE COMMUN : l'emploi du temps colore la charge
   * de ses formateurs de la même façon, et deux jeux de seuils auraient divergé.
   * Le fond `bg-muted` du zéro reste ici — ce pied de grille est déjà gris.
   */
  if (!total) return 'text-muted-foreground bg-muted';
  return couleurCharge(total, seuil);
}

/*
 * ⚠️ VERT POUR LE PRÉSENTIEL, PAS UN SECOND BLEU.
 *
 * Le `bg-primary/10` des vacances signale une colonne INTERDITE. Un bleu ciel
 * sur une cellule saisie s'en approchait trop : à 45 colonnes, deux bleus
 * voisins ne se distinguent pas d'un coup d'œil, et on lisait « bloqué » là où
 * il y a des heures. Le vert n'a aucun homonyme dans cette grille.
 *
 * ⚠️ Le violet `--accent-purple` (#d6b6f6) est une teinte de FOND : en texte il
 * est illisible sur blanc. Les libellés synchrones prennent donc
 * `--accent-purple-deep` (#391c57), prévu pour cela.
 */
/* ⚠️ VENUES DU MODULE COMMUN : l'emploi du temps les emploie aussi, et deux
   jeux séparés auraient divergé au premier ajustement (§4.2). */
const FOND_PRESENTIEL = FOND_PRESENTIEL_COMMUN;
const FOND_SYNCHRONE = FOND_SYNCHRONE_COMMUN;

/*
 * ═══ LES DEUX ABSENCES : APLATS UNIS ═══
 *
 * Le stage et la formation sont deux indisponibilités de MÊME NATURE : quelqu'un
 * n'est pas là. Elles se distinguent par la teinte : cyan clair pour le
 * stage d'un groupe, rose clair pour la formation d'un formateur.
 * Teintes volontairement très pâles pour rester cohérentes avec les autres
 * fonds de la grille (vacances ~10 %, fériés ~25 %).
 */
export const FOND_STAGE = FOND_STAGE_COMMUN;

export const FOND_FORMATION = FOND_FORMATION_COMMUN;

/**
 * ⚠️ FOND OPAQUE OBLIGATOIRE sur toute cellule collante. En semi-transparent —
 * ou sans fond — les colonnes qui défilent se voient DESSOUS : c'est ce qui
 * faisait apparaître des chiffres fantômes entre les colonnes fixes.
 */
const COLLANTE_CORPS = 'sticky z-20 bg-card border-r';
const COLLANTE_ENTETE = 'sticky z-30 bg-tableau-tete border-r';

/**
 * ⚠️ LA LIGNE A SA PROPRE CLÉ, ET CE N'EST PAS TOUJOURS LE CODE DU MODULE.
 *
 * En mode formateur, la même grille porte le MÊME module pour plusieurs groupes
 * — « M102 » pour GM101 et pour GM102 — avec deux plannings distincts. Indexer
 * sur le seul code les confondrait : poser 5 h sur l'un les poserait sur
 * l'autre. Le mode groupe, lui, garde le code comme clé.
 */
const cleDe = (module) => module.cle ?? module.code;

/**
 * Pose une valeur dans une cellule, en lisant le planning LE PLUS RÉCENT.
 *
 * ⚠️ LE PLANNING PASSE PAR UNE `ref`, PAS PAR LA CLÔTURE. Un rappel qui
 * capture `planning` change d'identité à chaque rendu, et le `memo` des 765
 * cellules ne retient plus rien. La `ref` porte toujours la dernière valeur —
 * une pose ne peut donc pas écrire par-dessus un état périmé, ce qui est
 * exactement le piège déjà payé sur l'historique de l'emploi du temps.
 */
function useOnPoser(planning, onChanger, modules, semainesParDefaut) {
  const planningRef = useRef(planning);
  const onChangerRef = useRef(onChanger);
  const modulesRef = useRef(modules);
  const semainesRef = useRef(semainesParDefaut);
  planningRef.current = planning;
  onChangerRef.current = onChanger;
  modulesRef.current = modules;
  semainesRef.current = semainesParDefaut;

  return useCallback((cle, semaine, brut, masses) => {
    const courant = planningRef.current;
    const prevenir = onChangerRef.current;
    const tous = modulesRef.current ?? [];
    const module = tous.find((candidat) => cleLigne(candidat) === cle) ?? { cle, masses };

    /*
     * ⚠️ LE REPORT SUR LES GROUPES FUSIONNÉS VIT DANS LE DOMAINE
     * (`poserAvecJumelles`) : la recopie par glissement écrit elle aussi, et
     * deux exemplaires de la règle auraient divergé au premier ajustement.
     */
    if (brut === VIDE) {
      // Effacer est TOUJOURS permis : une cellule qu'on ne peut plus vider
      // enfermerait une saisie erronée.
      prevenir(effacerAvecJumelles({ planning: courant, modules: tous, module, semaine }).planning);
      return;
    }

    const [heures, type] = brut.split('|');
    /*
     * ⚠️ CE QUE LES AUTRES MODULES ONT DÉJÀ POSÉ CETTE SEMAINE-LÀ — sans la
     * cellule qu'on remplace, sinon on la compterait deux fois. C'est ce qui
     * borne une semaine amputée : une journée restante ne porte que 10 h, TOUS
     * MODULES CONFONDUS. `totalSemaineFusionnee` dédoublonne au passage la
     * séance synchrone mutualisée, que le domaine ne saurait pas reconnaître
     * seul.
     */
    const sansCetteCase = poserCellule(courant, cle, semaine.numero, 0, TYPES.PRESENTIEL);
    const controle = verifierCellule({
      planning: courant,
      module: cle,
      semaine,
      heures: Number(heures),
      type,
      masses,
      posesSemaine: totalSemaineFusionnee(sansCetteCase, semaine.numero, tous),
    });

    if (!controle.possible) {
      prevenir(null, controle.motif);
      return;
    }

    prevenir(
      poserAvecJumelles({
        planning: courant,
        modules: tous,
        module,
        semaine,
        heures: Number(heures),
        type,
        semainesParDefaut: semainesRef.current,
      }).planning
    );
  }, []);
}

export default function GrilleChronogramme({
  modules,
  semaines,
  planning,
  onChanger,
  /*
   * Colonne fixe n° 4 : les FORMATEURS d'un module en mode groupe, le GROUPE de
   * la ligne en mode formateur. C'est la seule différence de rendu entre les
   * deux vues — l'existant s'en tient là aussi, avec un seul générateur de
   * tableau pour les deux modes (profil-principal.js:5589).
   */
  colonne = { titre: 'Formateur', valeur: (module) => module.formateurs?.join(' · ') },
  /*
   * Repère du pied de grille. 30 h sature un GROUPE (6 jours × 5 séances) ; un
   * FORMATEUR, lui, a sa masse statutaire — 24 h le plus souvent. Colorer 30 h
   * en vert pour une personne présenterait un dépassement comme un objectif.
   */
  seuilPlein = SEMAINE_PLEINE,
  /*
   * ⚠️ LECTURE SEULE (Phase 5bis, étape d2) : un invité « peut consulter » voit
   * les heures, sans cellule qui s'ouvre ni poignée de recopie. Une saisie
   * offerte puis refusée à l'enregistrement serait pire qu'une case inerte.
   */
  lectureSeule = false,
  /*
   * Temps réel (2026-09-13) : le GROUPE de la grille, pour nommer une case d'une
   * façon que les deux vues partagent — en vue formateur, chaque ligne porte le
   * sien. Et `onOuverture(cle, precedente)` prévient la page qu'une case s'ouvre
   * ou se ferme, pour dire aux collègues « X modifie ».
   */
  groupe,
  onOuverture,
  /*
   * ═══ SEMAINES D'ABSENCE ET DE RATTRAPAGE (2026-09-14) ═══
   * `{ "GM101||M101": { 3: { absences, rattrapages, brouillon } } }`, clé en
   * MAJUSCULES — rendu par le serveur avec la grille (`marquesRattrapage`), la
   * modale de rattrapage y ajoute le créneau choisi mais pas encore enregistré.
   * Un REPÈRE sur la cellule, jamais une donnée du planning.
   */
  marques = null,
}) {
  /*
   * UNE seule cellule ouverte à la fois — c'est ce qui permet de n'avoir qu'un
   * `Select` de Radix monté, au lieu de 765.
   */
  const [ouverte, setOuverte] = useState(null);

  /*
   * La case ouverte, sous le nom que voient les collègues — `groupe||module||
   * semaine`, identique dans les deux vues. ⚠️ Une CHAÎNE en dépendance : les
   * modules sont un nouveau tableau à chaque donnée reçue, la case ouverte, elle,
   * n'a pas changé.
   */
  const cleOuverte = useMemo(() => {
    if (!ouverte) return null;
    const cible = modules.find((candidat) => cleDe(candidat) === ouverte.module);
    return cible ? `${cible.groupe ?? groupe}||${cible.code}||${ouverte.semaine}` : null;
  }, [ouverte, modules, groupe]);
  const surOuverture = useRef(onOuverture);
  surOuverture.current = onOuverture;
  const derniereOuverte = useRef(null);

  useEffect(() => {
    const avant = derniereOuverte.current;
    derniereOuverte.current = cleOuverte;
    if (avant !== cleOuverte) surOuverture.current?.(cleOuverte, avant);
  }, [cleOuverte]);

  // Une grille qu'on replie avec une case ouverte ne doit pas laisser « X modifie ».
  useEffect(
    () => () => {
      if (derniereOuverte.current) surOuverture.current?.(null, derniereOuverte.current);
    },
    []
  );

  /*
   * ═══ RECOPIE PAR GLISSEMENT, COMME DANS UN TABLEUR ═══
   * ← la `fill-handle` de profil-principal.js:6162-6230
   *
   * On saisit la poignée d'une cellule remplie, on glisse le long de la ligne,
   * on relâche : la valeur est recopiée sur toutes les semaines traversées.
   * C'est le geste qui évite de poser quarante fois « 5 h » à la main.
   *
   * L'état vit ICI et non dans la cellule : le glissement TRAVERSE les
   * cellules, aucune d'elles ne peut donc en être propriétaire.
   */
  const [remplissage, setRemplissage] = useState(null);

  /*
   * ⚠️ STABLE D'UN RENDU À L'AUTRE — c'est ce qui rend le `memo` des cellules
   * utile. Voir `useOnPoser`.
   */
  const onPoser = useOnPoser(planning, onChanger, modules, semaines);

  /*
   * Le conteneur de défilement est tenu ICI : la barre de navigation doit
   * pouvoir le mesurer et le déplacer, et c'est cette grille qui le possède.
   */
  const conteneur = useRef(null);
  const [zoom, setZoom] = useState(100);

  /**
   * Applique la recopie au relâchement.
   *
   * ⚠️ LE TRAVAIL SE FAIT HORS DE `setState`. Ma première version le plaçait
   * dans l'updater de `setRemplissage` et y appelait `onChanger` : React
   * autorise à rejouer un updater (il le fait en mode strict), et un effet de
   * bord qui s'y trouve part alors deux fois — ici, une boucle de rendu qui
   * fige la page. Un updater doit être PUR : il lit, il rend, il ne fait rien
   * d'autre.
   */
  const appliquerRemplissage = useCallback(() => {
    if (!remplissage || remplissage.jusqu === null) {
      setRemplissage(null);
      return;
    }

    const { module, depuis, jusqu, cellule } = remplissage;
    const min = Math.min(depuis, jusqu);
    const max = Math.max(depuis, jusqu);
    const cible = modules.find((candidat) => cleDe(candidat) === module);

    let suivant = planning;
    let refusees = 0;

    // ⚠️ Les semaines de LA LIGNE, pas les communes : un glissement ne doit pas
    // franchir le stage du groupe de cette ligne-là.
    for (const semaine of cible?.semaines ?? semaines) {
      if (semaine.numero < min || semaine.numero > max || semaine.numero === depuis) continue;

      /*
       * Chaque cellule repasse par la MÊME vérification qu'une saisie à la
       * main : un glissement ne contourne ni les vacances, ni le plafond d'une
       * semaine amputée, ni la masse horaire. Ce qui ne passe pas est COMPTÉ —
       * recopier douze cellules et n'en poser que trois sans le dire
       * laisserait croire à un défaut.
       */
      const sansCetteCase = poserCellule(suivant, module, semaine.numero, 0, TYPES.PRESENTIEL);
      const controle = verifierCellule({
        planning: suivant,
        module,
        semaine,
        heures: cellule.heures,
        type: cellule.type,
        masses: cible?.masses,
        // Même garde qu'à la saisie : un glissement ne contourne pas la
        // capacité de la semaine.
        posesSemaine: totalSemaineFusionnee(sansCetteCase, semaine.numero, modules),
      });

      if (!controle.possible) {
        refusees += 1;
        continue;
      }

      /* ⚠️ MÊME RÈGLE QUE LA SAISIE À LA MAIN : un glissement sur une séance
         mutualisée la reporte aussi sur ses autres groupes. */
      suivant = poserAvecJumelles({
        planning: suivant,
        modules,
        module: cible ?? { cle: module },
        semaine,
        heures: cellule.heures,
        type: cellule.type,
        semainesParDefaut: semaines,
      }).planning;
    }

    setRemplissage(null);

    if (suivant !== planning) onChanger(suivant);
    if (refusees > 0) {
      onChanger(
        null,
        `${refusees} semaine(s) non remplie(s) : vacances, stage, plafond ou masse horaire atteinte.`
      );
    }
  }, [remplissage, modules, semaines, planning, onChanger]);

  /*
   * ⚠️ UN SEUL ÉCOUTEUR SUR LA FENÊTRE, et non un `onPointerEnter` par cellule.
   * ← c'est le choix de `handleMouseMove()` dans profil-principal.js:6183.
   *
   * Ma première version posait un gestionnaire sur chacune des 765 cellules et
   * remontait la semaine survolée : chaque mouvement déclenchait un rendu de la
   * grille entière, qui recréait les gestionnaires, et la page se figeait.
   * `elementFromPoint` lit la cellule sous le curseur sans que personne n'ait à
   * écouter.
   *
   * Le relâchement est écouté sur la fenêtre pour la même raison qu'à
   * l'origine : on lâche souvent le bouton hors du tableau, et le glissement
   * resterait actif indéfiniment.
   */
  useEffect(() => {
    if (!remplissage) return undefined;

    const suivre = (evenement) => {
      const sous = document.elementFromPoint(evenement.clientX, evenement.clientY);
      const numero = Number(sous?.closest('[data-semaine]')?.dataset.semaine);
      if (!Number.isInteger(numero)) return;

      // Même valeur : on ne redéclenche pas de rendu. Sans ce garde, chaque
      // pixel parcouru en provoquait un.
      setRemplissage((courant) =>
        courant && courant.jusqu !== numero ? { ...courant, jusqu: numero } : courant
      );
    };

    window.addEventListener('pointermove', suivre);
    window.addEventListener('pointerup', appliquerRemplissage);

    return () => {
      window.removeEventListener('pointermove', suivre);
      window.removeEventListener('pointerup', appliquerRemplissage);
    };
  }, [remplissage, appliquerRemplissage]);

  /*
   * ⚠️ LE SYNCHRONE FUSIONNÉ NE COMPTE QU'UNE FOIS (2026-08-26, défaut signalé
   * par le porteur). En mode formateur, une séance mutualisée apparaît sur une
   * ligne PAR GROUPE : additionner les colonnes doublait le total hebdomadaire,
   * la masse annuelle du bandeau, et les colonnes « MHP S » et « Posé S ».
   * `totalSemaineFusionnee` a besoin des MODULES — rien dans une cellule ne dit
   * à quelle séance elle appartient.
   */
  const totaux = useMemo(
    () => semaines.map((semaine) => totalSemaineFusionnee(planning, semaine.numero, modules)),
    [planning, semaines, modules]
  );

  /*
   * Totaux du BLOC DE DROITE — la ligne de pied les laissait vides. Ce sont eux
   * qui répondent à « où en est ce groupe ? » : sans le cumul, il faut
   * additionner vingt lignes de tête pour savoir s'il reste des heures à poser.
   */
  const bilan = useMemo(() => {
    // ⚠️ Même règle que les totaux de colonne : une séance mutualisée n'est
    // déclarée qu'une fois, et posée qu'une fois.
    const masses = massesCumulees(modules);
    const poses = posesCumulees(modules, planning, totauxModule);

    return {
      mhp: masses.presentiel,
      mhpSynchrone: masses.synchrone,
      pose: poses.presentiel,
      poseSynchrone: poses.synchrone,
      ecart: arrondir(
        poses.presentiel + poses.synchrone - (masses.presentiel + masses.synchrone)
      ),
    };
  }, [modules, planning]);

  return (
    <div className="space-y-2">
      <NavigationSemaines
        semaines={semaines}
        planning={planning}
        conteneur={conteneur}
        zoom={zoom}
        onZoom={setZoom}
      />

      {/*
        ⚠️ `zoom` et non `transform: scale()` — c'est le choix de l'existant, et
        il est justifié : une mise à l'échelle par transformation ne recalcule
        pas la mise en page, les colonnes COLLANTES se décalent alors du reste.
        `zoom` refait le calcul, donc le défilement et l'adhérence restent
        justes.
      */}
      {/* `data-defile` : les curseurs des collègues se masquent hors de cette zone. */}
      <div ref={conteneur} data-defile className="overflow-x-auto rounded-lg border" style={{ zoom: zoom / 100 }}>
      <table className="w-max border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th
              style={{ left: rem(GAUCHE.module), width: rem(LARGEURS.module) }}
              className={cn(COLLANTE_ENTETE, 'border-b px-3 py-2 text-left')}
            >
              Module
            </th>
            <th
              style={{ left: rem(GAUCHE.regional), width: rem(LARGEURS.regional) }}
              className={cn(COLLANTE_ENTETE, 'border-b px-1 py-2 text-center text-xs font-normal')}
              title="EFM régional"
            >
              EFM
            </th>
            <th
              style={{ left: rem(GAUCHE.semestre), width: rem(LARGEURS.semestre) }}
              className={cn(COLLANTE_ENTETE, 'border-b px-1 py-2 text-center text-xs font-normal')}
            >
              Sem.
            </th>
            <th
              style={{ left: rem(GAUCHE.formateur), width: rem(LARGEURS.formateur) }}
              className={cn(COLLANTE_ENTETE, 'border-b border-r px-3 py-2 text-left font-normal')}
            >
              {colonne.titre}
            </th>

            {semaines.map((semaine) => (
              <EnTeteSemaine key={semaine.numero} semaine={semaine} />
            ))}

            <ColonnesStats entete />
          </tr>
        </thead>

        <tbody>
          {modules.map((module) => (
            <LigneModule
              key={cleDe(module)}
              module={module}
              colonne={colonne}
              /*
               * ⚠️ CHAQUE LIGNE A SES PROPRES SEMAINES. Les vacances et les
               * fériés valent pour l'établissement entier, mais un STAGE ne
               * ferme qu'un groupe : en mode formateur, une même colonne est
               * verrouillée pour la ligne de GM101 et ouverte pour celle de
               * GM102. Verrouiller la colonne entière ferait croire la semaine
               * fermée pour tout le monde — c'est la règle que l'existant écrit
               * en toutes lettres (profil-principal.js:5612).
               */
              semaines={module.semaines ?? semaines}
              identite={`${module.groupe ?? groupe}||${module.code}`}
              // ⚠️ L'objet de la LIGNE, stable d'un rendu à l'autre : la cellule
              // mémoïsée n'en reçoit que sa semaine.
              marquesLigne={marques?.[`${module.groupe ?? groupe}||${module.code}`.toUpperCase()]}
              planning={planning}
              ouverte={ouverte}
              onOuvrir={setOuverte}
              onPoser={onPoser}
              remplissage={remplissage}
              onDemarrerRemplissage={setRemplissage}
              lectureSeule={lectureSeule}
            />
          ))}
        </tbody>

        <tfoot>
          <tr className="font-medium">
            <td
              colSpan={4}
              style={{ left: rem(GAUCHE.module) }}
              className={cn(COLLANTE_ENTETE, 'border-r border-t px-3 py-2 text-right')}
            >
              Total / semaine
            </td>

            {totaux.map((total, rang) => (
              <td
                key={semaines[rang].numero}
                className={cn(
                  'border-r border-t bg-muted px-1 py-2 text-center font-semibold tabular-nums',
                  couleurTotal(total, seuilPlein),
                  finDeSemestre(semaines[rang]) && FIN_SEMESTRE
                )}
              >
                {total || '—'}
              </td>
            ))}

            {Object.entries(DROITE).map(([cle, decalage], rang) => (
              <td
                key={cle}
                style={{ right: rem(decalage), width: rem(LARGEURS.stat) }}
                className={cn(
                  COLLANTE_ENTETE,
                  'border-t px-1 py-2 text-center text-xs tabular-nums',
                  rang === 0 && 'border-l-2',
                  cle.endsWith('Synchrone') && 'text-accent-purple-deep',
                  (cle === 'mhp' || cle === 'pose') && 'text-accent-green',
                  cle === 'ecart' &&
                    (Math.abs(bilan.ecart) < 0.1 ? 'text-success' : 'text-destructive')
                )}
              >
                {cle === 'ecart'
                  ? Math.abs(bilan.ecart) < 0.1
                    ? '0'
                    : bilan.ecart > 0
                      ? `+${bilan.ecart}`
                      : bilan.ecart
                  : bilan[cle]}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      </div>
    </div>
  );
}

/**
 * En-tête d'une semaine.
 *
 * Les vacances reprennent le BLEU CLAIR du calendrier — même notion, même
 * couleur d'un écran à l'autre. Un jour férié se survole pour connaître la fête
 * et savoir si sa date est encore une estimation lunaire : un décalage de
 * dernière minute change la semaine où l'on peut planifier.
 */
function EnTeteSemaine({ semaine }) {
  const contenu = (
    <th
      className={cn(
        'w-14 border-b border-r bg-background px-1 py-2 text-center align-top text-xs font-medium',
        /*
         * ═══ ⚠️ L'AMBRE EST CELUI DU FÉRIÉ, ET DE RIEN D'AUTRE ═══
         * (2026-08-26, signalé par le porteur : « en S5, même s'il n'y a pas de
         * jour férié, tu mets la couleur du férié ».) La condition portait sur
         * `joursDisponibles < 6`, c'est-à-dire sur TOUTE semaine amputée : une
         * semaine rognée par un STAGE se peignait en ambre, la légende annonçait
         * « amputée d'un férié », et il n'y en avait aucun.
         *
         * L'en-tête reprend donc l'ordre des CELLULES : vacances, puis absence —
         * entière ou partielle, au gris —, et l'ambre en dernier, pour le seul
         * férié. Quand les deux se cumulent (« 3 JSTG » + « 1 JF »), c'est le
         * gris de l'absence qui l'emporte : elle retire plus de jours. Le badge,
         * lui, continue de nommer les deux.
         */
        semaine.motif === 'vacances' && 'bg-primary/10',
        semaine.motif === 'rentree' && FOND_AVANT_RENTREE,
        semaine.motif === 'stage' && FOND_STAGE,
        semaine.motif === 'formation' && FOND_FORMATION,
        !semaine.motif && semaine.joursRentree > 0 && FOND_AVANT_RENTREE_PARTIEL,
        !semaine.motif && !semaine.joursRentree && semaine.joursStage > 0 && FOND_STAGE_PARTIEL,
        !semaine.motif &&
          !semaine.joursRentree &&
          !semaine.joursStage &&
          semaine.joursFormation > 0 &&
          FOND_FORMATION_PARTIEL,
        !semaine.motif &&
          !semaine.joursRentree &&
          !semaine.joursStage &&
          !semaine.joursFormation &&
          (semaine.feries?.length ?? 0) > 0 &&
          'bg-warning/25',
        finDeSemestre(semaine) && FIN_SEMESTRE
      )}
    >
      {/*
        ═══ ⚠️ LE NUMÉRO ET LA DATE D'ABORD, LES BADGES ENSUITE ═══
        (2026-08-26, demande du porteur.) Les badges étaient AU-DESSUS : une
        colonne qui en portait deux poussait son numéro deux crans plus bas que
        ses voisines, et la rangée de numéros ne s'alignait plus. Placés en
        premier, les numéros tombent tous à la même hauteur quel que soit ce qui
        les suit.

        ⚠️ LA DATE RESTE SOUS LE NUMÉRO, pas à côté (correction du porteur) :
        côte à côte, la ligne devenait large et la colonne, qui ne fait que
        3,5 rem, s'élargissait pour la contenir.
      */}
      <span className="block">S{semaine.numero}</span>
      <span className="block text-[0.65rem] font-normal leading-tight text-muted-foreground">
        {semaine.debut.slice(8, 10)}/{semaine.debut.slice(5, 7)}
      </span>

      {/*
        ═══ LES BADGES DE L'ANCIEN EDT PRO ═══ (2026-08-26, demande du porteur.)
        Ils disent EN CHIFFRES ce que la teinte ne fait que suggérer : trois
        jours de stage ou six, la couleur est la même à un ton près. C'est ce que
        l'existant affichait — « VAC », « 1JF », « STG », « 3 JSTG » — et c'est ce
        qui remplace la carte au survol sur les semaines partielles, jugée
        gênante quand on parcourt la grille.
      */}
      <Badges semaine={semaine} />
    </th>
  );

  const feries = semaine.feries ?? [];
  /*
   * La colonne de bascule s'explique AU SURVOL, pas par un `title` natif : sur
   * une semaine qui porte aussi un férié, les deux se seraient superposés — la
   * bulle du système par-dessus la carte. Une seule explication par colonne.
   */
  if (feries.length === 0 && semaine.disponible && !finDeSemestre(semaine)) return contenu;

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>{contenu}</HoverCardTrigger>

      <HoverCardContent side="bottom" className="w-auto max-w-64 p-3">
        <p className="text-sm font-medium">
          Semaine {semaine.numero} — du {jourCourt(semaine.debut)} au {jourCourt(semaine.fin)}
        </p>

        {semaine.motif === 'vacances' && (
          <p className="mt-1 text-sm text-muted-foreground">Vacances — saisie bloquée.</p>
        )}
        {/*
          ⚠️ LA CARTE NOMME LA DATE, PAS SEULEMENT LE MOTIF. « Pas encore la
          rentrée » laisse chercher jusqu'à quand ; la date répond, et c'est
          elle qui dit à partir d'où la saisie redevient possible.
        */}
        {semaine.motif === 'rentree' && (
          <p className="mt-1 text-sm text-muted-foreground">
            Pas encore la rentrée
            {semaine.rentree ? ` — reprise le ${jourCourt(semaine.rentree)}` : ''} — saisie
            bloquée.
          </p>
        )}
        {!semaine.motif && (semaine.joursRentree ?? 0) > 0 && (
          <p className="mt-1 text-sm text-muted-foreground">
            {semaine.joursRentree} jour(s) avant la rentrée
            {semaine.rentree ? `, reprise le ${jourCourt(semaine.rentree)}` : ''}.
          </p>
        )}
        {semaine.motif === 'stage' && (
          <p className="mt-1 text-sm text-muted-foreground">
            Le groupe est en stage — saisie bloquée.
          </p>
        )}
        {finDeSemestre(semaine) && (
          <p className="mt-1 text-sm font-medium text-destructive">
            Dernière semaine du semestre 1 — le semestre 2 s’ouvre en S
            {FIN_SEMESTRE_1 + 1}.
          </p>
        )}
        {semaine.motif === 'formation' && (
          <p className="mt-1 text-sm text-muted-foreground">
            Le formateur est en formation — saisie bloquée.
          </p>
        )}

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
              {ferie.estime
                ? 'Date estimée — fête lunaire, confirmée quelques jours avant.'
                : 'Jour férié.'}
            </p>
          </div>
        ))}

        {semaine.disponible && semaine.joursDisponibles < 6 && (
          <p className="mt-2 text-xs text-warning">
            {semaine.joursDisponibles} jour(s) ouvré(s) — {plafondSemaine(semaine)} h au plus.
          </p>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * Ce qui ampute la semaine, en chiffres.
 * ← les badges « VAC », « 1JF », « STG », « 3 JSTG » de l'ancien EDT Pro
 *
 * ⚠️ « JOURS » ET « SEMAINE ENTIÈRE » SE DISENT DIFFÉREMMENT. `STG` ferme la
 * semaine ; `3 JSTG` dit que trois jours partent et que le reste se saisit —
 * c'est très exactement la distinction que la teinte seule ne peut pas porter,
 * et la raison d'être de ces badges.
 */
/**
 * ⚠️ STAGE ET FORMATION PARTAGENT LE GRIS (2026-08-26, demande du porteur).
 * Ce sont deux ABSENCES : quelqu'un n'est pas là. Le magenta du stage attirait
 * l'œil sur la rangée des numéros plus fort que tout le reste de l'en-tête,
 * alors que le badge ne fait qu'annoncer un décompte. Ce qui les distingue est
 * écrit dedans — « JSTG » ou « JFOR » — et la CELLULE, elle, garde sa teinte :
 * magenta pour un groupe en stage, gris pour un formateur en formation.
 */
const TEINTE_ABSENCE = 'bg-zinc-300 text-foreground dark:bg-zinc-600';

function Badges({ semaine }) {
  const badges = [];

  if (semaine.motif === 'vacances') badges.push(['VAC', 'bg-primary/20 text-primary']);
  /* « RENT » : pas encore la rentrée de cette année de formation. */
  else if (semaine.motif === 'rentree') badges.push(['RENT', TEINTE_ABSENCE]);
  else if (semaine.motif === 'stage') badges.push(['STG', TEINTE_ABSENCE]);
  else if (semaine.motif === 'formation') badges.push(['FOR', TEINTE_ABSENCE]);
  else {
    // Semaine OUVERTE : on compte ce qui en a été retiré.
    if (semaine.joursRentree > 0) {
      badges.push([`${semaine.joursRentree} JRENT`, TEINTE_ABSENCE]);
    }
    if (semaine.joursStage > 0) {
      badges.push([`${semaine.joursStage} JSTG`, TEINTE_ABSENCE]);
    }
    if (semaine.joursFormation > 0) {
      badges.push([`${semaine.joursFormation} JFOR`, TEINTE_ABSENCE]);
    }
  }

  const feries = semaine.feries?.length ?? 0;
  if (feries > 0) badges.push([`${feries} JF`, 'bg-warning/40 text-foreground']);

  if (badges.length === 0) return null;

  return (
    <span className="mt-1 flex flex-wrap justify-center gap-0.5">
      {badges.map(([libelle, teinte]) => (
        <span
          key={libelle}
          className={cn('rounded px-1 text-[0.55rem] font-semibold leading-4', teinte)}
        >
          {libelle}
        </span>
      ))}
    </span>
  );
}

function LigneModule({ module, colonne, semaines, identite, marquesLigne, planning, ouverte, onOuvrir, onPoser, remplissage, onDemarrerRemplissage, lectureSeule }) {
  const cle = cleDe(module);
  const poses = totauxModule(planning, cle);

  // ← `ecart = mht - mhp` : le chronogramme est complet quand il couvre
  // exactement la masse horaire, ni plus ni moins.
  const ecart = arrondir(
    poses.presentiel + poses.synchrone - (module.masses.presentiel + module.masses.synchrone)
  );
  const complet = Math.abs(ecart) < 0.1;

  return (
    <tr>
      <th
        scope="row"
        style={{ left: rem(GAUCHE.module), width: rem(LARGEURS.module) }}
        className={cn(COLLANTE_CORPS, 'border-b px-3 py-2 text-left font-medium')}
      >
        {/*
          Le code seul — « EGTS105 » — ne dit pas ce que le module enseigne. La
          colonne ne peut pas porter l'intitulé sans doubler sa largeur sur 45
          colonnes : il se lit au survol.
        */}
        {module.intitule ? (
          <HoverCard openDelay={200} closeDelay={80}>
            <HoverCardTrigger asChild>
              <span className="cursor-help underline decoration-dotted underline-offset-4">
                {module.code}
              </span>
            </HoverCardTrigger>
            <HoverCardContent side="right" className="w-auto max-w-72 p-3">
              <p className="text-sm font-medium">{module.code}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{module.intitule}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Presentation className="h-3.5 w-3.5 text-accent-teal" />
                  <span>{module.masses.presentiel} h présentiel</span>
                </span>
                {module.masses.synchrone > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <Teams className="h-3.5 w-3.5" />
                    <span>{module.masses.synchrone} h synchrone</span>
                  </span>
                )}
              </div>
            </HoverCardContent>
          </HoverCard>
        ) : (
          module.code
        )}
      </th>

      {/* Chacun sa colonne : alignés, ils se comparent d'une ligne à l'autre. */}
      <td
        style={{ left: rem(GAUCHE.regional), width: rem(LARGEURS.regional) }}
        className={cn(COLLANTE_CORPS, 'border-b px-1 py-2 text-center')}
      >
        {module.estRegional && (
          <Star className="mx-auto size-3.5 fill-warning text-warning" title="EFM régional" />
        )}
      </td>

      <td
        style={{ left: rem(GAUCHE.semestre), width: rem(LARGEURS.semestre) }}
        className={cn(COLLANTE_CORPS, 'border-b px-1 py-2 text-center')}
      >
        <BadgeSemestre semestre={module.semestre} />
      </td>

      {/*
        `data-colle` sur les deux cellules qui BORDENT les semaines : un curseur
        de collègue ne se dessine pas sur une semaine glissée sous elles.
      */}
      <td
        data-colle="gauche"
        style={{ left: rem(GAUCHE.formateur), width: rem(LARGEURS.formateur) }}
        className={cn(COLLANTE_CORPS, 'border-b border-r px-3 py-2 text-xs text-muted-foreground')}
        title={colonne.valeur(module) || undefined}
      >
        {/*
          En mode groupe : tous les formateurs du module — présentiel et
          synchrone assurés par deux personnes — car « le premier trouvé »
          laisserait croire qu'une seule personne l'assure.
          En mode formateur : le GROUPE de la ligne, sans quoi deux lignes du
          même module seraient indiscernables.
        */}
        <span className="line-clamp-2">{colonne.valeur(module) || '—'}</span>
      </td>

      {semaines.map((semaine) => (
        <Cellule
          key={semaine.numero}
          semaine={semaine}
          module={module}
          identite={identite}
          /*
           * ⚠⚠ SA VALEUR, PAS LE PLANNING ENTIER. Passer `planning` donnait à
           * chaque cellule une prop qui change dès qu'UNE case bouge : les 765
           * se re-rendaient à chaque frappe, et `memo` n'y pouvait rien. Ici la
           * prop ne change que si CETTE case a changé.
           */
          cellule={planning?.[cle]?.[semaine.numero]}
          marque={marquesLigne?.[semaine.numero]}
          ouverte={ouverte?.module === cle && ouverte?.semaine === semaine.numero}
          onOuvrir={onOuvrir}
          onPoser={onPoser}
          onDemarrerRemplissage={onDemarrerRemplissage}
          lectureSeule={lectureSeule}
          survole={estDansLeGlissement(remplissage, cle, semaine.numero)}
          /*
           * ⚠️ Module COMPLET : on ferme les cellules encore VIDES, pas toutes.
           * Tout verrouiller rendrait la ligne impossible à corriger — on ne
           * pourrait plus retirer une heure mal posée, et il faudrait défaire
           * tout le module. Les cellules déjà remplies restent modifiables.
           */
          complet={complet}
        />
      ))}

      <ColonnesStats module={module} poses={poses} ecart={ecart} />
    </tr>
  );
}

/**
 * Le bloc fixé à droite : MHP · MHP S · Posé · Posé S · Écart.
 * ← les cinq `col-stat-split` de profil-principal.js:5918-5923
 */
function ColonnesStats({ entete, module, poses, ecart }) {
  const cellules = entete
    ? [
        { cle: 'mhp', contenu: <span className="text-accent-green">MHP</span>, decalage: DROITE.mhp },
        { cle: 'mhpS', contenu: <>MHP <span className="text-accent-purple-deep">S</span></>, decalage: DROITE.mhpSynchrone },
        { cle: 'pose', contenu: <span className="text-accent-green">Posé</span>, decalage: DROITE.pose },
        { cle: 'poseS', contenu: <>Posé <span className="text-accent-purple-deep">S</span></>, decalage: DROITE.poseSynchrone },
        { cle: 'ecart', contenu: 'Écart', decalage: DROITE.ecart },
      ]
    : null;

  if (entete) {
    return cellules.map((cellule, rang) => (
      <th
        key={cellule.cle}
        style={{ right: rem(cellule.decalage), width: rem(LARGEURS.stat) }}
        className={cn(
          COLLANTE_ENTETE,
          'border-b px-1 py-2 text-center text-xs',
          rang === 0 && 'border-l-2'
        )}
      >
        {cellule.contenu}
      </th>
    ));
  }

  const complet = Math.abs(ecart) < 0.1;
  const classe = cn(COLLANTE_CORPS, 'border-b px-1 py-2 text-center text-xs tabular-nums');

  /*
   * ⚠️ LA TEINTE EST UN CALQUE, PAS UN FOND. Ces colonnes sont COLLANTES : leur
   * fond doit rester opaque, sinon les semaines qui défilent se voient dessous.
   * Poser `bg-accent-green/15` remplacerait le `bg-card` et ramènerait le défaut
   * de transparence corrigé plus tôt.
   *
   * ⚠️ ET SURTOUT : PAS DE `relative` ICI. `relative` et `sticky` appartiennent
   * au même groupe d'utilitaires — tailwind-merge ne garde que le dernier, donc
   * `relative` ÉCRASAIT le `sticky` de `COLLANTE_CORPS`. Les cinq colonnes
   * cessaient d'adhérer, se retrouvaient dans le flux, et les semaines
   * apparaissaient à leur place. `sticky` étant déjà un positionnement, il sert
   * de repère au pseudo-élément sans qu'on ait à en ajouter un second.
   */
  const fondPresentiel = 'before:absolute before:inset-0 before:-z-10 before:bg-accent-green/15';
  const fondSynchrone = 'before:absolute before:inset-0 before:-z-10 before:bg-accent-purple/25';

  return (
    <>
      <td
        data-colle="droite"
        style={{ right: rem(DROITE.mhp), width: rem(LARGEURS.stat) }}
        className={cn(classe, 'border-l-2 text-accent-green', fondPresentiel)}
      >
        {module.masses.presentiel}
      </td>
      <td
        style={{ right: rem(DROITE.mhpSynchrone), width: rem(LARGEURS.stat) }}
        className={cn(classe, 'text-accent-purple-deep', fondSynchrone)}
      >
        {module.masses.synchrone}
      </td>
      <td
        style={{ right: rem(DROITE.pose), width: rem(LARGEURS.stat) }}
        className={cn(classe, 'font-medium text-accent-green', fondPresentiel)}
      >
        {poses.presentiel}
      </td>
      <td
        style={{ right: rem(DROITE.poseSynchrone), width: rem(LARGEURS.stat) }}
        className={cn(classe, 'font-medium text-accent-purple-deep', fondSynchrone)}
      >
        {poses.synchrone}
      </td>
      <td
        style={{ right: rem(DROITE.ecart), width: rem(LARGEURS.stat) }}
        className={cn(classe, 'font-medium', complet ? 'text-success' : 'text-destructive')}
      >
        {complet ? '0' : ecart > 0 ? `+${ecart}` : ecart}
      </td>
    </>
  );
}

/**
 * Une cellule.
 *
 * ═══ LA LISTE SHADCN, MONTÉE SEULEMENT À L'OUVERTURE ═══
 * 17 modules × 45 semaines font 765 cellules. Monter 765 `Select` de Radix,
 * c'est très exactement ce qui rendait la page Affectations inutilisable —
 * 780 listes, 15 900 nœuds, mesurés.
 *
 * Au repos, la cellule est donc un simple BOUTON à l'allure d'un déclencheur
 * shadcn. Au clic, il cède la place à un vrai `Select`, ouvert d'emblée : on
 * obtient le style complet — panneau, groupes, coche, navigation clavier — avec
 * UNE SEULE instance montée à la fois, celle qu'on manipule.
 */
function CelluleBrute({ semaine, module, identite, cellule, marque, ouverte, onOuvrir, onPoser, complet, survole, onDemarrerRemplissage, lectureSeule }) {
  const cle = cleDe(module);
  // Une cellule VIDE d'un module complet n'a plus rien à recevoir.
  const verrouillee = !semaine.disponible || (complet && !cellule);
  const valeur = cellule ? `${cellule.heures}|${cellule.type}` : VIDE;

  const choisir = (brut) => {
    onOuvrir(null);
    onPoser(cle, semaine, brut, module.masses);
  };

  /*
   * ⚠️ TROIS VARIANTES PRÉCALCULÉES, PAS UN `cn()` PAR CELLULE. Voir
   * `APPARENCE` : `cn` fait tourner tailwind-merge, qui analyse chaque classe —
   * 765 cellules × 2 appels, c'est ce qui coûtait la seconde de rendu.
   */
  const apparence = APPARENCE[cellule ? cellule.type : 'vide'] ?? APPARENCE.vide;

  return (
    <td
      /*
       * ⚠️ CONCATÉNATION, PAS `cn()`. Les fonds sont rendus MUTUELLEMENT
       * EXCLUSIFS par `fondDeLaCellule` : il n'y a donc plus de conflit de
       * classes à arbitrer, et tailwind-merge n'a plus rien à faire ici.
       *
       * ⚠️ CE QUI EST POSÉ L'EMPORTE sur la teinte de la colonne — l'ordre du
       * ternaire porte cette règle, là où `cn` la tirait de l'ordre des
       * arguments.
       */
      className={
        'group/cellule relative border-b border-r p-0 text-center' +
        fondDeLaCellule(cellule, semaine) +
        (survole ? ' ring-1 ring-inset ring-primary' : '') +
        (finDeSemestre(semaine) ? ' ' + FIN_SEMESTRE : '')
      }
      data-semaine={semaine.numero}
      /*
       * L'identité de la case pour le temps réel : `groupe||module||semaine`, la
       * même en vue groupe et en vue formateur — un curseur posé d'un côté se
       * retrouve de l'autre.
       */
      data-case={`${identite}||${semaine.numero}`}
    >
      {ouverte ? (
        <ListeHeures
          valeur={valeur}
          cellule={cellule}
          module={module}
          apparence={apparence}
          plafond={plafondSemaine(semaine)}
          onChoisir={choisir}
          onFermer={() => onOuvrir(null)}
        />
      ) : (
        /*
         * Une cellule éteinte sans explication envoie chercher une panne. Le
         * motif de la colonne est dans l'en-tête, mais en vue par GROUPE une
         * ligne peut être seule verrouillée — et depuis que les absences se
         * comptent en jours, une cellule OUVERTE peut aussi refuser 20 h sans
         * que rien ne le dise. `CarteCellule` porte les deux cas ; elle
         * s'efface entièrement quand il n'y a rien à expliquer.
         */
        <CarteCellule semaine={semaine} complet={complet} cellule={cellule}>
        {lectureSeule ? (
          // La valeur, sans bouton : rien ne s'ouvre, et le lecteur d'écran ne
          // l'annonce pas comme une commande.
          <span className={apparence + ' mx-auto cursor-default hover:border-transparent'}>
            {cellule ? cellule.heures : ''}
          </span>
        ) : (
        <button
          type="button"
          disabled={verrouillee}
          onClick={() => onOuvrir({ module: cle, semaine: semaine.numero })}
          className={apparence + ' mx-auto disabled:cursor-not-allowed disabled:opacity-40'}
        >
          {/*
            ⚠️ UNE CELLULE VIDE RESTE VIDE (2026-08-25, demande du porteur, comme
            pour l'emploi du temps). Le tiret ne disait rien de plus que le
            blanc, et répété sur les CENTAINES de cellules libres d'une grille de
            45 semaines — 539 relevées sur un seul groupe — il faisait une trame
            de traits où les heures posées ne ressortaient plus. Le bouton garde
            sa taille : il reste cliquable et rien ne bouge quand on saisit.
          */}
          {cellule ? cellule.heures : ''}
        </button>
        )}
        </CarteCellule>
      )}

      <MarqueCellule marque={marque} />

      {/*
        La poignée n'apparaît que sur une cellule REMPLIE, et au survol de la
        ligne : posée en permanence sur 765 cellules, elle ferait un semis de
        points bleus illisible. `touch-none` empêche le défilement de la page de
        voler le geste sur un écran tactile.
      */}
      {cellule && !ouverte && !lectureSeule && (
        <span
          role="presentation"
          onPointerDown={(evenement) => {
            evenement.preventDefault();
            evenement.stopPropagation();
            onDemarrerRemplissage({
              module: cle,
              depuis: semaine.numero,
              jusqu: semaine.numero,
              cellule,
            });
          }}
          title="Glisser pour recopier sur les semaines suivantes"
          className={cn(
            'absolute bottom-0 right-0 size-2 cursor-crosshair touch-none rounded-sm bg-primary',
            'opacity-0 transition-opacity group-hover/cellule:opacity-100'
          )}
        />
      )}
    </td>
  );
}


/**
 * ═══ ⚠️ POURQUOI CES CLASSES SONT PRÉCALCULÉES ═══
 * `cn()` fait tourner tailwind-merge, qui ANALYSE chaque classe pour arbitrer
 * les conflits. Une grille compte 765 cellules et en appelait DEUX par cellule :
 * mesuré, le montage d'une seule grille coûtait **1,3 seconde**, quand les mêmes
 * 765 `<td><button>` créés à la main en DOM pur en coûtent **8** — 160 fois
 * moins. Ce n'était ni le DOM, ni la mise en page, ni le nombre de groupes
 * cochés : c'était l'analyse des classes, répétée à chaque rendu.
 *
 * Les variantes sont en nombre FINI et connues d'avance : on les écrit une fois.
 */
const APPARENCE_BASE =
  'flex h-8 w-14 items-center justify-center rounded-md border border-transparent ' +
  'text-xs tabular-nums transition-colors ' +
  'hover:border-input focus-visible:border-ring focus-visible:outline-none ' +
  'focus-visible:ring-1 focus-visible:ring-ring ';

const APPARENCE = {
  [TYPES.SYNCHRONE]: APPARENCE_BASE + VALEUR_SYNCHRONE,
  // ⚠️ La MÊME couleur que la valeur d'une séance dans l'emploi du temps : c'est
  // le même fait montré sous deux angles.
  [TYPES.PRESENTIEL]: APPARENCE_BASE + VALEUR_PRESENTIEL,
  vide: APPARENCE_BASE + 'text-muted-foreground',
};

/**
 * Le fond d'une cellule — UN SEUL, choisi, jamais superposé.
 *
 * ⚠️ Les fériés ne colorent QUE l'en-tête, pas la colonne : une bande ambre sur
 * vingt lignes attirait l'œil comme un blocage, alors que ces semaines se
 * saisissent — avec un plafond réduit, ce que le survol de l'en-tête explique.
 */
function fondDeLaCellule(cellule, semaine) {
  if (cellule) {
    return cellule.type === TYPES.SYNCHRONE ? ' ' + FOND_SYNCHRONE : ' ' + FOND_PRESENTIEL;
  }
  if (semaine.motif === 'vacances') return ' bg-primary/10';
  if (semaine.motif === 'rentree') return ' ' + FOND_AVANT_RENTREE;
  if (semaine.motif === 'stage') return ' ' + FOND_STAGE;
  if (semaine.motif === 'formation') return ' ' + FOND_FORMATION;
  /*
   * ⚠️ UNE SEMAINE SEULEMENT AMPUTÉE PREND LA TEINTE PLUS CLAIRE (2026-08-26,
   * demande du porteur). Trois jours de stage laissent trois jours ouverts : la
   * cellule reste saisissable, et l'aplat plein d'une semaine fermée ferait
   * croire l'inverse. La carte au survol donne le plafond exact.
   */
  if ((semaine.joursRentree ?? 0) > 0) return ' ' + FOND_AVANT_RENTREE_PARTIEL;
  if ((semaine.joursStage ?? 0) > 0) return ' ' + FOND_STAGE_PARTIEL;
  if ((semaine.joursFormation ?? 0) > 0) return ' ' + FOND_FORMATION_PARTIEL;
  return '';
}

/**
 * La liste des heures, montée UNIQUEMENT pour la cellule ouverte.
 *
 * ⚠️ `HEURES.filter()` et le calcul du plafond vivaient dans CHAQUE cellule :
 * 765 tableaux alloués par rendu pour une liste qu'on n'ouvre qu'une à la fois.
 */
function ListeHeures({ valeur, cellule, module, apparence, plafond, onChoisir, onFermer }) {
  const disponibles = HEURES.filter((heures) => heures <= plafond);

  return (
    <Select
      defaultOpen
      value={valeur}
      onValueChange={onChoisir}
      // Refermer sans choisir doit rendre la cellule au bouton, sinon un Select
      // resterait monté après chaque survol malheureux.
      onOpenChange={(ouvert) => !ouvert && onFermer()}
    >
      <SelectTrigger className={cn(apparence, 'border-ring px-1 [&>svg]:hidden')}>
        {/* ⚠️ Une cellule vide reste VIDE, comme le bouton au repos. */}
        <SelectValue>{cellule ? cellule.heures : ''}</SelectValue>
      </SelectTrigger>

      <SelectContent className="min-w-28">
        <SelectItem value={VIDE}>–</SelectItem>

        <SelectGroup>
          <SelectLabel>Présentiel</SelectLabel>
          {disponibles.map((heures) => (
            <SelectItem key={`${heures}P`} value={`${heures}|P`}>
              {heures}
            </SelectItem>
          ))}
        </SelectGroup>

        {/*
          Le groupe « Synchrone » n'apparaît QUE si le module porte des heures
          synchrones : en proposer sur un module qui n'en a pas invite à poser
          des heures que la masse refusera ensuite.
        */}
        {module.masses.synchrone > 0 && (
          <SelectGroup>
            <SelectLabel className="text-accent-purple-deep">Synchrone</SelectLabel>
            {disponibles.map((heures) => (
              <SelectItem key={`${heures}S`} value={`${heures}|S`}>
                {heures} (S)
              </SelectItem>
            ))}
          </SelectGroup>
        )}

        {/*
          Une valeur enregistrée que la liste ne propose plus — masse synchrone
          retirée depuis, ou plafond réduit par un férié ajouté — reste
          choisissable. Sans elle, Radix n'aurait aucun élément correspondant et
          le déclencheur retomberait sur du vide, donnant une cellule vide alors
          qu'elle porte des heures.
        */}
        {cellule && !disponibles.some((h) => `${h}|${cellule.type}` === valeur) && (
          <SelectItem value={valeur}>{cellule.heures} !</SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}

/**
 * La légende des deux repères — sur la page Chronogramme et dans la modale de
 * rattrapage. Écrite une fois : deux légendes finiraient par ne plus décrire
 * le même dessin.
 */
export function LegendeRattrapage({ avecBrouillon = false }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <span className="rounded bg-destructive px-1 text-[0.55rem] font-semibold leading-4 text-white">A</span>
        séance absente cette semaine
      </span>
      <span className="flex items-center gap-1">
        <span className={cn('relative inline-block h-4 w-6 rounded', CADRE_RATTRAPAGE)} />
        <span className={PASTILLE_RATTRAPAGE}>↺</span>
        rattrapage
      </span>
      {avecBrouillon && (
        <span className="flex items-center gap-1">
          <span
            className={cn('inline-block h-4 w-6 rounded', CADRE_RATTRAPAGE, FOND_BROUILLON_RATTRAPAGE)}
          />
          choisi, pas encore enregistré
        </span>
      )}
    </span>
  );
}

/**
 * Les repères d'absence et de rattrapage d'une cellule (2026-09-14).
 *
 * ⚠️ POSÉS PAR-DESSUS, SANS RIEN CHANGER DE LA CELLULE : la valeur, sa couleur
 * et son bouton restent ceux du planning. Le cadre pointillé orange et la
 * pastille ↺ disent « des heures de rattrapage tombent ici » ; la pastille rouge
 * dit « une séance de ce module a manqué cette semaine ». `pointer-events-none` :
 * ils ne doivent jamais voler le clic de la cellule.
 *
 * ⚠️ LE BROUILLON (créneau choisi dans la modale, pas encore enregistré) prend
 * le même cadre, sur fond orange pâle : il n'existe pas encore.
 */
function MarqueCellule({ marque }) {
  if (!marque) return null;
  const rattrapage = marque.rattrapages > 0 || marque.brouillon;

  return (
    <>
      {rattrapage && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0.5 rounded-md',
            CADRE_RATTRAPAGE,
            marque.brouillon && FOND_BROUILLON_RATTRAPAGE
          )}
        />
      )}
      {rattrapage && (
        <span className={cn('pointer-events-none absolute right-0 top-0', PASTILLE_RATTRAPAGE)}>
          ↺<span className="sr-only"> Rattrapage</span>
        </span>
      )}
      {marque.absences > 0 && (
        <span
          className="pointer-events-none absolute left-0 top-0 rounded bg-destructive px-1 text-[0.55rem] font-semibold leading-4 text-white"
        >
          A<span className="sr-only">bsence</span>
        </span>
      )}
    </>
  );
}

/**
 * ═══ ⚠️ MÉMOÏSÉE ═══
 * Une grille compte 765 cellules, et la page se re-rend à chaque frappe. Sans
 * `memo`, les 765 se re-rendaient pour une seule case modifiée — mesuré au
 * profileur React : **564 ms par rendu** du bloc des sections, soit une demi-
 * seconde d'attente à chaque saisie.
 *
 * ⚠️ `memo` NE SERT À RIEN SANS DES PROPS STABLES. C'est pourquoi la cellule
 * reçoit SA valeur et non le planning entier, et des rappels tenus par `ref`
 * dans la grille : une seule prop qui change à chaque rendu suffit à tout
 * annuler.
 */
const Cellule = memo(CelluleBrute);

const jourCourt = (jour) =>
  new Date(`${jour}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });

const arrondir = (valeur) => Math.round(valeur * 100) / 100;
