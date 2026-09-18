import { anneeDuNomGroupe } from '../carte/reconstruction.js';
import { lundiPremiereSemaine } from '../planning/anneeScolaire.js';
import {
  formationDuFormateur,
  jourFerie,
  stageDuGroupe,
  vacances,
} from '../planning/calendrier.js';
import { dateRentree, joursAvantRentree } from '../planning/rentree.js';

/**
 * Les semaines d'un chronogramme, et ce qu'on peut y poser.
 * ← includes/chrono_modules.php + la construction de la grille dans
 *   profil-principal.js:3183
 *
 * ═══ POURQUOI LE SERVEUR LES CALCULE, ALORS QUE L'EXISTANT LES RECEVAIT ═══
 * `generate_chronogramme.php:56-63` documente le choix inverse : les semaines
 * étaient assemblées par le NAVIGATEUR — calendrier de l'établissement plus API
 * des fêtes religieuses — et envoyées au serveur, parce que « les recalculer ici
 * ferait vivre la même règle en deux endroits ».
 *
 * L'argument était juste en PHP. Il tombe ici : cette règle vit dans
 * `shared/src/domain/planning`, importée telle quelle par le serveur ET par le
 * navigateur. Il n'y a donc plus deux exemplaires à faire diverger — et le
 * serveur cesse de faire confiance au client sur ce qui BORNE la saisie.
 */

/** 45 semaines, comme `CHRONO_RATT_NB_SEMAINES` et la grille d'origine. */
export const NOMBRE_SEMAINES = 45;

/** Une semaine ordinaire compte 6 jours ouvrés — lundi au samedi. */
export const JOURS_PAR_SEMAINE = 6;

/** Pas de saisie d'une cellule, en heures. ← `CHRONO_RATT_PAS`. */
export const PAS = 2.5;

/** Plafond absolu d'une cellule. ← `CHRONO_RATT_MAX_CELLULE`. */
export const PLAFOND_CELLULE = 20;

/**
 * Ce qu'une JOURNÉE peut contenir, en heures.
 *
 * ⚠️ CE N'EST PAS UN RÉGLAGE, C'EST LA GRILLE : une journée porte quatre
 * créneaux — S1 à S4 — de 2,5 h chacun. Un module ne peut donc pas prendre plus
 * de 10 h dans une semaine où il ne reste qu'un jour ouvert, quel que soit son
 * plafond de cellule.
 */
export const HEURES_PAR_JOUR = 10;

/**
 * Dernière semaine du premier semestre — le second s'ouvre en S18.
 * ← `finS1 = 17` de `generate_chronogramme.php`
 *
 * ⚠️ RÈGLE MÉTIER, PAS RÉGLAGE D'AFFICHAGE. Elle borne les boutons « Semestre 1
 * / 2 », le filet rouge de la grille et celui de la bande de navigation. Écrite
 * dans chacun, elle aurait dérivé au premier ajustement — et le trait serait
 * tombé deux colonnes à côté du saut réel.
 */
export const FIN_SEMESTRE_1 = 17;

const enTexte = (date) => {
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
};

/**
 * Décrit les 45 semaines de l'année scolaire pour un groupe donné.
 *
 * @returns {Array<{numero, debut, fin, disponible, joursDisponibles, motif}>}
 *   `motif` vaut `'vacances'`, `'rentree'`, `'stage'` ou `null` — c'est ce que
 *   l'écran affiche pour expliquer une colonne verrouillée. Une semaine
 *   seulement amputée de jours fériés reste DISPONIBLE : elle se saisit, avec un
 *   plafond réduit.
 */
export function semainesChronogramme(
  annee,
  {
    joursFeries = [],
    vacances: periodes = [],
    stages = [],
    groupe = '',
    rentrees = [],
  } = {}
) {
  if (!Number.isInteger(annee)) {
    throw new TypeError('semainesChronogramme attend une année entière');
  }

  const lundi = lundiPremiereSemaine(annee);
  const semaines = [];

  for (let numero = 1; numero <= NOMBRE_SEMAINES; numero += 1) {
    const debut = new Date(lundi);
    debut.setDate(debut.getDate() + (numero - 1) * 7);

    const jours = joursDeLaSemaine(enTexte(debut));

    const fin = new Date(debut);
    fin.setDate(fin.getDate() + 6);

    /*
     * ⚠️ LES VACANCES VERROUILLENT DÈS UN SEUL JOUR : elles ferment
     * l'ÉTABLISSEMENT, et l'existant marquait la colonne « is-holiday-col » de
     * la même façon. On ne planifie pas une demi-semaine de cours pendant les
     * vacances scolaires.
     */
    const enVacances = jours.some((jour) => vacances(jour, periodes) !== null);

    /*
     * ═══ ⚠️ LE STAGE, LUI, SE COMPTE EN JOURS ═══
     * (2026-08-26, demande du porteur — REVIENT sur le verrouillage d'origine.)
     * Depuis que la période se saisit en PLAGE LIBRE, un stage peut ne couvrir
     * que trois jours d'une semaine : fermer la colonne entière interdisait de
     * planifier les trois autres, qui sont bel et bien ouverts.
     *
     * La semaine ne se verrouille donc plus que lorsqu'il ne reste AUCUN jour ;
     * sinon elle reste saisissable, avec un plafond réduit à ce que les jours
     * restants peuvent contenir.
     */
    const joursStage = jours.filter(
      (jour) => stageDuGroupe(groupe, jour, stages) !== null
    ).length;

    /*
     * ═══ ⚠️ LA RENTRÉE SE COMPTE EN JOURS, COMME LE STAGE ═══
     * (2026-09-02, demande du porteur.) La semaine de la rentrée est presque
     * toujours à cheval : en 2026-2027 les 1ʳᵉ années reprennent le VENDREDI
     * 11 septembre. Fermer la colonne entière interdirait de planifier ce
     * vendredi et le samedi, qui sont bel et bien ouverts.
     *
     * ⚠️ ELLE SE LIT SUR LE GROUPE, PAS SUR L'ÉTABLISSEMENT : les 2ᵉ années
     * rentrent le 7, les 1ʳᵉ le 11 — c'est `anneeDuNomGroupe` qui tranche. Sans
     * groupe, on ne gèle rien : le tableau du mode formateur porte plusieurs
     * années de formation à la fois, et sa colonne commune ne peut donc pas
     * l'être (le gel y descend ligne par ligne, comme le stage).
     */
    const joursRentree =
      groupe === '' ? 0 : joursAvantRentree(jours, anneeDuNomGroupe(groupe), rentrees);

    /*
     * Les fériés, eux, ne verrouillent pas : ils RÉDUISENT la capacité. On les
     * REMONTE, et pas seulement leur nombre : l'en-tête de colonne les nomme au
     * survol, et distingue une date fixe d'une estimation lunaire — un décalage
     * de dernière minute change la semaine où l'on peut planifier.
     */
    const feries = jours
      .map((jour) => jourFerie(jour, joursFeries))
      .filter((ferie) => ferie !== null);

    /*
     * ⚠️ RENTRÉE ET STAGE : ON PREND LE PLUS GRAND, PAS LEUR SOMME. Les deux
     * disent la même chose — le groupe n'est pas là — et ils se recouvrent
     * entièrement quand un stage tombe avant la rentrée. Les additionner
     * fermerait une semaine qui ne l'est pas. C'est déjà la règle que
     * `semainesDeLaLigne` applique au couple stage / formation.
     */
    const absents = Math.max(joursStage, joursRentree);

    const restants = enVacances
      ? 0
      : Math.max(0, JOURS_PAR_SEMAINE - feries.length - absents);

    semaines.push({
      numero,
      debut: enTexte(debut),
      fin: enTexte(fin),
      disponible: restants > 0,
      joursDisponibles: restants,
      /*
       * ⚠️ `motif` NE VAUT QUE POUR UNE SEMAINE FERMÉE : c'est lui qui grise la
       * case et explique pourquoi elle refuse la saisie. Une semaine seulement
       * AMPUTÉE reste ouverte — elle porte `joursStage`, qui la teinte plus
       * légèrement et nourrit la carte au survol.
       */
      /*
       * ⚠️ L'ORDRE DES MOTIFS SUIT LES PORTÉES : ce qui ferme l'ÉTABLISSEMENT
       * (vacances) l'emporte, puis ce qui vaut pour une ANNÉE DE FORMATION
       * (rentrée), puis ce qui ne vaut que pour CE groupe (stage). Un groupe qui
       * n'a pas encore fait sa rentrée n'est pas « en stage » : il n'existe pas
       * encore, et l'envoyer corriger ses dates de stage serait une fausse
       * piste.
       */
      motif: enVacances
        ? 'vacances'
        : restants > 0
          ? null
          : joursRentree > 0
            ? 'rentree'
            : joursStage > 0
              ? 'stage'
              : null,
      joursStage,
      joursRentree,
      /* La date attendue, pour que l'écran puisse dire « Rentrée le … ». */
      rentree: joursRentree > 0 ? dateRentree(anneeDuNomGroupe(groupe), rentrees) : null,
      feries,
    });
  }

  return semaines;
}

/**
 * Semaines où CE formateur est en formation — il n'enseigne pas.
 * ← la 4ᵉ cause de `disponibilite()` : férié, vacances, stage, **formation**.
 *
 * ═══ POURQUOI CE N'EST PAS UN ARGUMENT DE `semainesChronogramme` ═══
 * Les vacances valent pour l'établissement, le stage pour un groupe : les deux
 * qualifient une COLONNE. La formation, elle, qualifie une PERSONNE — donc des
 * LIGNES, et pas les mêmes selon le module. Mêlée aux autres, elle aurait
 * verrouillé la colonne entière d'un groupe parce qu'un seul de ses formateurs
 * était absent, et les autres modules seraient devenus insaisissables sans
 * raison visible.
 *
 * ⚠️ ELLE REND LE NOMBRE DE JOURS, plus la seule liste des semaines touchées
 * (2026-08-26). Une formation se saisit en PLAGE LIBRE : elle peut ne couvrir
 * que deux jours d'une semaine, et fermer la ligne entière interdirait de
 * planifier les quatre autres, qui sont bel et bien ouverts.
 *
 * @returns {Array<{numero: number, jours: number}>} semaines touchées, triées
 */
export function semainesEnFormation(semaines, formateur, formations = []) {
  if (!formateur || formations.length === 0) return [];

  return semaines
    .map((semaine) => ({
      numero: semaine.numero,
      jours: joursDeLaSemaine(semaine.debut).filter(
        (jour) => formationDuFormateur(formateur, jour, formations) !== null
      ).length,
    }))
    .filter((semaine) => semaine.jours > 0);
}

/**
 * Applique à une ligne ce qui ne vaut QUE pour elle.
 *
 * Les deux vues du chronogramme s'en servent, et c'est voulu : le mode groupe
 * verrouille la ligne d'un module dont les formateurs sont en formation, le
 * mode formateur verrouille celles des groupes en stage. Écrire la règle deux
 * fois, c'était la faire diverger au premier changement — le §4.2 du plan ne
 * relève rien d'autre.
 *
 * ⚠️ L'ORDRE DES MOTIFS EST CELUI DE LA PORTÉE : ce qui ferme l'établissement
 * l'emporte sur ce qui vaut pour une année de formation (la rentrée), qui
 * l'emporte sur ce qui ferme un groupe (le stage), qui l'emporte sur ce qui
 * retient une personne. Un motif déjà posé n'est jamais remplacé — dire
 * « formation » d'une semaine de vacances enverrait corriger le dossier du
 * formateur pour une colonne que le calendrier ferme de toute façon.
 *
 * ⚠️ LA RENTRÉE N'ARRIVE ICI QUE PAR LE MODE FORMATEUR. En mode groupe elle est
 * déjà portée par `semainesChronogramme`, qui connaît le groupe donc son année
 * de formation ; en mode formateur la grille mêle plusieurs années, et sa
 * colonne commune ne peut donc pas être gelée — c'est exactement la situation du
 * stage, dans l'autre sens.
 */
export function semainesDeLaLigne(
  semaines,
  { stage = [], formation = [], rentree = [], rentreeLe = null } = {}
) {
  if (stage.length === 0 && formation.length === 0 && rentree.length === 0) return semaines;

  const joursStage = indexerJours(stage);
  const joursFormation = indexerJours(formation);
  const joursRentree = indexerJours(rentree);

  return semaines.map((semaine) => {
    if (semaine.motif) return semaine;

    const stageJours = joursStage.get(semaine.numero) ?? 0;
    const formationJours = joursFormation.get(semaine.numero) ?? 0;
    const rentreeJours = joursRentree.get(semaine.numero) ?? 0;
    if (stageJours === 0 && formationJours === 0 && rentreeJours === 0) return semaine;

    /*
     * ⚠️ ON RETIRE DES JOURS, ON NE FERME PLUS LA LIGNE (2026-08-26, demande du
     * porteur). Un stage ou une formation de trois jours laisse trois jours
     * ouverts : les rendre insaisissables interdisait de planifier ce qui a
     * réellement lieu.
     *
     * ⚠️ ON PREND LE PLUS GRAND DES DEUX, PAS LEUR SOMME : stage et formation
     * peuvent se chevaucher sur les mêmes jours, et les additionner fermerait
     * une semaine qui ne l'est pas. Sans les dates exactes de chaque côté, le
     * maximum est la seule borne qu'on puisse affirmer.
     */
    const perdus = Math.max(stageJours, formationJours, rentreeJours);
    const restants = Math.max(0, (semaine.joursDisponibles ?? 0) - perdus);

    return {
      ...semaine,
      disponible: restants > 0,
      joursDisponibles: restants,
      /*
       * Le motif ne se pose que sur une semaine RÉELLEMENT fermée, et suit
       * l'ordre des portées : année de formation (rentrée) → groupe (stage) →
       * personne (formation).
       */
      motif:
        restants > 0
          ? null
          : rentreeJours > 0
            ? 'rentree'
            : stageJours >= formationJours
              ? 'stage'
              : 'formation',
      joursStage: (semaine.joursStage ?? 0) + stageJours,
      joursFormation: formationJours,
      joursRentree: rentreeJours,
      rentree: rentreeJours > 0 ? rentreeLe : null,
    };
  });
}

/** `[{numero, jours}]` → `Map<numero, jours>`. */
function indexerJours(entrees) {
  return new Map(
    (entrees ?? []).map((entree) =>
      typeof entree === 'number'
        ? // ⚠️ Ancienne forme — un simple numéro — traitée comme une semaine
          // ENTIÈRE : c'est le seul repli sûr, il ferme plutôt qu'il n'ouvre.
          [entree, JOURS_PAR_SEMAINE]
        : [entree.numero, entree.jours ?? JOURS_PAR_SEMAINE]
    )
  );
}

/** Les 6 jours ouvrés d'une semaine, à partir de son lundi. */
function joursDeLaSemaine(debut) {
  const lundi = new Date(`${debut}T12:00:00`);

  return Array.from({ length: JOURS_PAR_SEMAINE }, (_, decalage) => {
    const jour = new Date(lundi);
    jour.setDate(jour.getDate() + decalage);
    return enTexte(jour);
  });
}

/**
 * Plafond d'une cellule pour une semaine donnée.
 *
 * ⚠️ Une semaine amputée de jours fériés reste saisissable mais ne peut pas
 * absorber une semaine pleine : le plafond y est réduit d'autant. Sans cela, le
 * chronogramme promettrait des heures que le calendrier ne peut pas tenir, et
 * l'écart apparaîtrait plus tard comme un retard du formateur.
 */
export function plafondSemaine(semaine) {
  if (!semaine?.disponible) return 0;

  const jours = Math.max(0, Math.min(JOURS_PAR_SEMAINE, semaine.joursDisponibles ?? 0));

  /*
   * ═══ ⚠️ LE PLAFOND EST LE PLUS PETIT DES DEUX ═══
   * (2026-08-26, règle donnée par le porteur.) Ce qu'une cellule peut porter au
   * plus (20 h), et ce que les jours restants peuvent PHYSIQUEMENT contenir —
   * 10 h par jour, soit quatre créneaux de 2,5 h.
   *
   * Un groupe qui part 5 jours en stage ne laisse qu'une journée : son module
   * ne peut pas y prendre plus de 10 h. Deux jours suffisent en revanche à
   * atteindre le plafond de la cellule.
   *
   * ⚠️ CE N'EST PLUS UNE PROPORTION. L'ancienne formule répartissait les 20 h
   * sur les 6 jours (20 × jours / 6) : une semaine amputée d'UN férié tombait à
   * 15 h alors que ses cinq jours restants peuvent en contenir cinquante. Elle
   * refusait des saisies parfaitement tenables.
   */
  const capacite = Math.min(PLAFOND_CELLULE, jours * HEURES_PAR_JOUR);

  // Arrondi au pas INFÉRIEUR : un plafond qui ne tombe pas sur le pas de saisie
  // serait inatteignable, et la dernière valeur possible paraîtrait refusée.
  return Math.floor(capacite / PAS) * PAS;
}
