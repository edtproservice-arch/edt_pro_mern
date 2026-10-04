import { JOURS } from '../../constants/index.js';
import { prefixeDuNom } from '../carte/nomsGroupes.js';
import { anneeDuNomGroupe } from '../carte/reconstruction.js';
import { groupesDuSoir } from '../emploi/grille.js';
import { SEUIL_HEBDOMADAIRE } from './charge.js';
import { masseHebdomadaire } from './masses.js';
import { FIN_SEMESTRE_1, HEURES_PAR_JOUR, JOURS_PAR_SEMAINE, NOMBRE_SEMAINES, PAS } from './semaines.js';

/**
 * Génération automatique du chronogramme — les RÈGLES (2026-10-04, demande du
 * porteur).
 *
 * ═══ ⚠️ ELLES VIVENT ICI, PAS DANS `ai/` ═══
 * Le solveur Python répartit des heures sur des semaines numérotées ; il ne
 * sait ni ce qu'est un module régional, ni un semestre, ni un jour férié. Tout
 * ce qui suit est traduit par Node en nombres (priorité, cibles, plafonds)
 * avant de partir vers lui — c'est la frontière d'`ai/README.md`.
 *
 * Les quatre règles données par le porteur :
 *   A. ordre de priorité : régional avant normal, puis S1 → annuel → S2 ;
 *   B. charge hebdomadaire d'un formateur ≈ masse affectée / 35, jamais sous
 *      25 h ;
 *   C. sauf à 360 h affectées ou moins : masse / 35, sans plancher ;
 *   D. −5 h par jour perdu dans la semaine : férié, stage partiel, formation
 *      du formateur, rentrée des premières années.
 */

/**
 * A — l'ordre de priorité. Plus petit = planifié d'abord.
 *
 * ⚠️ LE RÉGIONAL PASSE AVANT TOUT : son EFM est passé à date fixe par toute la
 * région, et un module régional en retard ne se rattrape pas. Le semestre ne
 * départage qu'ensuite.
 */
export const PRIORITES_GENERATION = Object.freeze({
  REGIONAL_S1: 1,
  REGIONAL_ANNUEL: 2,
  REGIONAL_S2: 3,
  NORMAL_S1: 4,
  NORMAL_ANNUEL: 5,
  NORMAL_S2: 6,
});

/** B/C — au-delà de cette masse affectée, le plancher hebdomadaire s'applique. */
export const SEUIL_PETITE_MASSE = 360;

/** B — un formateur à plus de 360 h ne descend pas sous cette charge. */
export const PLANCHER_HEBDOMADAIRE = 25;

/**
 * D — ce qu'un jour perdu retire de la cible de la semaine.
 *
 * ⚠️ CE N'EST PAS UN CHIFFRE DE PLUS : 5 h × 6 jours = 30 h, le seuil au-delà
 * duquel le tableau de charge déclare une semaine en débordement. Le même
 * rapport sert donc de plafond « raisonnable » à un groupe : 5 h par jour
 * ouvert (voir `plafondSoupleGroupe`).
 */
export const HEURES_PAR_JOUR_CIBLE = SEUIL_HEBDOMADAIRE / JOURS_PAR_SEMAINE;

/**
 * La priorité d'un module, selon qu'il est régional et selon son semestre.
 *
 * @param {{estRegional?: boolean, semestre?: 'S1'|'S2'|'annuel'}} module —
 *   `semestre` tel que l'écran l'affiche (`modulesDuGroupe`)
 */
export function prioriteGeneration({ estRegional = false, semestre } = {}) {
  const P = PRIORITES_GENERATION;
  if (semestre === 'S1') return estRegional ? P.REGIONAL_S1 : P.NORMAL_S1;
  if (semestre === 'S2') return estRegional ? P.REGIONAL_S2 : P.NORMAL_S2;
  return estRegional ? P.REGIONAL_ANNUEL : P.NORMAL_ANNUEL;
}

/**
 * B/C — la charge hebdomadaire visée pour un formateur, en semaine pleine.
 *
 * ⚠️ « MASSE AFFECTÉE », PAS STATUTAIRE : ce que la carte lui a réellement
 * confié, synchrone mutualisé compté une seule fois. La masse statutaire
 * (~1 000 h) dit ce qu'il PEUT faire, pas ce qu'il a à faire.
 *
 * ⚠️ LE PLANCHER FAIT FINIR PLUS TÔT, il n'invente pas d'heures : un
 * formateur à 600 h tient 25 h par semaine et termine en 24 semaines au lieu de
 * 35. Le solveur ne pose jamais plus que la masse.
 */
export function cibleHebdomadaire(masseAffectee) {
  const masse = Number(masseAffectee) || 0;
  if (masse <= 0) return 0;
  const parSemaine = masseHebdomadaire(masse);
  return masse <= SEUIL_PETITE_MASSE ? parSemaine : Math.max(parSemaine, PLANCHER_HEBDOMADAIRE);
}

/**
 * D — combien de jours un formateur perd dans une semaine.
 *
 * @param {object} p
 * @param {number} [p.feries]     jours fériés de la semaine (pour tous)
 * @param {number} [p.formation]  jours où CE formateur est en formation
 * @param {number[]} [p.groupes]  pour chacun de ses groupes encore ouverts
 *   cette semaine, les jours qu'il y perd (stage partiel, rentrée à venir)
 *
 * ⚠️ FÉRIÉS + LE PLUS GRAND DES AUTRES, PAS LEUR SOMME. Stage, formation et
 * rentrée peuvent tomber les mêmes jours : les additionner retirerait deux
 * fois la même journée. C'est la règle de `semainesDeLaLigne`, qui ne sait
 * pas non plus si deux absences se recouvrent.
 *
 * ⚠️ UN GROUPE ENTIÈREMENT FERMÉ NE COMPTE PAS — c'est le sens de « stage
 * PARTIEL ». Ses modules ne reçoivent rien cette semaine, et le formateur
 * reporte ses heures sur ses autres groupes : réduire aussi sa cible lui
 * retirerait la semaine entière pour un seul groupe absent.
 */
export function joursPerdusFormateur({ feries = 0, formation = 0, groupes = [] } = {}) {
  const autres = Math.max(0, formation, ...groupes);
  return Math.min(JOURS_PAR_SEMAINE, Math.max(0, feries) + autres);
}

/**
 * Au-delà de cette masse affectée, 25 h restent le MINIMUM de chaque semaine,
 * fériés compris (2026-10-04, demande du porteur).
 */
export const SEUIL_PLANCHER_ABSOLU = 900;

/** À 900 h affectées ou moins, le minimum de chaque semaine (2026-10-04). */
export const PLANCHER_MASSE_MOYENNE = 10;

/**
 * À 360 h ou moins, une semaine dont un férié tombe sur un jour où le
 * formateur est disponible : un créneau, pour qu'elle ne reste pas vide.
 */
export const PLANCHER_MINIMAL = PAS;

/**
 * Le minimum hebdomadaire d'un formateur, que les réductions de la règle D ne
 * franchissent pas (2026-10-04, demandes du porteur) :
 *   · au-delà de 900 h affectées → 25 h ;
 *   · de 360 h (exclu) à 900 h   → 10 h ;
 *   · 360 h ou moins             → aucun.
 *
 * ⚠️ RETOUR DU PORTEUR : un formateur à 1 053 h descendait à 20 h les
 *    semaines à deux jours fériés. À ce volume, la semaine allégée ne se
 *    rattrape plus ailleurs.
 */
export function plancherHebdomadaire(masseAffectee, { ferieSurJourDisponible = false } = {}) {
  const masse = Number(masseAffectee) || 0;
  if (masse <= 0) return 0;
  if (masse > SEUIL_PLANCHER_ABSOLU) return PLANCHER_HEBDOMADAIRE;
  /*
   * ⚠️ À 360 h OU MOINS, LE FÉRIÉ PEUT FAIRE DESCENDRE SOUS 10 h — mais
   *    seulement s'il tombe un jour où le formateur est DISPONIBLE (2026-10-04,
   *    demande du porteur). Un vacataire présent le mardi ne perd rien d'un
   *    férié du jeudi : son minimum de 10 h reste dû.
   *
   *    Jamais zéro pour autant (« le formateur ne doit chômer en aucun cas ») :
   *    un créneau.
   */
  if (masse <= SEUIL_PETITE_MASSE && ferieSurJourDisponible) return PLANCHER_MINIMAL;
  return PLANCHER_MASSE_MOYENNE;
}

/**
 * Séances de JOURNÉE : un jour où elles sont toutes déclarées indisponibles
 * est un jour où le formateur ne vient pas. S5 (le soir) n'y entre pas.
 */
const SEANCES_DE_JOURNEE = ['S1', 'S2', 'S3', 'S4'];

/**
 * Les jours où un formateur est disponible, d'après ses indisponibilités
 * déclarées (`AutoGenConfig.contraintes[].indisponibilites`).
 *
 * ⚠️ SANS DÉCLARATION, TOUS LES JOURS : c'est la lecture prudente — un férié
 *    compte alors toujours, comme avant cette règle.
 *
 * @param {Array<{jour: string, seance: string}>} indisponibilites
 * @returns {Set<string>} « Lundi » … « Samedi »
 */
export function joursDisponibles(indisponibilites = []) {
  const pris = new Set((indisponibilites ?? []).map((c) => `${c?.jour}|${c?.seance}`));
  return new Set(JOURS.filter((jour) => !SEANCES_DE_JOURNEE.every((s) => pris.has(`${jour}|${s}`))));
}

/** Un de ces fériés tombe-t-il un jour où le formateur est disponible ? */
export function ferieSurJourDisponible(feries = [], disponibles = new Set(JOURS)) {
  return (feries ?? []).some((ferie) => {
    const date = new Date(`${String(ferie?.date ?? ferie).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(date.getTime())) return false;
    return disponibles.has(JOURS[(date.getDay() + 6) % 7]);
  });
}

/**
 * D — la cible d'une semaine précise, une fois les jours perdus retirés.
 *
 * @param {number} [plancher] — `plancherHebdomadaire` : la réduction ne
 *   descend pas en dessous. ⚠️ Borné par ce que les jours RESTANTS peuvent
 *   physiquement contenir (10 h par jour) : on ne vise pas 25 h dans une
 *   semaine où le formateur n'a plus qu'un jour.
 */
export function cibleDeLaSemaine(cible, joursPerdus = 0, plancher = 0) {
  const perdus = Math.max(0, joursPerdus);
  const reduite = (Number(cible) || 0) - HEURES_PAR_JOUR_CIBLE * perdus;
  const restants = Math.max(0, JOURS_PAR_SEMAINE - perdus);
  const minimum = Math.min(Number(plancher) || 0, restants * HEURES_PAR_JOUR);
  return Math.max(0, Math.round(Math.max(reduite, minimum) * 100) / 100);
}

/**
 * Ce qu'un module prend AU PLUS chaque semaine pour un même groupe.
 *
 * ═══ ⚠️ NE PAS CONDENSER UN MODULE (2026-10-04, demande du porteur) ═══
 * Servi seul, un module de 140 h prenait 20 h par semaine pendant sept
 * semaines, puis disparaissait. La règle : une JOURNÉE au plus (10 h) —
 * sauf si sa masse exige davantage pour tenir dans les semaines ouvertes de
 * son semestre, auquel cas il prend juste ce rythme, arrondi au pas.
 */
export const PLAFOND_MODULE_SEMAINE = HEURES_PAR_JOUR;

/**
 * @param {number} heures — la masse du module pour ce semestre
 * @param {number} semainesOuvertes — ses semaines ouvertes dans ce semestre
 */
export function plafondHebdomadaireModule(heures, semainesOuvertes) {
  const masse = Number(heures) || 0;
  if (!(semainesOuvertes > 0)) return PLAFOND_MODULE_SEMAINE;
  const rythme = Math.ceil(masse / semainesOuvertes / PAS - 1e-9) * PAS;
  return Math.max(PLAFOND_MODULE_SEMAINE, rythme);
}

/**
 * Les semaines d'un semestre.
 *
 * ⚠️ UN MODULE ANNUEL N'EST PAS UN LOT UNIQUE : ses heures du S1 se
 * planifient au S1, celles du S2 au S2 — la carte les distingue
 * (`s1Heures`, `s2Heures`), et le bilan semestriel en dépend.
 */
export function semainesDuSemestre(semestre) {
  const toutes = Array.from({ length: NOMBRE_SEMAINES }, (_, i) => i + 1);
  return semestre === 'S1'
    ? toutes.filter((numero) => numero <= FIN_SEMESTRE_1)
    : toutes.filter((numero) => numero > FIN_SEMESTRE_1);
}

/**
 * Ce qu'un groupe reçoit au plus, en temps normal, dans une semaine.
 *
 * ⚠️ UN PLAFOND SOUPLE : 5 h par jour ouvert, soit 30 h en semaine pleine — le
 * seuil de débordement du tableau de charge. Le solveur ne le franchit que
 * pour tenir une échéance de semestre, et jamais au-delà de ce que les jours
 * contiennent physiquement (`capaciteSemaine`).
 */
export function plafondSoupleGroupe(semaine) {
  if (!semaine?.disponible) return 0;
  const jours = Math.max(0, Math.min(JOURS_PAR_SEMAINE, semaine.joursDisponibles ?? 0));
  return jours * HEURES_PAR_JOUR_CIBLE;
}

/**
 * « En cas de besoin, la masse de 30 h par semaine pour les groupes peut être
 * dépassée, mais pas trop » (2026-10-04, demande du porteur) : 5 h de plus,
 * soit 35 h en semaine pleine — et jamais plus que ce que les jours ouverts
 * contiennent physiquement.
 */
export const DEPASSEMENT_GROUPE = 5;

export function plafondTolereGroupe(semaine, capacite = Infinity) {
  const souple = plafondSoupleGroupe(semaine);
  if (souple <= 0) return 0;
  return Math.min(capacite, souple + DEPASSEMENT_GROUPE);
}

/**
 * Où les heures d'un semestre PEUVENT tomber, et quand elles DEVRAIENT être
 * finies.
 *
 * ═══ ⚠️ LA CHARGE HEBDOMADAIRE PASSE AVANT LA FIN DU SEMESTRE ═══
 * (2026-10-04, retour du porteur sur la première génération.) Tenir la fin
 * du S1 coûte que coûte a donné des formateurs à 50 h par semaine tout le
 * semestre, et à 110 h la semaine d'avant. Le porteur tranche : la charge
 * prime. Les heures du S1 qui n'y tiennent pas DÉBORDENT donc sur le S2 —
 * servies avant tout le reste, et signalées au bilan.
 *
 * Les heures du S2, elles, ne remontent jamais au S1 : un module ne commence
 * pas avant son semestre.
 *
 * @returns {{semaines: number[], echeance: number|null}}
 */
export function fenetreDuSemestre(semestre) {
  if (semestre === 'S1') {
    return {
      semaines: Array.from({ length: NOMBRE_SEMAINES }, (_, i) => i + 1),
      echeance: FIN_SEMESTRE_1,
    };
  }
  return { semaines: semainesDuSemestre('S2'), echeance: null };
}

/**
 * Dernière semaine où la génération planifie un groupe (2026-10-04, demande
 * du porteur) :
 *   · 1ʳᵉ année → S42 ;
 *   · 2ᵉ année  → S41 ;
 *   · 3ᵉ année en cours du jour (CDJ) → S18.
 *
 * ⚠️ L'ANNÉE SE LIT SUR LE NOM (`anneeDuNomGroupe`), le cours du soir aussi
 *    (`groupesDuSoir` : le suffixe « (CDS) ») — les mêmes règles que le reste
 *    de l'application, pas une troisième lecture.
 *
 * ⚠️ LES AUTRES CAS N'ONT PAS DE BORNE (`null`) : une 3ᵉ année en cours du
 *    soir, une 4ᵉ année… le porteur n'en a pas donné. Elles gardent les 45
 *    semaines plutôt qu'une limite inventée.
 *
 * @returns {number|null}
 */
export const DERNIERES_SEMAINES = Object.freeze({ PREMIERE: 42, DEUXIEME: 41, TROISIEME_CDJ: 18 });

export function derniereSemaineDuGroupe(groupe) {
  const annee = anneeDuNomGroupe(groupe);
  if (annee === 1) return DERNIERES_SEMAINES.PREMIERE;
  if (annee === 2) return DERNIERES_SEMAINES.DEUXIEME;
  if (annee === 3 && groupesDuSoir([groupe]).length === 0) return DERNIERES_SEMAINES.TROISIEME_CDJ;
  return null;
}

/**
 * Les semaines d'un groupe, FERMÉES au-delà de sa dernière semaine.
 *
 * ⚠️ FERMÉES, PAS RETIRÉES : la grille garde ses 45 colonnes, et tout ce qui
 *    lit `disponible` (plafond de case, capacité du groupe, cible du
 *    formateur) voit la fin de formation sans rien changer d'autre.
 */
export function bornerALaFinDeFormation(semaines, derniere) {
  if (!Number.isInteger(derniere)) return semaines;
  return semaines.map((semaine) =>
    semaine.numero <= derniere
      ? semaine
      : { ...semaine, disponible: false, joursDisponibles: 0, motif: 'fin_formation' }
  );
}

/**
 * Ce que la génération laisse NON planifié sur un module régional
 * (2026-10-04, demande du porteur : « un écart d'une moyenne de −2,5 h pour
 * les modules régionaux »). La colonne « Écart » de la grille affiche donc
 * −2,5 h pour chacun d'eux, par groupe.
 */
export const RESERVE_REGIONALE = PAS;

/**
 * Les heures à planifier d'un lot S1 / S2, une fois la réserve retirée.
 *
 * ⚠️ LA RÉSERVE SE PREND SUR LE SEMESTRE LE PLUS TARDIF : c'est la fin du
 *    module qu'on laisse ouverte, pas son début — un module annuel la perd au
 *    S2, un module du S1 à la fin du S1.
 *
 * @returns {{s1: number, s2: number, retenu: number}}
 */
export function retirerReserve({ s1 = 0, s2 = 0 } = {}, reserve = 0) {
  let reste = Math.max(0, Number(reserve) || 0);
  const surS2 = Math.min(reste, Math.max(0, s2));
  reste -= surS2;
  const surS1 = Math.min(reste, Math.max(0, s1));
  return { s1: s1 - surS1, s2: s2 - surS2, retenu: surS1 + surS2 };
}

/**
 * ═══ LE MODULE « MÉTIER ET FORMATION » (2026-10-04, demande du porteur) ═══
 * Il se planifie en S1, au plus tard en S2 : c'est l'accueil du stagiaire dans
 * sa filière, il n'a de sens qu'au tout début.
 *
 * ⚠️ RECONNU PAR SON INTITULÉ, PAS PAR SON CODE. Dans la répartition DRIF, il
 *    s'appelle « Métier et formation », « … dans le secteur automobile », ou
 *    « Se situer au regard du métier et de la démarche de formation » — et
 *    son code est M101 le plus souvent, mais aussi M103, M201… Un code fixe
 *    en manquerait, et en prendrait d'autres.
 *
 * ⚠️ LES DEUX PREMIÈRES SEMAINES OÙ LE GROUPE A COURS, pas S1 et S2 dans
 *    l'absolu : c'est la même chose avec le calendrier ordinaire, mais un
 *    groupe dont la rentrée tomberait plus tard ne verrait pas son module
 *    déclaré impossible.
 */
export const SEMAINES_METIER_FORMATION = 2;

/** Servi avant tout le reste, régional compris : sa fenêtre est la plus courte. */
export const PRIORITE_METIER_FORMATION = 0;

const sansAccents = (texte) =>
  String(texte ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export function estModuleMetierFormation(intitule) {
  const texte = sansAccents(intitule);
  return /\bmetiers?\b/.test(texte) && /\bformation\b/.test(texte);
}

/**
 * Semaines d'arrêt tolérées entre les deux semestres d'un module ANNUEL :
 * AUCUNE (2026-10-04, demande du porteur — d'abord 2 semaines, puis « annuler
 * l'intervalle »). Ses heures du S1 s'étalent jusqu'à la dernière semaine du
 * S1, et celles du S2 enchaînent dès la première du S2.
 */
export const ECART_MAX_MODULE_ANNUEL = 0;

/**
 * Durée d'une séance synchrone : le synchrone se planifie par 5 h (2026-10-04,
 * demande du porteur : « les séances synchrones doivent être de 5 h »).
 */
export const SEANCE_SYNCHRONE = 5;

/**
 * Ce que le synchrone d'un module prend AU PLUS chaque semaine : UNE séance —
 * sauf si sa masse exige davantage pour tenir dans ses semaines ouvertes, et
 * alors un nombre entier de séances.
 */
export function plafondHebdomadaireSynchrone(heures, semainesOuvertes) {
  const masse = Number(heures) || 0;
  if (!(semainesOuvertes > 0)) return SEANCE_SYNCHRONE;
  const seances = Math.ceil(masse / semainesOuvertes / SEANCE_SYNCHRONE - 1e-9);
  return Math.max(1, seances) * SEANCE_SYNCHRONE;
}

/**
 * Les heures d'un module par semestre, ARRONDIES AU PAS sans changer leur
 * total (2026-10-04).
 *
 * ⚠️ LA CARTE PORTE DES DÉCOUPAGES COMME 11,11 h + 8,89 h. Planifié par pas de
 *    2,5 h, chaque semestre perdait sa fraction — 1,11 h et 1,39 h — et un
 *    synchrone de 20 h ressortait à 17,5 h, avec un écart de −2,5 h que rien
 *    n'expliquait à l'écran. On arrondit donc le S1 au pas le plus proche, et
 *    le S2 prend le reste du total.
 *
 * @returns {{s1: number, s2: number}}
 */
export function repartirSemestresAuPas(s1 = 0, s2 = 0) {
  const un = Math.max(0, Number(s1) || 0);
  const deux = Math.max(0, Number(s2) || 0);
  const total = Math.floor((un + deux) / PAS + 1e-9) * PAS;
  if (un === 0 || deux === 0) {
    return un === 0 ? { s1: 0, s2: total } : { s1: total, s2: 0 };
  }
  const premier = Math.min(total, Math.round(un / PAS) * PAS);
  return { s1: premier, s2: Math.round((total - premier) * 100) / 100 };
}

/**
 * ═══ LES LONGS MODULES : DES SÉANCES DE 5 h À 10 h (2026-10-04) ═══
 * « Pour les modules de 70 h et plus, il est préférable de planifier des
 * séances de 5 h à 10 h, sauf les modules qui commencent par EG. » Une
 * semaine où un tel module a cours, il a donc au moins 5 h — jamais 2,5 h
 * seules, sauf la dernière séance, qui solde sa masse. Le plafond de 10 h
 * existe déjà (`PLAFOND_MODULE_SEMAINE`).
 *
 * ⚠️ LA MASSE DU MODULE DANS LE GROUPE, présentiel et synchrone confondus —
 *    celle des colonnes MHP de la grille.
 * ⚠️ « EG » : les modules d'enseignement général (EGTS, EGQ, EGT…), courts
 *    par nature et étalés sur l'année.
 */
export const SEUIL_MODULE_LONG = 70;
export const POSE_MIN_MODULE_LONG = 5;

/** La pose minimale d'une semaine pour ce module, ou `null`. */
export function poseMinimaleModule(code, masseModule) {
  const estGeneral = String(code ?? '').trim().toUpperCase().startsWith('EG');
  return !estGeneral && (Number(masseModule) || 0) >= SEUIL_MODULE_LONG ? POSE_MIN_MODULE_LONG : null;
}

/**
 * ═══ LES GROUPES PIE : 5 h AU TOTAL PAR SEMAINE, À PARTIR DE S3 (2026-10-04) ═══
 * « 5 h au maximum TOTAL par semaine à partir de la semaine S3 » — précision
 * du porteur, après une première écriture qui limitait chaque MODULE à 5 h
 * et laissait le groupe à 10 h par semaine. La limite porte donc sur le
 * GROUPE, tous modules confondus, et rien n'est planifié avant S3.
 *
 * ⚠️ RECONNUS PAR LE PRÉFIXE DU NOM (« PIE101 (FQ) »), la règle de
 *    `prefixeDuNom` : c'est ainsi que la base les nomme.
 */
export const PLAFOND_HEBDOMADAIRE_PIE = 5;
export const PREMIERE_SEMAINE_PIE = 3;

export function estGroupePIE(groupe) {
  return prefixeDuNom(groupe) === 'PIE';
}

/**
 * Les semaines d'un groupe, FERMÉES avant sa première semaine de cours.
 * Fermées, pas retirées — comme `bornerALaFinDeFormation`.
 */
export function ouvrirAPartirDe(semaines, premiere) {
  if (!Number.isInteger(premiere)) return semaines;
  return semaines.map((semaine) =>
    semaine.numero >= premiere
      ? semaine
      : { ...semaine, disponible: false, joursDisponibles: 0, motif: 'debut_formation' }
  );
}
