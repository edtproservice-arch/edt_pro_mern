import { JOURS, SEANCES, TYPES_COURS } from '../../constants/index.js';
import { separerFusion } from '../carte/reconstruction.js';
import { typeDeSeance } from './conflits.js';
import { analyserSemaine, normaliserValeurSemaine } from '../planning/semaines.js';
import { dureeSeance } from './grille.js';

/**
 * Ce qu'une case affiche en plus de son contenu : semestre, EFM régional, taux
 * d'avancement du module, et la charge du sujet.
 * ← `updateModuleDisplay()` + `getCompletionLive()` de emploi.html
 *
 * ═══ POURQUOI CES REPÈRES SONT DANS LA CASE ═══
 * Poser une séance demande de savoir si le module est déjà couvert, s'il relève
 * du bon semestre et s'il porte un EFM régional. Aller le chercher ailleurs à
 * chaque case reviendrait à quitter la grille vingt fois par semaine — c'est
 * pour cela que l'existant les met sur la cellule, et il a raison.
 */

/** Seuils du badge d'avancement, repris de l'existant. */
export const AVANCEMENT_ELEVE = 100;
export const AVANCEMENT_MOYEN = 50;

/** Seuils du badge d'heures d'un formateur. ← les classes `badge-*`. */
export const HEURES_BADGE_HAUT = 30;
export const HEURES_BADGE_BAS = 20;

/**
 * Fiche d'un module pour un groupe : semestre, EFM, masses prévues.
 *
 * ═══ ⚠️ DEUX MASSES, PAS UNE ═══
 * La carte déclare séparément un présentiel et un synchrone — « S1 25 h · S2 0 h
 * · Synchrone 15 h ». Les additionner en un seul quota de 40 h, comme le faisait
 * cette fonction, laissait 42,5 h de cours EN SALLE s'afficher à 106 % alors
 * qu'elles dépassent de 70 % la masse présentielle qui leur est destinée — et
 * qu'aucune heure à distance n'avait été posée. Chaque type se mesure à SA
 * masse.
 *
 * `prevu` reste le total, pour ce qui regarde le module dans son ensemble.
 *
 * @returns {Map<string, {semestre, estRegional, presentiel, synchrone, prevu}>}
 *   clé « GROUPE||MODULE »
 */
export function fichesModules(affectations = []) {
  const fiches = new Map();

  for (const affectation of affectations) {
    const module = String(affectation.module ?? '').trim();
    if (module === '') continue;

    const heures =
      Number(affectation.s1Heures ?? 0) + Number(affectation.s2Heures ?? 0);
    /*
     * ⚠️ SANS `type`, ON COMPTE EN PRÉSENTIEL. Une affectation venue d'un import
     * ancien peut ne pas le porter ; la ranger en synchrone gonflerait un quota
     * que rien ne consomme et viderait celui qui sert.
     */
    const type =
      affectation.type === TYPES_COURS.SYNCHRONE ? TYPES_COURS.SYNCHRONE : TYPES_COURS.PRESENTIEL;

    /*
     * Une affectation FUSIONNÉE vaut pour chacun de ses groupes : la séance est
     * mutualisée, mais chaque groupe reçoit bien ces heures — c'est la même
     * règle que le bilan de charge.
     *
     * ⚠️ ET POUR LE LIBELLÉ FUSIONNÉ LUI-MÊME. Une séance à distance se pose
     * SUR ce libellé (« GM101 GM102 ») : sans cette clé, la case ne trouvait
     * aucune fiche et n'affichait donc NI semestre, NI ⭐, NI taux. C'est le
     * pendant exact de `heuresPosees`, et l'existant y arrivait par son
     * appariement `includes`.
     */
    const libelle = String(affectation.groupe ?? '').trim();
    const membres = separerFusion(libelle);

    for (const groupe of membres.length > 1 ? [...membres, libelle] : membres) {
      const cle = cleModule(groupe, module);
      const fiche =
        fiches.get(cle) ??
        {
          semestre: null,
          estRegional: false,
          [TYPES_COURS.PRESENTIEL]: 0,
          [TYPES_COURS.SYNCHRONE]: 0,
          prevu: 0,
          s1: 0,
          s2: 0,
        };

      fiche[type] += heures;
      fiche.prevu += heures;
      fiche.s1 += Number(affectation.s1Heures ?? 0);
      fiche.s2 += Number(affectation.s2Heures ?? 0);
      if (affectation.estRegional) fiche.estRegional = true;

      fiches.set(cle, fiche);
    }
  }

  // Le semestre se lit sur le CUMUL des deux types, comme les badges de la
  // carte : un module donné en présentiel au S1 et en synchrone au S2 est annuel.
  for (const fiche of fiches.values()) {
    fiche.semestre = fiche.s1 > 0 && fiche.s2 > 0 ? 'A' : fiche.s1 > 0 ? '1' : '2';
    fiche.prevu = arrondir(fiche.prevu);
    fiche[TYPES_COURS.PRESENTIEL] = arrondir(fiche[TYPES_COURS.PRESENTIEL]);
    fiche[TYPES_COURS.SYNCHRONE] = arrondir(fiche[TYPES_COURS.SYNCHRONE]);
    delete fiche.s1;
    delete fiche.s2;
  }

  return fiches;
}

export const cleModule = (groupe, module) =>
  `${String(groupe ?? '').trim().toUpperCase()}||${String(module ?? '').trim().toUpperCase()}`;

/**
 * Heures DÉJÀ POSÉES par module et par groupe, sur toute l'année.
 *
 * ⚠️ UNE SÉANCE ABSENTE NE COMPTE PAS. Le cours n'a pas eu lieu : l'inclure
 * ferait croire le module couvert alors qu'il reste à rattraper. C'est aussi ce
 * que fait l'existant, qui écarte `salle === 'ABSENT'`.
 *
 * ⚠️ Et la séance d'un libellé FUSIONNÉ compte pour CHACUN de ses groupes —
 * ils reçoivent bien ces heures.
 *
 * ⚠️ SÉPARÉES PAR TYPE, comme les masses prévues : une séance en TEAMS consomme
 * le quota SYNCHRONE, une séance en salle le quota présentiel. Les additionner
 * faisait passer un module dont le présentiel déborde pour un module à peine
 * terminé, parce que la masse à distance encore intacte absorbait l'écart.
 *
 * @returns {Map<string, {presentiel: number, synchrone: number}>}
 *   clé « GROUPE||MODULE »
 */
export function heuresPosees(seances = []) {
  const posees = new Map();

  for (const seance of seances) {
    if (seance.statut === 'absent') continue;
    /*
     * ⚠️ UNE SURVEILLANCE D'EFM N'EST PAS UN COURS. Le surveillant n'enseigne
     * pas, et le module n'avance pas pendant son propre examen : les compter
     * ferait grimper le taux au moment précis où le programme s'arrête.
     * L'existant, qui posait une séance ordinaire portant un drapeau dans son
     * blob, les comptait.
     */
    if (seance.estEfm) continue;

    const module = String(seance.module ?? '').trim();
    if (module === '') continue;

    const duree = dureeSeance(seance.seance);
    const type = typeDeSeance(seance);

    /*
     * ⚠️⚠️ UNE SÉANCE FUSIONNÉE COMPTE POUR CHACUN DE SES GROUPES **ET** POUR LE
     * LIBELLÉ FUSIONNÉ. C'est la règle de l'existant, où le posé s'appariait par
     * INCLUSION — `session.groupe.includes(groupe)` (emploi.html:6031) — alors
     * que le prévu s'apparie EXACTEMENT (`a.groupe === groupe`, :6021).
     *
     * L'asymétrie n'est pas un accident : une séance à distance sur
     * « GM101 GM102 » avance bien le module DE CHAQUE groupe, et son affectation
     * SYNCHRONE porte, elle, le libellé fusionné en entier. Ne compter que les
     * membres laissait cette affectation-là à zéro — d'où l'absence de taux sur
     * les séances Teams, signalée à l'usage.
     */
    const libelle = String(seance.groupe ?? '').trim();
    const membres = separerFusion(libelle);
    const cibles = membres.length > 1 ? [...membres, libelle] : membres;

    for (const groupe of cibles) {
      const cle = cleModule(groupe, module);
      const compte =
        posees.get(cle) ?? { [TYPES_COURS.PRESENTIEL]: 0, [TYPES_COURS.SYNCHRONE]: 0 };

      compte[type] = arrondir(compte[type] + duree);
      posees.set(cle, compte);
    }
  }

  return posees;
}

/**
 * L'ordre chronologique d'une séance : numéro de semaine, puis jour, puis
 * créneau. Partagé par `heuresPoseesParSeance` et `avancementParSeance` — deux
 * tris écrits séparément auraient fini par diverger d'un caractère, et le
 * cumul serait redevenu faux dans l'un des deux sans que rien ne le signale.
 */
const comparerChronologiquement = (a, b) => {
  if (a.numero !== b.numero) return a.numero - b.numero;
  const jourA = JOURS.indexOf(a.jour);
  const jourB = JOURS.indexOf(b.jour);
  if (jourA !== jourB) return jourA - jourB;
  return SEANCES.indexOf(a.creneau) - SEANCES.indexOf(b.creneau);
};

/** Cumule une liste de séances déjà triées chronologiquement. */
const cumulerChronologiquement = (lignes) => {
  let cumul = 0;
  return [...lignes].sort(comparerChronologiquement).map((ligne) => {
    cumul = arrondir(cumul + ligne.heures);
    return { ...ligne, cumul };
  });
};

/**
 * Heures posées par module et par groupe, SÉANCE PAR SÉANCE ET AVEC LEUR
 * CUMUL — le pendant de `heuresPosees`, déroulé dans le temps. C'est la
 * version « toutes les clés à la fois » d'`avancementParSeance`, exactement
 * comme `heuresPosees` l'est d'`avancementModule`.
 *
 * (2026-09-24, demande du porteur : « le taux dans les cellules pour chaque
 * semaine, pas le dernier taux » — précisé ensuite : « en S3 le taux est 14
 * mais en cellule s'affiche 20 », le cumul de fin de semaine restant faux pour
 * une séance qui n'est pas la dernière de sa semaine.) Le badge d'une case
 * lisait jusqu'ici `heuresPosees` — le TOTAL de l'année — si bien que la même
 * case affichait le même pourcentage qu'on soit en semaine 2 ou en semaine 30.
 * Chaque case peut désormais retrouver le cumul exact à SA PROPRE séance —
 * semaine, jour et créneau — plutôt qu'un taux de fin d'année ou de fin de
 * semaine, tous deux également identiques sur des cases qui n'en sont pas au
 * même point.
 *
 * ⚠️ MÊME RÈGLE DE COMPTAGE QUE `heuresPosees` — absence écartée, surveillance
 * EFM écartée, séance fusionnée comptée pour chacun de ses groupes ET pour le
 * libellé fusionné. Les deux décomptes doivent concorder : le dernier cumul de
 * chaque type redonne exactement les heures de `heuresPosees`.
 *
 * @returns {Map<string, {presentiel: Array<{semaine,numero,jour,creneau,heures,cumul}>, synchrone: [...]}>}
 *   clé « GROUPE||MODULE », chaque liste triée chronologiquement.
 */
export function heuresPoseesParSeance(seances = []) {
  const parCle = new Map();

  for (const seance of seances) {
    if (seance.statut === 'absent') continue;
    if (seance.estEfm) continue;

    const module = String(seance.module ?? '').trim();
    if (module === '') continue;

    const semaine = normaliserValeurSemaine(seance.semaine);
    if (!semaine) continue;

    const type = typeDeSeance(seance);
    const ligne = {
      semaine,
      numero: analyserSemaine(semaine)?.numero ?? 0,
      jour: seance.jour ?? null,
      creneau: seance.seance,
      heures: arrondir(dureeSeance(seance.seance)),
    };

    const libelle = String(seance.groupe ?? '').trim();
    const membres = separerFusion(libelle);
    const cibles = membres.length > 1 ? [...membres, libelle] : membres;

    for (const groupe of cibles) {
      const cle = cleModule(groupe, module);
      const entree = parCle.get(cle) ?? { [TYPES_COURS.PRESENTIEL]: [], [TYPES_COURS.SYNCHRONE]: [] };
      entree[type].push(ligne);
      parCle.set(cle, entree);
    }
  }

  const resultat = new Map();
  for (const [cle, parType] of parCle) {
    resultat.set(cle, {
      [TYPES_COURS.PRESENTIEL]: cumulerChronologiquement(parType[TYPES_COURS.PRESENTIEL]),
      [TYPES_COURS.SYNCHRONE]: cumulerChronologiquement(parType[TYPES_COURS.SYNCHRONE]),
    });
  }

  return resultat;
}

/**
 * Le même `{ taux, prevu, pose, niveau }` qu'`avancementModule`, à partir d'un
 * CUMUL DÉJÀ CONNU — celui qu'une case de la grille tient de sa propre séance
 * (`heuresPoseesParSeance`), plutôt que recalculé depuis `heuresPosees`.
 *
 * @returns {{taux, prevu, pose, niveau}|null} `null` sans masse prévue — même
 *   règle qu'`avancementModule` : un pourcentage sur zéro heure prévue ferait
 *   croire à un retard là où il n'y a rien à faire.
 */
export function avancementDepuisCumul(cumul, prevu) {
  if (!(prevu > 0)) return null;

  const pose = arrondir(cumul);
  const taux = Math.round((pose / prevu) * 100);

  return { taux, prevu: arrondir(prevu), pose, niveau: niveauAvancement(taux) };
}

/**
 * Le taux d'avancement d'un module pour un groupe, POUR UN TYPE DE SÉANCE.
 *
 * ⚠️ LE TYPE EST OBLIGATOIRE EN PRATIQUE : sans lui on compare le total posé au
 * total prévu, et un présentiel qui déborde se cache derrière une masse
 * synchrone intacte. Il est laissé optionnel pour la seule vue d'ensemble.
 *
 * @returns {{taux, prevu, pose, niveau}|null} `null` si rien n'est prévu pour ce
 *   type — un taux sur zéro heure prévue n'a aucun sens, et afficher « 0 % »
 *   ferait croire à un retard là où il n'y a rien à faire.
 */
export function avancementModule(fiches, posees, groupe, module, type) {
  const cle = cleModule(groupe, module);
  const fiche = fiches?.get(cle);
  if (!fiche) return null;

  const compte = posees?.get(cle);
  const prevu = type ? (fiche[type] ?? 0) : fiche.prevu;
  const pose = arrondir(
    type
      ? (compte?.[type] ?? 0)
      : (compte?.[TYPES_COURS.PRESENTIEL] ?? 0) + (compte?.[TYPES_COURS.SYNCHRONE] ?? 0)
  );

  if (prevu <= 0) return null;

  const taux = Math.round((pose / prevu) * 100);

  return { taux, prevu: arrondir(prevu), pose, niveau: niveauAvancement(taux) };
}

/**
 * Le palier d'un taux — UNE seule définition.
 *
 * ⚠️ Elle vivait en clair dans `avancementModule`, et la carte au survol allait
 * la recopier : deux jeux de seuils, et le même module aurait pu s'afficher vert
 * dans la case et orange dans sa fiche.
 */
export const niveauAvancement = (taux) =>
  taux >= AVANCEMENT_ELEVE ? 'haut' : taux >= AVANCEMENT_MOYEN ? 'moyen' : 'bas';

/**
 * L'avancement d'un module, SÉANCE PAR SÉANCE.
 * ← `getCompletionLive()` de emploi.html, déroulé dans le temps
 *
 * (2026-09-24, demande du porteur : « il faut qu'il calcule l'avancement selon
 * la séance, pas la semaine ».) La version précédente cumulait les heures
 * d'une même semaine en UNE seule ligne — « S3 : 10 h » masquait deux séances
 * distinctes, l'une posée et l'autre pas encore (un rattrapage déplacé, une
 * séance restée « à planifier »), sous un chiffre qui ne disait plus LAQUELLE
 * comptait. Chaque ligne est désormais UNE séance réellement posée, dans
 * l'ordre où elle a eu lieu.
 *
 * Le badge de la case dit OÙ EN EST le module ; ceci dit COMMENT il y est
 * arrivé — les séances qui ont réellement eu lieu, et le taux atteint après
 * chacune. C'est ce qu'on vient chercher avant de décider s'il faut lui rendre
 * des heures.
 *
 * ⚠️ MÊME RÈGLE D'APPARIEMENT QUE `heuresPosees`, et c'est essentiel : une
 * séance à distance est posée sur le libellé FUSIONNÉ (« GM101 GM102 ») et
 * avance le module de CHACUN de ses groupes. Réécrire un appariement plus
 * simple ici ferait diverger le total de la carte de celui du badge, à quelques
 * heures près — l'écart le plus difficile à expliquer.
 *
 * ⚠️ LE TRI SE FAIT SUR (NUMÉRO DE SEMAINE, JOUR, CRÉNEAU), jamais sur la
 * chaîne de la semaine : « 2026-W10 » précède « 2026-W2 » dans l'ordre
 * alphabétique, et l'histoire du module se lirait à l'envers.
 * `normaliserValeurSemaine` absorbe au passage le zéro de remplissage
 * (« 2026-W039 ») présent en base. `JOURS`/`SEANCES` donnent l'ordre de la
 * semaine — sans lui, deux séances de la même semaine se trieraient au hasard
 * de leur ordre d'arrivée en base, et le cumul pourrait momentanément reculer.
 *
 * @returns {{prevu, pose, taux, niveau, seances: Array<{semaine, numero, jour, creneau, heures, cumul, taux}>}}
 */
export function avancementParSeance(seances = [], groupe, module, prevu = 0, type = null) {
  const cle = cleModule(groupe, module);
  const parType = heuresPoseesParSeance(seances).get(cle) ?? {
    [TYPES_COURS.PRESENTIEL]: [],
    [TYPES_COURS.SYNCHRONE]: [],
  };

  /*
   * ⚠️ SANS TYPE : LES DEUX MASSES FUSIONNÉES, RE-CUMULÉES ENSEMBLE — cas
   * laissé pour la seule vue d'ensemble (même remarque qu'`avancementModule`).
   * Chaque liste porte déjà SON cumul (`heuresPoseesParSeance`) ; celui-ci ne
   * vaudrait plus rien une fois les deux listes mélangées, d'où le dépouillage
   * avant de recumuler l'ensemble, chronologiquement.
   */
  const seancesTypees = type
    ? parType[type]
    : cumulerChronologiquement(
        [...parType[TYPES_COURS.PRESENTIEL], ...parType[TYPES_COURS.SYNCHRONE]].map(
          ({ cumul, ...ligne }) => ligne
        )
      );

  const cumulFinal = seancesTypees.length ? seancesTypees.at(-1).cumul : 0;
  // ⚠️ `null` quand rien n'est prévu, comme `avancementModule` : un pourcentage
  // sur zéro heure prévue ferait croire à un retard là où il n'y a rien à faire.
  const taux = prevu > 0 ? Math.round((cumulFinal / prevu) * 100) : null;

  return {
    prevu: arrondir(prevu),
    pose: cumulFinal,
    taux,
    niveau: taux === null ? null : niveauAvancement(taux),
    seances: seancesTypees.map((ligne) => ({
      ...ligne,
      taux: prevu > 0 ? Math.round((ligne.cumul / prevu) * 100) : null,
    })),
  };
}

/**
 * Le badge d'heures d'un sujet.
 * ← les classes `badge-overload` / `badge-underload` / `badge-normal`.
 *
 * ⚠️ Le seuil BAS ne s'applique qu'au-delà de zéro : une semaine vide n'est pas
 * une sous-charge, c'est une semaine où la personne n'a rien — le signaler en
 * orange mettrait toute la grille en alerte au début de la saisie.
 */
export function niveauHeures(heures) {
  if (heures > HEURES_BADGE_HAUT) return 'surcharge';
  if (heures > 0 && heures < HEURES_BADGE_BAS) return 'sous-charge';
  return 'normal';
}

/** Le type d'une affectation, pour distinguer une séance à distance. */
export const estSynchrone = (affectation) => affectation?.type === TYPES_COURS.SYNCHRONE;

const arrondir = (valeur) => Math.round(valeur * 100) / 100;
