/**
 * Ce qu'une nouvelle période de stage, de vacances ou de formation fait
 * disparaître de l'emploi du temps et du chronogramme (2026-09-23, demande du
 * porteur : « les séances planifiées doivent se supprimer automatiquement »).
 *
 * ═══ ⚠️ ON NE REGARDE QUE CE QUI EST NOUVEAU ═══
 * Les trois listes sont REMPLACÉES en bloc à chaque enregistrement. Seuls les
 * jours qu'elles ferment et qui étaient ouverts juste avant comptent : une
 * période déjà en place n'a plus rien à supprimer, et une période raccourcie ou
 * retirée ne supprime rien du tout. Recalculer « tout ce qui tombe dans une
 * période » ferait effacer, au premier enregistrement venu, des séances posées
 * volontairement AVANT cette livraison.
 *
 * ═══ ⚠️ DEUX GRAINS DIFFÉRENTS, DÉCISION DU PORTEUR ═══
 *   - emploi du temps : le JOUR — une séance part si son jour vient de fermer ;
 *   - chronogramme    : la SEMAINE — une cellule ne part que si sa semaine est
 *                       désormais ENTIÈREMENT fermée pour sa ligne. Une semaine
 *                       amputée garde ses heures ; l'alerte de dépassement
 *                       existante dit ce qu'il faut réduire.
 *
 * Fonctions PURES : elles décident de ce qui sera détruit. Le service les
 * nourrit et exécute, rien de plus.
 */

import { separerFusion } from '../carte/reconstruction.js';
import { enJour } from './jour.js';

/** Au-delà, la période est une erreur de saisie : on ne l'énumère pas jour par jour. */
const PLAFOND_JOURS = 800;

const cle = (valeur) =>
  String(valeur ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

const bornes = (periode) => ({
  debut: enJour(periode?.debut ?? periode?.date_debut),
  fin: enJour(periode?.fin ?? periode?.date_fin),
});

/**
 * Tous les jours « AAAA-MM-JJ » couverts par une liste de périodes.
 *
 * ⚠️ À MIDI, pas à minuit : un changement d'heure ferait sinon sauter ou
 * doubler un jour (même précaution que `joursDeLaSemaine`).
 */
export function joursDesPeriodes(periodes = []) {
  const jours = new Set();

  for (const periode of periodes ?? []) {
    const { debut, fin } = bornes(periode);
    if (!debut || !fin) continue;

    const [premier, dernier] = debut <= fin ? [debut, fin] : [fin, debut];
    const curseur = new Date(`${premier}T12:00:00`);

    for (let n = 0; n < PLAFOND_JOURS; n += 1) {
      const jour = enJour(curseur);
      if (jour > dernier) break;
      jours.add(jour);
      curseur.setDate(curseur.getDate() + 1);
    }
  }

  return jours;
}

/** Les jours de `apres` absents de `avant`. */
function difference(apres, avant) {
  return new Set([...apres].filter((jour) => !avant.has(jour)));
}

/** Regroupe des périodes par sujet (groupe, matricule), puis énumère leurs jours. */
function joursParSujet(periodes, sujet) {
  const parCle = new Map();
  for (const periode of periodes ?? []) {
    const nom = cle(sujet(periode));
    if (nom === '') continue;
    if (!parCle.has(nom)) parCle.set(nom, []);
    parCle.get(nom).push(periode);
  }
  return new Map([...parCle].map(([nom, liste]) => [nom, joursDesPeriodes(liste)]));
}

function ajoutsParSujet(avant, apres, sujet) {
  const joursAvant = joursParSujet(avant, sujet);
  const ajouts = new Map();

  for (const [nom, jours] of joursParSujet(apres, sujet)) {
    const nouveaux = difference(jours, joursAvant.get(nom) ?? new Set());
    if (nouveaux.size > 0) ajouts.set(nom, nouveaux);
  }
  return ajouts;
}

const groupeDuStage = (stage) => stage?.groupe ?? stage?.groupe_nom;
const matriculeDeLaFormation = (formation) =>
  formation?.matriculeFormateur ?? formation?.matricule_formateur;

/**
 * Les jours que le nouvel état ferme et que l'ancien laissait ouverts.
 *
 * @param {{vacances?: Array, stages?: Array, formations?: Array}} avant
 * @param {{vacances?: Array, stages?: Array, formations?: Array}} apres
 *   `vacances` : les périodes EFFECTIVES (réseau fusionné, cf. `fusionnerVacances`)
 * @returns {{vacances: Set<string>, stages: Map<string, Set<string>>,
 *            formations: Map<string, Set<string>>, jours: string[], vide: boolean}}
 *   clés de `stages` / `formations` en majuscules ; `jours` trié, toutes causes
 */
export function nouvellesFermetures(avant = {}, apres = {}) {
  const vacances = difference(
    joursDesPeriodes(apres.vacances),
    joursDesPeriodes(avant.vacances)
  );
  const stages = ajoutsParSujet(avant.stages, apres.stages, groupeDuStage);
  /*
   * ⚠️ LE MATRICULE SEUL : c'est lui que porte la séance, et il est obligatoire
   * à la saisie. Une formation sans matricule n'apparie rien — le défaut
   * `"AMMARI".includes("")` corrigé dans `calendrier.js` ne doit pas renaître.
   */
  const formations = ajoutsParSujet(avant.formations, apres.formations, matriculeDeLaFormation);

  const tous = new Set(vacances);
  for (const jours of [...stages.values(), ...formations.values()]) {
    for (const jour of jours) tous.add(jour);
  }

  return { vacances, stages, formations, jours: [...tous].sort(), vide: tous.size === 0 };
}

/**
 * Pourquoi cette séance doit partir — ou `null` si son jour reste ouvert.
 *
 * ⚠️ UNE FUSION (« GM101 GM102 ») PART DÈS QU'UN DE SES MEMBRES EST EN STAGE :
 * le cours commun ne peut plus avoir lieu sans lui.
 *
 * @param {{groupe: string, formateurMatricule: string}} seance
 * @param {string} jour  « AAAA-MM-JJ »
 * @returns {'vacances'|'stage'|'formation'|null}
 */
export function motifDeSuppression(seance, jour, fermetures) {
  if (!fermetures || !jour) return null;
  if (fermetures.vacances.has(jour)) return 'vacances';

  const membres = [seance?.groupe, ...separerFusion(seance?.groupe)].map(cle);
  if (membres.some((membre) => fermetures.stages.get(membre)?.has(jour))) return 'stage';

  if (fermetures.formations.get(cle(seance?.formateurMatricule))?.has(jour)) return 'formation';
  return null;
}

/** Numéros des semaines fermées d'un tableau `semainesChronogramme` / `semainesDeLaLigne`. */
export function semainesFermees(semaines = []) {
  return new Set(
    (semaines ?? []).filter((semaine) => !semaine.disponible).map((semaine) => semaine.numero)
  );
}

const numeroDe = (semaine) => {
  const trouve = /^S(\d+)$/i.exec(String(semaine ?? '').trim());
  return trouve ? Number(trouve[1]) : null;
};

/**
 * Les cellules d'un chronogramme dont la semaine vient de se fermer.
 *
 * @param {Record<string, Array<{semaine: string, heures: number}>>} planning  module → cellules
 * @param {(module: string) => Set<number>} fermeesAvant
 * @param {(module: string) => Set<number>} fermeesApres
 * @returns {Array<{module: string, semaine: string, numero: number, heures: number}>}
 */
export function cellulesNouvellementFermees(planning, fermeesAvant, fermeesApres) {
  const cellules = [];

  for (const [module, lignes] of Object.entries(planning ?? {})) {
    const avant = fermeesAvant(module);
    const apres = fermeesApres(module);

    for (const cellule of lignes ?? []) {
      const numero = numeroDe(cellule?.semaine);
      const heures = Number(cellule?.heures) || 0;
      if (numero === null || heures <= 0) continue;
      if (apres.has(numero) && !avant.has(numero)) {
        cellules.push({ module, semaine: cellule.semaine, numero, heures });
      }
    }
  }

  return cellules;
}

/**
 * Les cours supprimés, à inscrire en « séances non placées » — pour les replacer.
 *
 * ⚠️ NI LES SURVEILLANCES D'EFM, NI LES RATTRAPAGES. Une surveillance n'est pas
 * un cours ; un rattrapage supprimé rend son absence « à rattraper », qui est
 * déjà la liste où on le retrouve. Les compter ici les ferait replacer deux fois.
 *
 * @returns {Array<{anneeScolaire, semaine, groupe, module, formateurMatricule, nombre}>}
 */
export function nonPlaceesDesSeances(seances = []) {
  const parCle = new Map();

  for (const seance of seances ?? []) {
    if (seance?.estEfm || seance?.rattrapageDe) continue;

    const cleLigne = [seance.anneeScolaire, seance.semaine, seance.groupe, seance.module].join('|');
    const ligne = parCle.get(cleLigne) ?? {
      anneeScolaire: seance.anneeScolaire,
      semaine: seance.semaine,
      groupe: seance.groupe,
      module: seance.module,
      formateurMatricule: seance.formateurMatricule ?? '',
      nombre: 0,
    };
    ligne.nombre += 1;
    parCle.set(cleLigne, ligne);
  }

  return [...parCle.values()];
}

/**
 * Ce que le directeur doit lire avant de confirmer — des CHIFFRES, pas
 * « des séances existent » (même principe que le retrait d'un groupe).
 *
 * @param {Array<{motif, groupe, estEfm?, rattrapageDe?, statut?}>} seances
 * @param {Array<{groupe, heures}>} cellules
 */
export function resumerSuppressions(seances = [], cellules = []) {
  const parMotif = { vacances: 0, stage: 0, formation: 0 };
  const groupes = new Set();

  for (const seance of seances) {
    if (seance.motif in parMotif) parMotif[seance.motif] += 1;
    for (const membre of separerFusion(seance.groupe)) groupes.add(membre);
  }
  for (const cellule of cellules) groupes.add(cellule.groupe);

  return {
    seances: seances.length,
    parMotif,
    rattrapages: seances.filter((seance) => seance.rattrapageDe).length,
    efm: seances.filter((seance) => seance.estEfm).length,
    absences: seances.filter((seance) => seance.statut === 'absent').length,
    nonPlacees: nonPlaceesDesSeances(seances).reduce((total, ligne) => total + ligne.nombre, 0),
    cellules: cellules.length,
    heures: cellules.reduce((total, cellule) => total + (Number(cellule.heures) || 0), 0),
    groupes: [...groupes].filter(Boolean).sort((a, b) => a.localeCompare(b, 'fr')),
  };
}

/** Rien à détruire : l'enregistrement passe sans rien demander. */
export const resumeVide = (resume) => resume.seances === 0 && resume.cellules === 0;
