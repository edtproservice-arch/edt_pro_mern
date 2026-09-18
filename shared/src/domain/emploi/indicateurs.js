import { TYPES_COURS } from '../../constants/index.js';
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
 * L'avancement d'un module, SEMAINE PAR SEMAINE.
 * ← `getCompletionLive()` de emploi.html, déroulé dans le temps
 *
 * Le badge de la case dit OÙ EN EST le module ; ceci dit COMMENT il y est
 * arrivé — les semaines où il a réellement tourné, celles où il s'est arrêté, et
 * le taux atteint après chacune. C'est ce qu'on vient chercher avant de décider
 * s'il faut lui rendre des heures.
 *
 * ⚠️ MÊME RÈGLE D'APPARIEMENT QUE `heuresPosees`, et c'est essentiel : une
 * séance à distance est posée sur le libellé FUSIONNÉ (« GM101 GM102 ») et
 * avance le module de CHACUN de ses groupes. Réécrire un appariement plus
 * simple ici ferait diverger le total de la carte de celui du badge, à quelques
 * heures près — l'écart le plus difficile à expliquer.
 *
 * ⚠️ LES SEMAINES SE TRIENT SUR LEUR NUMÉRO, jamais sur la chaîne : « 2026-W10 »
 * précède « 2026-W2 » dans l'ordre alphabétique, et l'histoire du module se
 * lirait à l'envers. `normaliserValeurSemaine` absorbe au passage le zéro de
 * remplissage (« 2026-W039 ») présent en base.
 *
 * @returns {{prevu, pose, taux, semaines: Array<{semaine, numero, heures, cumul, taux}>}}
 */
export function avancementParSemaine(seances = [], groupe, module, prevu = 0, type = null) {
  const cibleGroupe = normaliser(groupe);
  const cibleModule = normaliser(module);
  const parSemaine = new Map();

  for (const seance of seances) {
    if (seance.statut === 'absent') continue;
    // ⚠️ Même règle que `heuresPosees` : une surveillance d'EFM n'est pas un
    // cours. Les deux décomptes doivent dire la même chose, sinon le total de
    // la carte au survol s'écarterait du badge de la case.
    if (seance.estEfm) continue;
    if (normaliser(seance.module) !== cibleModule || cibleModule === '') continue;
    // ⚠️ Chaque type se compte à part : une séance TEAMS n'avance pas la masse
    // présentielle, et réciproquement.
    if (type && typeDeSeance(seance) !== type) continue;

    const libelle = String(seance.groupe ?? '').trim();
    const membres = separerFusion(libelle);
    const cibles = (membres.length > 1 ? [...membres, libelle] : membres).map(normaliser);
    if (!cibles.includes(cibleGroupe)) continue;

    const semaine = normaliserValeurSemaine(seance.semaine);
    if (!semaine) continue;

    parSemaine.set(semaine, (parSemaine.get(semaine) ?? 0) + dureeSeance(seance.seance));
  }

  const ordonnees = [...parSemaine.entries()]
    .map(([semaine, heures]) => ({
      semaine,
      numero: analyserSemaine(semaine)?.numero ?? 0,
      heures: arrondir(heures),
    }))
    .sort((a, b) => a.numero - b.numero);

  let cumul = 0;
  const semaines = ordonnees.map((entree) => {
    cumul = arrondir(cumul + entree.heures);
    return {
      ...entree,
      cumul,
      // ⚠️ `null` quand rien n'est prévu, comme `avancementModule` : un
      // pourcentage sur zéro heure prévue ferait croire à un retard là où il n'y
      // a rien à faire.
      taux: prevu > 0 ? Math.round((cumul / prevu) * 100) : null,
    };
  });

  const taux = prevu > 0 ? Math.round((cumul / prevu) * 100) : null;

  return {
    prevu: arrondir(prevu),
    pose: cumul,
    taux,
    niveau: taux === null ? null : niveauAvancement(taux),
    semaines,
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

const normaliser = (valeur) => String(valeur ?? '').trim().toUpperCase();
