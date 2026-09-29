import { JOURS, TYPES_COURS } from 'shared/constants';
import { conflitAvecCollegues, heuresPosees, identiques } from 'shared/domain';
import { SEANCES_PROPOSABLES } from 'shared/schemas';

/**
 * La grille de proposition, en mémoire — fonctions pures, testées.
 * ← `propGrid` / `propOrigGrid` / `propDrop()` de inbox.html
 *
 * Une grille est un objet `{ "Lundi|S1": { groupe, module, salle } }` : une
 * clé par case occupée, rien pour une case vide.
 */
export const CRENEAUX = SEANCES_PROPOSABLES;
export { JOURS };

export const cleCase = (jour, seance) => `${jour}|${seance}`;

/**
 * La grille de départ : l'emploi ACTUEL du formateur (comme `propLoadEDT`).
 * ⚠️ Les séances PROTÉGÉES (EFM, absence, rattrapage) n'y entrent pas : elles
 * ne se proposent pas, elles s'affichent verrouillées à part.
 */
export function grilleDepuis(seances = []) {
  const grille = {};
  for (const s of seances) {
    if (s.protegee) continue;
    grille[cleCase(s.jour, s.seance)] = { groupe: s.groupe, module: s.module, salle: s.salle ?? '' };
  }
  return grille;
}

/** Les cases verrouillées, par clé. */
export function casesProtegees(seances = []) {
  return Object.fromEntries(seances.filter((s) => s.protegee).map((s) => [cleCase(s.jour, s.seance), s]));
}

/** Ce que le serveur attend : `[{ jour, seance, groupe, module, salle }]`. */
export function versSeances(grille) {
  const seances = [];
  for (const jour of JOURS) {
    for (const seance of CRENEAUX) {
      const occupee = grille[cleCase(jour, seance)];
      if (occupee) seances.push({ jour, seance, ...occupee });
    }
  }
  return seances;
}

/** Échange deux cases — le glisser-déposer de l'existant. */
export function echanger(grille, depuis, vers) {
  if (depuis === vers) return grille;
  const suivante = { ...grille };
  const a = grille[depuis];
  const b = grille[vers];
  if (b) suivante[depuis] = b;
  else delete suivante[depuis];
  if (a) suivante[vers] = a;
  else delete suivante[vers];
  return suivante;
}

export function poserCase(grille, cle, seance) {
  const suivante = { ...grille };
  if (seance) suivante[cle] = seance;
  else delete suivante[cle];
  return suivante;
}

/** La case diffère-t-elle de l'emploi actuel ? (le point vert de l'existant) */
export function estModifiee(grille, depart, cle) {
  const a = grille[cle];
  const b = depart[cle];
  if (!a && !b) return false;
  if (!a || !b) return true;
  return !identiques(a, b);
}

/** Nombre de cases qui changent : ce que l'envoi demandera au directeur. */
export function nombreDeChangements(grille, depart) {
  const cles = new Set([...Object.keys(grille), ...Object.keys(depart)]);
  return [...cles].filter((cle) => estModifiee(grille, depart, cle)).length;
}

/**
 * Le conflit de chaque case avec les propositions des collègues — la case
 * « RÉSERVÉ ». Même règle que le serveur (`conflitAvecCollegues`).
 */
export function conflitsDeLaGrille(grille, reservees = [], groupesFq = []) {
  const conflits = {};
  for (const [cle, occupee] of Object.entries(grille)) {
    const [jour, seance] = cle.split('|');
    const conflit = conflitAvecCollegues({ jour, seance, ...occupee }, reservees, { groupesFq });
    if (conflit) conflits[cle] = conflit;
  }
  return conflits;
}

const cleSeance = (s) => `${String(s.groupe).trim().toUpperCase()}|${String(s.module).trim().toUpperCase()}`;

/** Combien de séances de chaque ligne du chronogramme sont déjà dans la grille. */
export function dejaImportees(grille, item) {
  return Object.values(grille).filter((s) => cleSeance(s) === cleSeance(item)).length;
}

/**
 * Importe des lignes du chronogramme dans la grille.
 * ← `propImportChronoItem()` / `propImportAllChrono()` de inbox.html
 *
 * Chaque séance manquante va dans la PREMIÈRE case libre, jour après jour puis
 * créneau après créneau — l'ordre de l'existant. Une case est sautée si elle
 * est occupée, verrouillée (EFM…) ou si la séance y heurterait la proposition
 * d'un collègue. Le formateur DÉPLACE ensuite ce qui ne lui convient pas.
 *
 * ⚠️ ON COMPLÈTE, ON NE DOUBLE PAS : une ligne déjà importée (en tout ou en
 * partie) ne reçoit que ce qui lui manque. Cliquer deux fois « Importer » ne
 * met pas quatre séances là où le chronogramme en prévoit deux.
 *
 * ⚠️ LES INDISPONIBILITÉS SONT ÉVITÉES, PAS INTERDITES : un premier passage ne
 * remplit que les créneaux disponibles, un second prend les autres s'il reste
 * des séances. C'est la règle actée le 2026-09-22 pour la génération (« évite
 * tant qu'il a mieux à faire ») — une séance non importée serait perdue.
 *
 * @param {Array<{jour, seance}>} [options.indisponibilites]
 * @returns {{grille: object, placees: number, manquantes: number}}
 */
export function importer(
  grille,
  items = [],
  { protegees = {}, reservees = [], groupesFq = [], indisponibilites = [] } = {}
) {
  const indisponibles = new Set(indisponibilites.map((c) => cleCase(c.jour, c.seance)));
  let suivante = { ...grille };
  let placees = 0;
  let manquantes = 0;

  for (const item of items) {
    let reste = item.nombre - dejaImportees(suivante, item);
    const seance = { groupe: item.groupe, module: item.module, salle: item.salle ?? '' };

    for (const passage of ['disponibles', 'tous']) {
      for (const jour of JOURS) {
        for (const creneau of CRENEAUX) {
          if (reste <= 0) break;
          const cle = cleCase(jour, creneau);
          if (passage === 'disponibles' && indisponibles.has(cle)) continue;
          if (suivante[cle] || protegees[cle]) continue;
          if (conflitAvecCollegues({ jour, seance: creneau, ...seance }, reservees, { groupesFq })) continue;
          suivante = poserCase(suivante, cle, seance);
          reste -= 1;
          placees += 1;
        }
      }
    }
    manquantes += Math.max(0, reste);
  }

  return { grille: suivante, placees, manquantes };
}

/**
 * Les heures posées sur l'année, SI la proposition était appliquée — ce qui fait
 * bouger le taux d'avancement de la liste des modules à chaque séance posée
 * (signalé par le porteur, 2026-09-23 : « le taux ne change pas »).
 *
 * = le posé de l'année rendu par le serveur − les séances ACTUELLES du formateur
 *   cette semaine (la proposition les remplace) + les séances de la grille.
 *
 * ⚠️ LES SÉANCES PROTÉGÉES NE SONT PAS RETIRÉES : EFM, absences et rattrapages
 * restent en place à l'application. Le décompte passe par `heuresPosees`, la
 * règle de la page Emploi (EFM et absences n'y comptent déjà pas).
 *
 * @param {object} poseesServeur `{ "GM101||M101": { presentiel, synchrone } }`
 * @returns {Map<string, {presentiel: number, synchrone: number}>}
 */
export function poseesAvecGrille(poseesServeur = {}, actuelles = [], grille = {}) {
  const posees = new Map(Object.entries(poseesServeur).map(([cle, compte]) => [cle, { ...compte }]));

  const ajouter = (seances, signe) => {
    for (const [cle, compte] of heuresPosees(seances)) {
      const courant = posees.get(cle) ?? { [TYPES_COURS.PRESENTIEL]: 0, [TYPES_COURS.SYNCHRONE]: 0 };
      for (const type of [TYPES_COURS.PRESENTIEL, TYPES_COURS.SYNCHRONE]) {
        courant[type] = Math.max(0, (courant[type] ?? 0) + signe * (compte[type] ?? 0));
      }
      posees.set(cle, courant);
    }
  };

  ajouter(actuelles.filter((s) => !s.protegee), -1);
  ajouter(versSeances(grille), +1);
  return posees;
}

/** Ce que les collègues ont proposé sur une case, pour l'afficher. */
export function reservationsDeLaCase(reservees = [], jour, seance) {
  return reservees.flatMap(({ auteur, seances }) =>
    seances.filter((s) => s.jour === jour && s.seance === seance).map((s) => ({ auteur, ...s }))
  );
}
