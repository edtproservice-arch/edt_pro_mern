import { SALLES_SANS_CONFLIT } from '../emploi/conflits.js';
import { dureeSeance } from '../emploi/grille.js';

/**
 * Placer les séances qu'il MANQUE à une semaine pour être conforme au
 * chronogramme — sans toucher à ce qui est déjà posé.
 * (demande du porteur, 2026-09-27 — rien de tel dans l'ancien EDT Pro, dont la
 * fenêtre de complétude ne faisait que constater.)
 *
 * ═══ TROIS NIVEAUX, DANS CET ORDRE ═══
 *  1. `libre`      — un créneau où formateur, groupe(s) ET une salle sont libres ;
 *     `a_eviter`   — le même, mais sur un créneau que le formateur a demandé à
 *                    éviter. C'est une consigne, pas une interdiction (décision
 *                    du 2026-09-21) : on ne s'y résout qu'après les autres.
 *  2. `sans_salle` — formateur et groupe(s) libres, mais aucune salle : la
 *                    séance est posée SANS salle, à compléter à la main.
 *  3. non placée   — ni l'un ni l'autre ; la séance est rendue avec sa raison,
 *                    et l'écran propose de revoir le chronogramme.
 *
 * ⚠️ LE FORMATEUR DOIT TOUJOURS ÊTRE LIBRE, même au niveau 2 : ignorer la salle
 *    est un manque qu'on complète ; ignorer le formateur serait le mettre à deux
 *    endroits à la fois — un conflit que `poser()` refuserait de toute façon.
 *
 * ⚠️ LES CRÉNEAUX INTERDITS LE RESTENT à tous les niveaux : stage, formation,
 *    rentrée sont des FAITS du calendrier, pas des préférences.
 *
 * ⚠️ FONCTION PURE ET DÉTERMINISTE. Elle travaille sur le problème abstrait que
 *    construit `probleme.js` (créneaux numérotés, interdictions, occupation) ;
 *    elle ne décide rien de définitif — chaque placement repasse ensuite par
 *    `poser()`, comme ceux du générateur. Pas de hasard : l'aperçu et
 *    l'écriture doivent proposer la même chose.
 */

export const NIVEAUX_PLACEMENT = Object.freeze({
  LIBRE: 'libre',
  A_EVITER: 'a_eviter',
  SANS_SALLE: 'sans_salle',
});

export const RAISONS_NON_PLACEE = Object.freeze({
  /** Tous les créneaux ouverts sont interdits à cette tâche (stage, formation, rentrée). */
  CRENEAUX_FERMES: 'creneaux_fermes',
  /** Le formateur est pris sur chaque créneau encore permis. */
  FORMATEUR_OCCUPE: 'formateur_occupe',
  /** Le ou les groupes sont pris sur chaque créneau encore permis. */
  GROUPE_OCCUPE: 'groupe_occupe',
  /** Formateur et groupe ont des créneaux libres, mais jamais les mêmes. */
  AUCUN_CRENEAU_COMMUN: 'aucun_creneau_commun',
  /** Le module manque, mais aucune affectation ne dit qui le donne. */
  SANS_AFFECTATION: 'sans_affectation',
});

/** Une chronogramme en heures, une grille en séances de 2,5 h. */
const DUREE = dureeSeance(null);
const EGAL = 0.01;

const maj = (valeur) => String(valeur ?? '').trim().toUpperCase();
const estReelle = (salle) => Boolean(salle) && !SALLES_SANS_CONFLIT.includes(maj(salle));

/**
 * Combien de séances chaque tâche doit encore recevoir cette semaine.
 *
 * ⚠️ LA FUSION COMPTE UNE FOIS. Une tâche mutualisée couvre plusieurs groupes :
 *    une seule séance comble le manque de CHACUN. On retient donc le PLUS GRAND
 *    manque de ses membres, jamais la somme — la somme poserait la séance deux
 *    fois et ferait passer les deux groupes « en trop ».
 *
 * ⚠️ ARRONDI AU-DESSUS, comme `seancesRequises` du générateur : c'est lui qui
 *    définit ce que le chronogramme réclame en séances, une seconde règle
 *    d'arrondi ferait diverger les deux.
 *
 * @param {object} entrees
 * @param {Array<{id, groupes: string[], module: string, type: string}>} entrees.taches
 * @param {Array<{groupe, module, type, prevu, pose, nature}>} entrees.ecarts — ceux de `completudeSemaine`
 * @returns {{aPlacer: Map<string, number>, sansAffectation: Array}}
 */
export function seancesManquantes({ taches = [], ecarts = [] } = {}) {
  if (!Array.isArray(taches) || !Array.isArray(ecarts)) {
    throw new TypeError('seancesManquantes attend des listes de tâches et d’écarts');
  }

  const manque = new Map();
  for (const ecart of ecarts) {
    if (ecart?.nature !== 'manquante') continue;
    const heures = (Number(ecart.prevu) || 0) - (Number(ecart.pose) || 0);
    if (heures <= EGAL) continue;
    manque.set(`${maj(ecart.groupe)}||${maj(ecart.module)}||${ecart.type}`, { ecart, heures });
  }

  const aPlacer = new Map();
  const couverts = new Set();

  for (const tache of taches) {
    let plusGrand = 0;
    for (const groupe of tache.groupes ?? []) {
      const cle = `${maj(groupe)}||${maj(tache.module)}||${tache.type}`;
      const trouve = manque.get(cle);
      if (!trouve) continue;
      couverts.add(cle);
      plusGrand = Math.max(plusGrand, trouve.heures);
    }
    if (plusGrand > EGAL) aPlacer.set(tache.id, Math.ceil(plusGrand / DUREE - EGAL));
  }

  /*
   * ⚠️ UN MANQUE SANS TÂCHE EST RENDU, PAS TU : le module est planifié mais
   *    personne n'y est affecté. Aucun créneau n'y peut rien — c'est la carte ou
   *    le chronogramme qu'il faut revoir, et l'écran doit le dire.
   */
  const sansAffectation = [...manque.entries()]
    .filter(([cle]) => !couverts.has(cle))
    .map(([, { ecart, heures }]) => ({
      groupe: ecart.groupe,
      module: ecart.module,
      type: ecart.type,
      heures: Math.round(heures * 100) / 100,
      raison: RAISONS_NON_PLACEE.SANS_AFFECTATION,
    }));

  return { aPlacer, sansAffectation };
}

/** L'occupation d'un créneau, tenue à jour au fil des placements. */
function nouvelEtat(creneaux, occupation) {
  const etat = new Map(
    creneaux.map((c) => [c.id, { formateurs: new Set(), groupes: new Set(), salles: new Set() }])
  );
  for (const occ of occupation) occuper(etat, occ.creneauId, occ);
  return etat;
}

function occuper(etat, creneauId, { formateur, groupes = [], salle }) {
  const case_ = etat.get(creneauId);
  if (!case_) return; // créneau du soir ou jour fermé : hors problème
  if (formateur) case_.formateurs.add(String(formateur).trim());
  for (const groupe of groupes) case_.groupes.add(maj(groupe));
  if (estReelle(salle)) case_.salles.add(maj(salle));
}

/** Les groupes que ces groupes-là empêchent d'occuper le même créneau. */
function bloquants(groupes, incompatibilites) {
  const tous = new Set();
  for (const groupe of groupes) {
    tous.add(maj(groupe));
    for (const autre of incompatibilites[groupe] ?? []) tous.add(maj(autre));
    // L'incompatibilité est déclarée dans un seul sens : on la lit dans les deux.
    for (const [cle, liste] of Object.entries(incompatibilites)) {
      if ((liste ?? []).includes(groupe)) tous.add(maj(cle));
    }
  }
  return tous;
}

/** Première salle libre, dans l'ordre : celles du module d'abord, puis les autres permises. */
function salleLibre(tache, case_) {
  const ordre = [...new Set([...(tache.sallesPreferees ?? []), ...(tache.sallesPossibles ?? [])])];
  for (const salle of ordre) {
    // TEAMS n'est pas un local : il n'est jamais « pris ».
    if (!estReelle(salle) || !case_.salles.has(maj(salle))) return salle;
  }
  return null;
}

/**
 * Place les séances manquantes.
 *
 * @param {object} probleme — le problème abstrait de `construireProbleme`
 * @param {Array<{id, jour, rang}>} probleme.creneaux
 * @param {Array} probleme.taches — `{id, formateur, groupes, priorite, difficulte,
 *   creneauxInterdits, creneauxAEviter, sallesPossibles, sallesPreferees}`
 * @param {Array} probleme.occupation — TOUTES les séances déjà posées
 * @param {object} probleme.incompatibilites — groupe → groupes qui le croisent
 * @param {Map<string, number>} aPlacer — tâche → nombre de séances à poser
 * @returns {{placements: Array, nonPlacees: Array}}
 */
export function placerManquantes(probleme, aPlacer) {
  if (!probleme || !Array.isArray(probleme.creneaux) || !Array.isArray(probleme.taches)) {
    throw new TypeError('placerManquantes attend un problème avec créneaux et tâches');
  }
  if (!(aPlacer instanceof Map)) {
    throw new TypeError('placerManquantes attend le nombre de séances par tâche (Map)');
  }

  const { creneaux, taches, occupation = [], incompatibilites = {} } = probleme;
  const etat = nouvelEtat(creneaux, occupation);
  const jourDe = new Map(creneaux.map((c) => [c.id, c.jour]));

  /*
   * ⚠️ LES PLUS CONTRAINTES D'ABORD, dans l'ordre même du générateur : priorité
   *    (EFM régional du S1 en tête), puis difficulté. Poser d'abord une tâche
   *    facile pourrait prendre l'unique créneau d'une tâche difficile.
   */
  const ordre = taches
    .filter((tache) => (aPlacer.get(tache.id) ?? 0) > 0)
    .sort(
      (a, b) =>
        (a.priorite ?? 99) - (b.priorite ?? 99) ||
        (b.difficulte ?? 0) - (a.difficulte ?? 0) ||
        String(a.id).localeCompare(String(b.id))
    );

  const placements = [];
  const nonPlacees = [];

  for (const tache of ordre) {
    const interdits = new Set(tache.creneauxInterdits ?? []);
    const aEviter = new Set(tache.creneauxAEviter ?? []);
    const formateur = String(tache.formateur ?? '').trim();
    const groupesBloquants = bloquants(tache.groupes ?? [], incompatibilites);
    const parJour = new Map();

    for (let rang = 0; rang < aPlacer.get(tache.id); rang += 1) {
      let meilleur = null;

      for (const creneau of creneaux) {
        if (interdits.has(creneau.id)) continue;
        const case_ = etat.get(creneau.id);
        if (formateur && case_.formateurs.has(formateur)) continue;
        if ([...groupesBloquants].some((g) => case_.groupes.has(g))) continue;

        const salle = salleLibre(tache, case_);
        const evite = aEviter.has(creneau.id);
        /*
         * La classe dit le niveau ; plus petit = meilleur. Une salle du module
         * libre vaut mieux qu'une autre salle, sans jamais passer devant un
         * créneau que le formateur n'a pas demandé à éviter.
         */
        const preferee = salle !== null && (tache.sallesPreferees ?? []).includes(salle);
        const classe =
          salle === null ? (evite ? 5 : 4) : (evite ? 2 : 0) + (preferee ? 0 : 1);
        /*
         * ⚠️ À CLASSE ÉGALE, ON ÉTALE SUR LA SEMAINE : deux séances du même
         *    module le même jour, c'est une journée entière pour le groupe
         *    quand un autre jour était libre. Puis le premier créneau venu —
         *    aucun hasard, pour que l'aperçu soit exactement l'écriture.
         */
        const cle = [classe, parJour.get(creneau.jour) ?? 0, creneau.id];
        if (!meilleur || comparer(cle, meilleur.cle) < 0) {
          meilleur = { cle, creneau, salle: salle ?? '', evite, classe };
        }
      }

      if (!meilleur) {
        nonPlacees.push({
          tacheId: tache.id,
          nombre: aPlacer.get(tache.id) - rang,
          raison: raisonDuNonPlacement(tache, creneaux, etat, interdits, groupesBloquants),
        });
        break;
      }

      const niveau =
        meilleur.classe >= 4
          ? NIVEAUX_PLACEMENT.SANS_SALLE
          : meilleur.evite
            ? NIVEAUX_PLACEMENT.A_EVITER
            : NIVEAUX_PLACEMENT.LIBRE;

      placements.push({
        tacheId: tache.id,
        creneauId: meilleur.creneau.id,
        salle: meilleur.salle,
        niveau,
        /** Posée sur un créneau à éviter — dit à part, même au niveau « sans salle ». */
        deconseille: meilleur.evite,
      });
      occuper(etat, meilleur.creneau.id, {
        formateur,
        groupes: tache.groupes ?? [],
        salle: meilleur.salle,
      });
      parJour.set(jourDe.get(meilleur.creneau.id), (parJour.get(jourDe.get(meilleur.creneau.id)) ?? 0) + 1);
    }
  }

  return { placements, nonPlacees };
}

const comparer = (a, b) => {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

/**
 * Pourquoi rien n'a pu être posé — la cause la plus STRUCTURELLE d'abord, pour
 * envoyer chercher au bon endroit.
 */
function raisonDuNonPlacement(tache, creneaux, etat, interdits, groupesBloquants) {
  const permis = creneaux.filter((c) => !interdits.has(c.id));
  if (permis.length === 0) return RAISONS_NON_PLACEE.CRENEAUX_FERMES;

  const formateur = String(tache.formateur ?? '').trim();
  const formateurLibre = permis.filter((c) => !formateur || !etat.get(c.id).formateurs.has(formateur));
  if (formateurLibre.length === 0) return RAISONS_NON_PLACEE.FORMATEUR_OCCUPE;

  const groupeLibre = permis.filter(
    (c) => ![...groupesBloquants].some((g) => etat.get(c.id).groupes.has(g))
  );
  if (groupeLibre.length === 0) return RAISONS_NON_PLACEE.GROUPE_OCCUPE;

  return RAISONS_NON_PLACEE.AUCUN_CRENEAU_COMMUN;
}
