import { TYPES, poserCellule, verifierCellule } from './planning.js';
import { separerFusion } from '../carte/reconstruction.js';

/**
 * Le synchrone MUTUALISÉ, en mode formateur.
 * ← signalé par le porteur le 2026-08-26 sur ZINEB EL OMARI (SMP201 + SMP202).
 *
 * ═══ ⚠️ UNE SÉANCE SYNCHRONE FUSIONNÉE N'EST DONNÉE QU'UNE FOIS ═══
 * La vue par formateur ÉCLATE une affectation fusionnée en une ligne par groupe
 * — il le faut : chaque groupe a son propre planning, ses propres stages. Mais
 * les heures, elles, ne se dédoublent pas : le formateur diffuse UNE séance à
 * SMP201 et SMP202 en même temps. Les additionner double sa masse annuelle, sa
 * colonne « MHP S », son « Posé S » et son total hebdomadaire — c'est
 * exactement ce que montrait la capture : 160 h de synchrone là où il n'y en a
 * que la moitié.
 *
 * C'est la règle DÉJÀ tenue ailleurs dans le projet — `bilanCharge` de la carte
 * (« le synchrone est mutualisé »), `chargesHebdomadaires` du bouton « Charge »,
 * et la feuille formateurs du classeur, qui fait un `MAX` par ensemble. Elle
 * manquait ici, et nulle part ailleurs.
 *
 * ⚠️ EN MODE GROUPE, RIEN NE CHANGE : le groupe REÇOIT bien ces heures, et il
 * n'a qu'une ligne par module. Le dédoublonnage ne mord que là où une même
 * séance apparaît plusieurs fois.
 */

/**
 * La clé d'une LIGNE de grille.
 *
 * ⚠️ `groupe||module` EN MODE FORMATEUR, le seul code en mode groupe : le même
 * module revient pour plusieurs groupes avec deux plannings distincts, et
 * indexer sur le seul code les confondrait.
 */
export const cleLigne = (module) => module?.cle ?? module?.code;

/**
 * La clé de l'ENSEMBLE synchrone d'une ligne : une séance, un identifiant.
 *
 * ⚠️ `fusionSynchrone` VIDE NE VEUT PAS DIRE « inconnu » mais « fusionné avec
 * personne » — on retombe alors sur le groupe, qui EST l'identité de cette
 * séance. C'est la règle déjà écrite pour `empreinteSeance` du bilan de charge.
 */
export function cleSynchrone(module) {
  const ensemble =
    String(module?.fusionSynchrone ?? '').trim() || String(module?.groupe ?? '').trim();
  return `${ensemble}||${String(module?.code ?? '').trim()}`;
}

/**
 * Les AUTRES lignes qui portent la même séance synchrone.
 *
 * ⚠️ SEULEMENT SI LA LIGNE EN A UNE. Un module sans masse synchrone n'a pas de
 * jumelle : deux groupes peuvent partager un code de module en présentiel sans
 * rien mutualiser du tout — ce sont deux cours distincts, dans deux salles.
 */
export function lignesJumelles(modules = [], module) {
  if (!module || Number(module?.masses?.synchrone ?? 0) <= 0) return [];

  const cle = cleSynchrone(module);
  const soi = cleLigne(module);

  return modules.filter(
    (autre) =>
      cleLigne(autre) !== soi &&
      Number(autre?.masses?.synchrone ?? 0) > 0 &&
      cleSynchrone(autre) === cle
  );
}

/**
 * Les groupes JUMEAUX d'un module — EN MODE GROUPE.
 * ← signalé par le porteur le 2026-09-03 : « lorsque je sélectionne une séance
 * synchrone il ne sélectionne pas automatiquement en autre groupe en fusion
 * groupe ». La règle existait déjà, mais SEULEMENT en mode formateur — le
 * porteur travaille en mode groupe, où chaque groupe est une grille séparée.
 *
 * ⚠️ CETTE FONCTION NE SUFFIT PAS SEULE : en mode groupe, il n'existe pas de
 * `modules` PARTAGÉ entre deux grilles — chacune ne connaît que SES propres
 * lignes. `lignesJumelles` (mode formateur) reste donc inutilisable ici ; on
 * ne peut que NOMMER les groupes jumeaux, à charge de l'appelant (la page) de
 * vérifier si l'un d'eux est CHARGÉ à l'écran avant d'y écrire quoi que ce
 * soit — exactement la même retenue que `lignesJumelles` applique déjà.
 *
 * @param {{fusionSynchrone?: string, masses?: {synchrone?: number}}} module
 * @param {string} groupeCourant — le groupe dont on vient de saisir la case
 * @returns {string[]} les AUTRES groupes de la fusion, jamais celui-ci
 */
export function groupesJumeaux(module, groupeCourant) {
  if (!module || Number(module?.masses?.synchrone ?? 0) <= 0) return [];

  const fusion = String(module?.fusionSynchrone ?? '').trim();
  if (fusion === '') return [];

  return separerFusion(fusion).filter((groupe) => groupe !== groupeCourant);
}

/**
 * Somme des heures d'une liste de lignes, le synchrone compté UNE FOIS par
 * ensemble.
 *
 * ⚠️ `MAX` ET NON « le premier trouvé » : si les lignes d'un même ensemble
 * portaient des durées différentes — état incohérent que rien n'empêche — un
 * représentant choisi d'avance pourrait tomber sur une ligne vide, là où `MAX`
 * rend la séance telle qu'elle a été déclarée quelque part. C'est déjà le choix
 * de la feuille formateurs du classeur.
 */
function cumuler(modules, valeurDe) {
  let presentiel = 0;
  const synchrones = new Map();

  for (const module of modules ?? []) {
    const { presentiel: p = 0, synchrone: s = 0 } = valeurDe(module) ?? {};
    presentiel += Number(p) || 0;

    const heures = Number(s) || 0;
    if (heures <= 0) continue;

    const cle = cleSynchrone(module);
    synchrones.set(cle, Math.max(synchrones.get(cle) ?? 0, heures));
  }

  const synchrone = [...synchrones.values()].reduce((somme, valeur) => somme + valeur, 0);
  return { presentiel: arrondir(presentiel), synchrone: arrondir(synchrone) };
}

/** Les masses DÉCLARÉES — colonnes « MHP » et « MHP S » du pied de grille. */
export function massesCumulees(modules = []) {
  return cumuler(modules, (module) => module?.masses);
}

/** Les heures POSÉES — colonnes « Posé » et « Posé S ». */
export function posesCumulees(modules = [], planning = {}, totauxModule) {
  return cumuler(modules, (module) => totauxModule(planning, cleLigne(module)));
}

/**
 * Total d'une COLONNE de semaine, synchrone mutualisé compté une fois.
 *
 * ⚠️ IL FAUT LES MODULES, pas seulement le planning : rien dans une cellule ne
 * dit à quelle séance elle appartient. `totalSemaine` de `planning.js` reste
 * juste en mode groupe, où chaque ligne est une séance distincte.
 */
export function totalSemaineFusionnee(planning = {}, numero, modules = []) {
  let presentiel = 0;
  const synchrones = new Map();

  for (const module of modules) {
    const cellule = planning?.[cleLigne(module)]?.[numero];
    const heures = Number(cellule?.heures) || 0;
    if (heures <= 0) continue;

    if (cellule?.type === TYPES.SYNCHRONE) {
      const cle = cleSynchrone(module);
      synchrones.set(cle, Math.max(synchrones.get(cle) ?? 0, heures));
    } else {
      presentiel += heures;
    }
  }

  return arrondir(
    presentiel + [...synchrones.values()].reduce((somme, valeur) => somme + valeur, 0)
  );
}

const arrondir = (valeur) => Math.round(valeur * 100) / 100;

/**
 * Pose une valeur, et la REPORTE sur les groupes qui partagent la séance.
 * ← demande du porteur, 2026-08-26.
 *
 * ═══ ⚠️ UNE SÉANCE MUTUALISÉE SE POSE SUR TOUS SES GROUPES ═══
 * La poser sur SMP201 sans SMP202 laisserait croire que le second groupe n'a
 * pas eu ce cours : son chronogramme resterait incomplet à jamais, et son écart
 * ne tomberait jamais à zéro.
 *
 * ═══ ⚠️ SAUF SUR UNE SEMAINE FERMÉE POUR LA JUMELLE ═══
 * Un stage ne ferme qu'UN groupe. Si SMP202 est en entreprise cette semaine-là,
 * il ne reçoit pas la séance — lui inscrire des heures affirmerait un cours qui
 * n'a pas eu lieu pour lui. Chaque ligne porte ses propres semaines, et chaque
 * report repasse par `verifierCellule`, comme une saisie à la main.
 *
 * ⚠️ LE PRÉSENTIEL NE SE REPORTE JAMAIS : deux groupes en salle, ce sont deux
 * cours distincts, donnés à deux moments.
 *
 * @returns {{planning: object, reportees: number}}
 */
export function poserAvecJumelles({
  planning,
  modules = [],
  module,
  semaine,
  heures,
  type,
  semainesParDefaut = [],
}) {
  const cle = cleLigne(module);
  let suivant = poserCellule(planning, cle, semaine.numero, heures, type);

  if (type !== TYPES.SYNCHRONE) return { planning: suivant, reportees: 0 };

  let reportees = 0;
  for (const jumelle of lignesJumelles(modules, module)) {
    const semaineJumelle = (jumelle.semaines ?? semainesParDefaut).find(
      (candidate) => candidate.numero === semaine.numero
    );
    if (!semaineJumelle?.disponible) continue;

    const cleJumelle = cleLigne(jumelle);
    const verdict = verifierCellule({
      planning: suivant,
      module: cleJumelle,
      semaine: semaineJumelle,
      heures,
      type,
      masses: jumelle.masses,
    });
    if (!verdict.possible) continue;

    suivant = poserCellule(suivant, cleJumelle, semaine.numero, heures, type);
    reportees += 1;
  }

  return { planning: suivant, reportees };
}

/**
 * Efface une cellule, et l'efface sur les jumelles si elle était SYNCHRONE.
 *
 * ⚠️ ON NE REGARDE QUE LES CELLULES RÉELLEMENT SYNCHRONES chez la jumelle : y
 * effacer un cours en salle qui n'a rien à voir serait une perte de saisie.
 */
export function effacerAvecJumelles({ planning, modules = [], module, semaine }) {
  const cle = cleLigne(module);
  const etait = planning?.[cle]?.[semaine.numero];
  let suivant = poserCellule(planning, cle, semaine.numero, 0, TYPES.PRESENTIEL);

  if (etait?.type !== TYPES.SYNCHRONE) return { planning: suivant, reportees: 0 };

  let reportees = 0;
  for (const jumelle of lignesJumelles(modules, module)) {
    const cleJumelle = cleLigne(jumelle);
    if (planning?.[cleJumelle]?.[semaine.numero]?.type !== TYPES.SYNCHRONE) continue;

    suivant = poserCellule(suivant, cleJumelle, semaine.numero, 0, TYPES.PRESENTIEL);
    reportees += 1;
  }

  return { planning: suivant, reportees };
}
