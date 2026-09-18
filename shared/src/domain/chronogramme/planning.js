import { HEURES_PAR_JOUR, JOURS_PAR_SEMAINE, PAS, plafondSemaine } from './semaines.js';

/**
 * Le planning d'un groupe : module → semaine → heures, par type.
 * ← le blob `chronogrammes.planning_json` et `updateChronoCalc()`
 *
 * ═══ FORME RETENUE ═══
 * `{ [module]: { [numeroSemaine]: { heures, type } } }`
 *
 * Le blob d'origine est `{ module → { "S1" → "5|P" } }` — une chaîne
 * « heures|type ». La décomposer coûte une conversion aux deux bouts, mais
 * évite de manipuler du texte à chaque frappe et de reparser pour totaliser.
 * Le modèle Mongo porte déjà la forme structurée.
 */

/** `'P'` présentiel, `'S'` synchrone — les deux seuls types de l'existant. */
export const TYPES = { PRESENTIEL: 'P', SYNCHRONE: 'S' };

const nombre = (valeur) => {
  const converti = Number(valeur);
  return Number.isFinite(converti) && converti > 0 ? converti : 0;
};

/**
 * Heures déjà posées pour un module, par type.
 *
 * ⚠️ La semaine EXCLUE sert à projeter : « si je pose X ici, le total
 * dépasserait-il ? ». Sans elle, la cellule qu'on modifie serait comptée deux
 * fois — avec son ancienne valeur et la nouvelle — et toute augmentation
 * paraîtrait refusée.
 */
export function totauxModule(planning, module, { saufSemaine = null } = {}) {
  const cellules = planning?.[module] ?? {};
  let presentiel = 0;
  let synchrone = 0;

  for (const [semaine, cellule] of Object.entries(cellules)) {
    if (String(semaine) === String(saufSemaine)) continue;

    const heures = nombre(cellule?.heures);
    if (cellule?.type === TYPES.SYNCHRONE) synchrone += heures;
    else presentiel += heures;
  }

  return { presentiel: arrondir(presentiel), synchrone: arrondir(synchrone) };
}

/** Somme d'une COLONNE — le pied de grille « total / semaine ». */
export function totalSemaine(planning, numero) {
  let total = 0;

  for (const cellules of Object.values(planning ?? {})) {
    total += nombre(cellules?.[numero]?.heures);
  }

  return arrondir(total);
}

/**
 * Pourquoi cette semaine refuse toute saisie.
 *
 * ⚠️ UNE TABLE, PLUS UN TERNAIRE. La forme précédente ne connaissait que le
 * stage et retombait sur « Cette semaine est en vacances » pour tout le reste :
 * une semaine fermée par une FORMATION — et, depuis le 2026-09-02, par une
 * RENTRÉE à venir — annonçait donc des vacances qui n'existent pas, et envoyait
 * corriger le calendrier de l'établissement.
 */
const REFUS = {
  vacances: 'Cette semaine est en vacances.',
  rentree: 'Ce groupe n’a pas encore fait sa rentrée.',
  stage: 'Ce groupe est en stage cette semaine.',
  formation: 'Le formateur est en formation cette semaine.',
};

function motifDeRefus(semaine) {
  return REFUS[semaine?.motif] ?? 'Cette semaine ne peut recevoir aucune heure.';
}

/**
 * Une valeur peut-elle être posée dans cette cellule ?
 *
 * @returns {{possible: boolean, motif?: string, plafond?: number}}
 *   Le motif est destiné à l'ÉCRAN : « impossible » sans raison oblige à
 *   deviner laquelle des quatre règles a mordu.
 */
export function verifierCellule({
  planning,
  module,
  semaine,
  heures,
  type,
  masses,
  /**
   * Ce que les AUTRES modules ont déjà posé cette semaine-là.
   *
   * ⚠️ FACULTATIF, ET C'EST VOULU : l'appelant seul sait dédoublonner une séance
   * synchrone mutualisée (`totalSemaineFusionnee`). Omis, le contrôle du total
   * hebdomadaire ne s'applique pas — le plafond de cellule, lui, joue toujours.
   */
  posesSemaine = null,
}) {
  const valeur = nombre(heures);

  if (!semaine?.disponible) {
    return { possible: false, motif: motifDeRefus(semaine) };
  }

  if (valeur % PAS !== 0) {
    return { possible: false, motif: `Les heures se saisissent par pas de ${PAS} h.` };
  }

  const plafond = plafondSemaine(semaine);
  if (valeur > plafond) {
    return {
      possible: false,
      plafond,
      // Le plafond réduit surprend : on dit POURQUOI il l'est.
      motif:
        plafond === 0
          ? 'Cette semaine ne compte aucun jour disponible.'
          : `${plafond} h au plus cette semaine (${semaine.joursDisponibles} jour(s) ouvré(s)).`,
    };
  }

  /*
   * ═══ ⚠️ LE TOTAL DE LA SEMAINE, PAS SEULEMENT CELUI DE LA CELLULE ═══
   * (2026-08-26, garde demandé par le porteur.) Une semaine où il ne reste
   * qu'une journée ne peut porter que 10 h — TOUS MODULES CONFONDUS. Le plafond
   * de cellule ne l'empêchait pas : trois modules pouvaient y poser 10 h chacun,
   * et le chronogramme promettait trente heures dans une journée.
   *
   * ⚠️ LA CAPACITÉ DE LA SEMAINE N'EST PAS LE PLAFOND D'UNE CELLULE :
   * `plafondSemaine` borne AUSSI à 20 h, ce qui n'a de sens que pour un module.
   * La semaine, elle, tient `jours × 10 h`.
   */
  if (posesSemaine !== null) {
    const capacite = capaciteSemaine(semaine);
    const cumulSemaine = arrondir(Number(posesSemaine) + valeur);

    if (cumulSemaine > capacite) {
      return {
        possible: false,
        plafond: capacite,
        motif: `${capacite} h au plus dans la semaine (${semaine.joursDisponibles} jour(s) ouvré(s), tous modules confondus) — ${cumulSemaine} h demandées.`,
      };
    }
  }

  const dejaPose = totauxModule(planning, module, { saufSemaine: semaine.numero });
  const estSynchrone = type === TYPES.SYNCHRONE;
  const cumul = arrondir((estSynchrone ? dejaPose.synchrone : dejaPose.presentiel) + valeur);
  const masse = arrondir(estSynchrone ? (masses?.synchrone ?? 0) : (masses?.presentiel ?? 0));

  if (masse > 0 && cumul > masse) {
    return {
      possible: false,
      motif: `Masse horaire dépassée : ${cumul} h posées pour ${masse} h ${
        estSynchrone ? 'synchrones' : 'présentielles'
      }.`,
    };
  }

  return { possible: true };
}

/** Pose une valeur, ou VIDE la cellule si les heures tombent à zéro. */
export function poserCellule(planning, module, numero, heures, type) {
  const courant = planning ?? {};
  const cellules = { ...(courant[module] ?? {}) };
  const valeur = nombre(heures);

  // Une cellule à 0 est RETIRÉE, pas conservée à zéro : le planning ne doit
  // porter que ce qui est réellement prévu, sinon l'export et la comparaison
  // « planifié vs réalisé » comptent des séances fantômes.
  if (valeur === 0) delete cellules[numero];
  else cellules[numero] = { heures: valeur, type: type ?? TYPES.PRESENTIEL };

  return { ...courant, [module]: cellules };
}

/** Reste à planifier, par type — ce que le pied de ligne annonce. */
export function resteAPlanifier(planning, module, masses) {
  const poses = totauxModule(planning, module);

  return {
    presentiel: arrondir(Math.max(0, (masses?.presentiel ?? 0) - poses.presentiel)),
    synchrone: arrondir(Math.max(0, (masses?.synchrone ?? 0) - poses.synchrone)),
  };
}

/** Les heures tombent sur des demis : deux décimales suffisent et évitent
 *  « 22.499999999999996 » à l'écran. */
function arrondir(valeur) {
  return Math.round(valeur * 100) / 100;
}

/**
 * Ce que la SEMAINE peut porter, tous modules confondus.
 *
 * ⚠️ SANS LE PLAFOND DE CELLULE : `plafondSemaine` borne à 20 h parce qu'un
 * MODULE ne prend pas davantage. La semaine, elle, tient autant que ses jours —
 * six jours ouvrés portent soixante heures.
 */
export function capaciteSemaine(semaine) {
  if (!semaine?.disponible) return 0;

  const jours = Math.max(0, Math.min(JOURS_PAR_SEMAINE, semaine.joursDisponibles ?? 0));
  return jours * HEURES_PAR_JOUR;
}
