import { TYPES, celluleDepuisParts, partsDeCellule } from './planning.js';
import { cleLigne } from './fusion.js';

/**
 * Le module PARTAGÉ PAR TYPE : l'un assure le présentiel, l'autre le synchrone.
 * ← demande du porteur, 2026-10-01, sur M205 de DEEA202 (présentiel ZOUHAIR
 * ADNAOUI, synchrone NABIL KADANI).
 *
 * ═══ LE PLANNING NE CHANGE PAS DE FORME ═══
 * Une cellule par semaine et par module — simple (P ou S) ou MIXTE (les deux,
 * depuis le 2026-10-01, voir `TYPE_MIXTE`). Le partage est une LECTURE de ce
 * planning : chaque ligne à l'écran ne montre que la part de SON type, et
 * l'écriture réinjecte cette part sans toucher à celle de l'autre type.
 *
 * ⚠️ LES DEUX PARTS COHABITENT (2026-10-01). Avant la case mixte, une semaine
 * portée par l'un était fermée à l'autre ; elle accueille désormais les deux.
 */

const SUFFIXES = { [TYPES.PRESENTIEL]: '#P', [TYPES.SYNCHRONE]: '#S' };

const memes = (a = [], b = []) =>
  a.length === b.length && [...a].sort().every((valeur, rang) => valeur === [...b].sort()[rang]);

/**
 * Le module se scinde-t-il en deux lignes ?
 *
 * ⚠️ SEULEMENT SI LES DEUX TYPES ONT UNE MASSE ET DES TITULAIRES DIFFÉRENTS. Une
 * même personne qui assure présentiel et synchrone garde une ligne : il n'y a
 * rien à répartir.
 */
export function estPartageParType(module) {
  const presentiel = module?.formateursPresentiel ?? [];
  const synchrone = module?.formateursSynchrone ?? [];
  return (
    Number(module?.masses?.presentiel ?? 0) > 0 &&
    Number(module?.masses?.synchrone ?? 0) > 0 &&
    presentiel.length > 0 &&
    synchrone.length > 0 &&
    !memes(presentiel, synchrone)
  );
}

/**
 * Vue par GROUPE : une ligne par type pour chaque module partagé.
 *
 * La ligne présentielle ne porte que la masse présentielle et ses titulaires, la
 * synchrone l'inverse ; `typeSeul` restreint la saisie à ce type. Les autres
 * modules sont rendus TELS QUELS (même objet), pour ne pas défaire la
 * mémoïsation des cellules.
 */
export function scinderParType(modules = []) {
  return modules.flatMap((module) => {
    if (!estPartageParType(module)) return [module];

    return [TYPES.PRESENTIEL, TYPES.SYNCHRONE].map((type) => {
      const estS = type === TYPES.SYNCHRONE;
      const titulaires = estS ? module.formateursSynchrone : module.formateursPresentiel;
      return {
        ...module,
        cle: `${cleLigne(module)}${SUFFIXES[type]}`,
        cleSource: cleLigne(module),
        typeSeul: type,
        formateurs: titulaires,
        formateursPresentiel: estS ? [] : titulaires,
        formateursSynchrone: estS ? titulaires : [],
        masses: {
          presentiel: estS ? 0 : module.masses.presentiel,
          synchrone: estS ? module.masses.synchrone : 0,
        },
      };
    });
  });
}

/**
 * Les cellules d'un seul type — la part de ce type de chaque case, en case
 * SIMPLE. Une case mixte y laisse sa part, l'autre n'apparaît pas.
 */
export function cellulesDuType(cellules = {}, type) {
  const leType = type === TYPES.SYNCHRONE ? TYPES.SYNCHRONE : TYPES.PRESENTIEL;
  const resultat = {};
  for (const [numero, cellule] of Object.entries(cellules ?? {})) {
    const heures = partsDeCellule(cellule)[leType];
    if (heures > 0) resultat[numero] = { heures, type: leType };
  }
  return resultat;
}

/**
 * Les cellules d'un module après une saisie restreinte à `type` : la part de
 * l'AUTRE type vient de `origine`, celle de `type` de `saisies`.
 *
 * ⚠️ PLUS RIEN N'EST ÉCARTÉ (2026-10-01) : une semaine où l'autre type a déjà
 * des heures devient une case MIXTE au lieu de refuser la saisie. `refusees`
 * reste dans le résultat, toujours à zéro, pour ne pas changer l'appel.
 *
 * @returns {{cellules: object, refusees: number}}
 */
export function fusionnerType(origine = {}, saisies = {}, type) {
  const leType = type === TYPES.SYNCHRONE ? TYPES.SYNCHRONE : TYPES.PRESENTIEL;
  const autre = leType === TYPES.SYNCHRONE ? TYPES.PRESENTIEL : TYPES.SYNCHRONE;
  const numeros = new Set([...Object.keys(origine ?? {}), ...Object.keys(saisies ?? {})]);
  const cellules = {};

  for (const numero of numeros) {
    const cellule = celluleDepuisParts({
      [autre]: partsDeCellule(origine?.[numero])[autre],
      [leType]: partsDeCellule(saisies?.[numero])[leType],
    });
    if (cellule) cellules[numero] = cellule;
  }

  return { cellules, refusees: 0 };
}

/**
 * Planning source (clé = `cleSource` ou `cleLigne`) → planning à l'écran (clé de
 * chaque ligne), filtré par type pour les lignes `typeSeul`.
 */
export function planningDesLignes(planning = {}, lignes = []) {
  const table = {};
  for (const ligne of lignes) {
    const source = planning?.[ligne.cleSource ?? cleLigne(ligne)] ?? {};
    table[cleLigne(ligne)] = ligne.typeSeul ? cellulesDuType(source, ligne.typeSeul) : source;
  }
  return table;
}

/**
 * Le chemin inverse : l'écran → le planning source.
 *
 * ⚠️ LES CELLULES DE L'AUTRE TYPE SONT REPRISES DU PLANNING D'ORIGINE, jamais
 * de l'écran : c'est la part du collègue, qu'aucune saisie ici ne doit effacer.
 * Une nouvelle cellule qui tomberait sur une semaine qu'il porte déjà est
 * écartée et comptée — `refusees` — plutôt que de l'écraser.
 *
 * @returns {{planning: object, refusees: number}}
 */
export function planningDepuisLignes(plat = {}, lignes = [], planning = {}) {
  const suivant = { ...planning };
  let refusees = 0;

  for (const ligne of lignes) {
    const cleSource = ligne.cleSource ?? cleLigne(ligne);
    const cellules = plat?.[cleLigne(ligne)] ?? {};

    if (!ligne.typeSeul) {
      suivant[cleSource] = cellules;
      continue;
    }

    // Partir de ce qui est déjà réécrit : l'autre ligne du même module a pu
    // passer avant.
    const resultat = fusionnerType(suivant[cleSource] ?? {}, cellules, ligne.typeSeul);
    suivant[cleSource] = resultat.cellules;
    refusees += resultat.refusees;
  }

  for (const cle of Object.keys(suivant)) {
    if (Object.keys(suivant[cle] ?? {}).length === 0) delete suivant[cle];
  }

  return { planning: suivant, refusees };
}

/**
 * ═══ DÉPLIER UN MODULE DANS LA GRILLE (2026-10-01, demande du porteur) ═══
 * « Garder l'affichage à une seule ligne, avec un bouton sur les modules avec du
 * synchrone pour afficher la deuxième ligne en cas de besoin. » Une ligne
 * dépliée devient deux — présentiel, synchrone — qui écrivent chacune SA part
 * de la même case : c'est ainsi qu'on pose les deux types la même semaine.
 *
 * ⚠️ CE DÉPLIAGE VIT DANS LA GRILLE, PAS DANS LA PAGE : la clé source est la
 * clé de la ligne DANS LA GRILLE (`cleGrille`), et non celle du planning du
 * groupe (`cleSource`, réservée au module partagé entre deux formateurs, que
 * la page scinde avant). Les deux mécanismes se superposent sans se gêner.
 */

/** Un module peut-il se déplier ? Il faut les deux masses, et une seule ligne. */
export function estDepliable(module) {
  return (
    !module?.typeSeul &&
    Number(module?.masses?.presentiel ?? 0) > 0 &&
    Number(module?.masses?.synchrone ?? 0) > 0
  );
}

const SUFFIXES_GRILLE = { [TYPES.PRESENTIEL]: '#gP', [TYPES.SYNCHRONE]: '#gS' };

/**
 * Les lignes de la grille, les modules de `deplies` (clés de ligne) remplacés
 * par leurs deux lignes. Les autres sont rendus TELS QUELS (même objet).
 */
export function deplierModules(modules = [], deplies = new Set()) {
  if (!deplies || deplies.size === 0) return modules;

  return modules.flatMap((module) => {
    const cle = cleLigne(module);
    if (!deplies.has(cle) || !estDepliable(module)) return [module];

    return [TYPES.PRESENTIEL, TYPES.SYNCHRONE].map((type) => {
      const estS = type === TYPES.SYNCHRONE;
      return {
        ...module,
        cle: `${cle}${SUFFIXES_GRILLE[type]}`,
        cleGrille: cle,
        typeSeul: type,
        masses: {
          presentiel: estS ? 0 : module.masses.presentiel,
          synchrone: estS ? module.masses.synchrone : 0,
        },
      };
    });
  });
}

/** Le planning de la grille → celui des lignes dépliées (chacune sa part). */
export function planningDeplie(planning = {}, lignes = []) {
  if (!lignes.some((ligne) => ligne.cleGrille)) return planning;

  const table = { ...planning };
  for (const ligne of lignes) {
    if (ligne.cleGrille) table[ligne.cle] = cellulesDuType(planning?.[ligne.cleGrille], ligne.typeSeul);
  }
  return table;
}

/**
 * Et le retour : les deux lignes d'un module déplié se réunissent en une
 * case par semaine — mixte quand les deux ont des heures.
 */
export function planningReplie(plat = {}, lignes = []) {
  if (!lignes.some((ligne) => ligne.cleGrille)) return plat;

  const suivant = { ...plat };
  const parSource = new Map();
  for (const ligne of lignes) {
    if (!ligne.cleGrille) continue;
    if (!parSource.has(ligne.cleGrille)) parSource.set(ligne.cleGrille, {});
    parSource.get(ligne.cleGrille)[ligne.typeSeul] = plat?.[ligne.cle] ?? {};
    delete suivant[ligne.cle];
  }

  for (const [cle, parts] of parSource) {
    const p = parts[TYPES.PRESENTIEL] ?? {};
    const s = parts[TYPES.SYNCHRONE] ?? {};
    const cellules = {};
    for (const numero of new Set([...Object.keys(p), ...Object.keys(s)])) {
      const cellule = celluleDepuisParts({ P: partsDeCellule(p[numero]).P, S: partsDeCellule(s[numero]).S });
      if (cellule) cellules[numero] = cellule;
    }
    suivant[cle] = cellules;
  }

  return suivant;
}
