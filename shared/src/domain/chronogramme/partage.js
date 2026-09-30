import { TYPES } from './planning.js';
import { cleLigne } from './fusion.js';

/**
 * Le module PARTAGÉ PAR TYPE : l'un assure le présentiel, l'autre le synchrone.
 * ← demande du porteur, 2026-10-01, sur M205 de DEEA202 (présentiel ZOUHAIR
 * ADNAOUI, synchrone NABIL KADANI).
 *
 * ═══ LE PLANNING NE CHANGE PAS DE FORME ═══
 * Une cellule par semaine et par module, typée P ou S : c'est ce que stockent le
 * serveur, le classeur et la charge. Le partage est une LECTURE de ce planning —
 * chaque ligne à l'écran ne montre que les cellules de SON type, et l'écriture
 * réinjecte ces cellules sans toucher à celles de l'autre type.
 *
 * ⚠️ UNE SEULE CELLULE PAR SEMAINE, DONC UNE SEMAINE PORTÉE PAR L'UN EST FERMÉE
 * À L'AUTRE. La réécrire effacerait sans un mot les heures du collègue ; la
 * ligne verrouille donc ces semaines (motif `autreType`).
 */

const SUFFIXES = { [TYPES.PRESENTIEL]: '#P', [TYPES.SYNCHRONE]: '#S' };

const autreType = (type) => (type === TYPES.SYNCHRONE ? TYPES.PRESENTIEL : TYPES.SYNCHRONE);

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

/** Les cellules d'un seul type. */
export function cellulesDuType(cellules = {}, type) {
  return Object.fromEntries(
    Object.entries(cellules ?? {}).filter(([, cellule]) => (cellule?.type ?? TYPES.PRESENTIEL) === type)
  );
}

/**
 * Les cellules d'un module après une saisie restreinte à `type` : celles de
 * l'AUTRE type viennent de `origine`, celles de `type` de `saisies`.
 *
 * ⚠️ UNE SAISIE SUR UNE SEMAINE QUE L'AUTRE TYPE OCCUPE EST ÉCARTÉE, et comptée :
 * l'écraser effacerait la part du collègue.
 *
 * @returns {{cellules: object, refusees: number}}
 */
export function fusionnerType(origine = {}, saisies = {}, type) {
  const cellules = cellulesDuType(origine, autreType(type));
  let refusees = 0;

  for (const [numero, cellule] of Object.entries(saisies ?? {})) {
    if (cellules[numero]) {
      refusees += 1;
      continue;
    }
    cellules[numero] = cellule;
  }

  return { cellules, refusees };
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
 * Ferme, sur une ligne `typeSeul`, les semaines que l'autre type occupe déjà.
 *
 * ⚠️ UNE LIGNE SANS `typeSeul` EST RENDUE TELLE QUELLE (même objet) : les
 * cellules sont mémoïsées sur leurs props, et recréer toutes les lignes à chaque
 * frappe les ferait toutes re-rendre.
 *
 * @param {Array} lignes
 * @param {(ligne) => object} cellulesSource — les cellules COMPLÈTES du module
 * @param {Array} semainesParDefaut — celles de la grille, pour une ligne qui
 *   n'a pas les siennes
 */
export function verrouillerAutreType(lignes = [], cellulesSource, semainesParDefaut = []) {
  return lignes.map((ligne) => {
    if (!ligne.typeSeul) return ligne;

    const occupees = cellulesDuType(cellulesSource(ligne) ?? {}, autreType(ligne.typeSeul));
    if (Object.keys(occupees).length === 0) return ligne;

    return {
      ...ligne,
      semaines: (ligne.semaines ?? semainesParDefaut).map((semaine) =>
        occupees[semaine.numero] && semaine.disponible
          ? { ...semaine, disponible: false, motif: 'autreType' }
          : semaine
      ),
    };
  });
}
