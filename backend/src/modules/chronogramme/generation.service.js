import mongoose from 'mongoose';
import {
  ECART_MAX_MODULE_ANNUEL,
  PAS,
  PLAFOND_HEBDOMADAIRE_PIE,
  PREMIERE_SEMAINE_PIE,
  PRIORITE_METIER_FORMATION,
  SEMAINES_METIER_FORMATION,
  bornerALaFinDeFormation,
  derniereSemaineDuGroupe,
  estGroupePIE,
  estModuleMetierFormation,
  ferieSurJourDisponible,
  joursDisponibles,
  plafondTolereGroupe,
  TYPES,
  capaciteSemaine,
  celluleDepuisParts,
  cibleDeLaSemaine,
  cibleHebdomadaire,
  joursPerdusFormateur,
  ouvrirAPartirDe,
  partsDeCellule,
  plafondHebdomadaireModule,
  plafondHebdomadaireSynchrone,
  plancherHebdomadaire,
  poseMinimaleModule,
  plafondSemaine,
  plafondSoupleGroupe,
  RESERVE_REGIONALE,
  SEANCE_SYNCHRONE,
  prioriteGeneration,
  repartirSemestresAuPas,
  retirerReserve,
  semainesChronogramme,
  semainesDeLaLigne,
  fenetreDuSemestre,
  semainesDuSemestre,
  semainesEnFormation,
  separerFusion,
} from 'shared/domain';
import { TYPES_COURS } from 'shared/constants';

import { AutoGenConfig } from '../../models/AutoGenConfig.js';
import { Base } from '../../models/Base.js';
import { Chronogramme } from '../../models/Chronogramme.js';
import { Etablissement } from '../../models/Etablissement.js';
import { HttpError, notFound } from '../../lib/httpError.js';
import { cleGroupeModule, intitulesParGroupe } from '../../lib/intitulesModules.js';
import { joursFeries as joursFeriesEtablissement } from '../calendrier/calendrier.service.js';
import { obtenir as calendrierNational } from '../calendrierNational/calendrierNational.service.js';
import { resoudreChronogramme } from '../generation/solveur.client.js';
import {
  depuisMongo,
  formateurDeCle,
  modulesDuGroupe,
  nomDuFormateur,
  vacancesEffectives,
  versMongo,
} from './chronogramme.service.js';

/**
 * Génération automatique du CHRONOGRAMME (2026-10-04, demande du porteur).
 *
 * ═══ QUI FAIT QUOI ═══
 *   · `shared/domain/chronogramme/generation.js` — les règles A à D ;
 *   · ce fichier — les traduit en un problème de NOMBRES (priorités, cibles,
 *     plafonds par semaine), puis relit et CONTRÔLE la réponse ;
 *   · `ai/generateur/chronogramme` — répartit, sans rien savoir du métier.
 *
 * ═══ CE QU'EST UNE « TÂCHE » ═══
 * Ce qu'UN formateur doit à un module, pour un type :
 *   · présentiel : une tâche PAR GROUPE, même si l'affectation est fusionnée
 *     — il donne le cours à chacun ;
 *   · synchrone : UNE tâche pour tout l'ensemble fusionné — il le donne une
 *     fois, et chaque groupe reçoit les mêmes heures.
 * C'est la règle de `chargesHebdomadaires` et de `calculerCharges` : la charge
 * générée doit être celle que le tableau de charge affichera ensuite.
 *
 * ═══ DEUX MODES ═══
 *   · `remplacer` — les cases des modules affectés sont REFAITES ; ce que le
 *     générateur ne couvre pas (un module sans affectation) est conservé.
 *   · `completer` — rien n'est effacé : seules les heures qui manquent sont
 *     réparties, autour de ce qui est déjà saisi.
 */

const MODES = { REMPLACER: 'remplacer', COMPLETER: 'completer' };

/** Codes du solveur → phrase pour le directeur. Lui seul sait d'où vient la fermeture. */
const MOTIFS = {
  fenetre_fermee: () =>
    'Aucune semaine ouverte pour ce module (vacances, stage, rentrée, fin de formation du groupe ou formation du formateur).',
  metier_formation: () =>
    'Le module « Métier et formation » doit tenir dans les deux premières semaines du groupe (S1, au plus tard S2).',
  fenetre_trop_courte: () =>
    'Les semaines ouvertes avant la fin de formation du groupe ne peuvent pas contenir ces heures, même sans autre module (20 h par semaine au plus).',
  /*
   * ⚠️ LE CAS ATTENDU QUAND LA MASSE DÉPASSE CE QUE LES SEMAINES PERMETTENT :
   *    la charge hebdomadaire n'est jamais franchie (retour du porteur du
   *    2026-10-04), et ce qui n'y tient pas reste à planifier à la main.
   */
  cible_formateur: () =>
    'La charge hebdomadaire du formateur est atteinte jusqu’à la fin de l’année.',
  encadrement: () =>
    'Le synchrone ne se programme ni à la première ni à la dernière semaine du présentiel du module : celui-ci ne lui a pas laissé de semaine entre les deux.',
  capacite_partagee: () =>
    'Les semaines du groupe sont pleines (5 h par jour ouvert), prises par des modules prioritaires.',
  hors_pas: () => `Reliquat inférieur à ${PAS} h : la saisie se fait par pas de ${PAS} h.`,
  hors_seance: () =>
    `Reliquat inférieur à ${SEANCE_SYNCHRONE} h : les séances synchrones durent ${SEANCE_SYNCHRONE} h.`,
};

const cleCase = (groupe, module) => `${groupe}||${module}`;
const arrondir = (valeur) => Math.round(valeur * 100) / 100;

/**
 * Le problème envoyé au solveur, et tout ce qu'il faut pour relire sa réponse.
 *
 * ⚠️ PURE, ET EXPORTÉE POUR ÊTRE TESTÉE : c'est ici que vivent les choix qui
 *    comptent (qui est une tâche, quelle semaine est ouverte, quelle cible),
 *    et les éprouver ne doit demander ni Mongo ni Python.
 *
 * @param {number} anneeScolaire
 * @param {object} donnees
 * @param {object} donnees.base — la Base de l'année (groupes, formateurs, affectations)
 * @param {Array} [donnees.joursFeries] [donnees.vacances] [donnees.stages]
 *   [donnees.formations] [donnees.rentrees] — le calendrier, déjà fusionné
 * @param {object} [donnees.plannings] — groupe → planning (forme `depuisMongo`)
 * @param {{mode?: string}} [options]
 */
export function construireProblemeChronogramme(anneeScolaire, donnees, { mode = MODES.REMPLACER } = {}) {
  const {
    base,
    joursFeries = [],
    vacances = [],
    stages = [],
    formations = [],
    rentrees = [],
    plannings = {},
    // cleGroupeModule → intitulé (`intitulesParGroupe`) : sert à reconnaître
    // le module « Métier et formation ».
    intitules = new Map(),
    // formateur → ses indisponibilités déclarées (`AutoGenConfig.contraintes`).
    indisponibilites = new Map(),
  } = donnees;
  const completer = mode === MODES.COMPLETER;

  const canonique = new Map((base?.groupes ?? []).map((nom) => [String(nom).trim().toUpperCase(), nom]));
  const semainesCommunes = semainesChronogramme(anneeScolaire, { joursFeries, vacances, rentrees });
  const semainesGroupe = new Map();
  const semainesDe = (groupe) => {
    if (!semainesGroupe.has(groupe)) {
      /*
       * ⚠️ BORNÉES À LA FIN DE FORMATION DU GROUPE (2026-10-04, demande du
       *    porteur) : S42 en 1ʳᵉ année, S41 en 2ᵉ, S18 en 3ᵉ année CDJ. Rien
       *    n'est planifié au-delà, et la cible du formateur ne compte plus ce
       *    groupe — ses heures se reportent sur les autres.
       */
      semainesGroupe.set(
        groupe,
        ouvrirAPartirDe(
          bornerALaFinDeFormation(
            semainesChronogramme(anneeScolaire, { joursFeries, vacances, stages, groupe, rentrees }),
            derniereSemaineDuGroupe(groupe)
          ),
          // Groupe PIE : rien avant S3 (2026-10-04).
          estGroupePIE(groupe) ? PREMIERE_SEMAINE_PIE : null
        )
      );
    }
    return semainesGroupe.get(groupe);
  };

  /*
   * Régional et semestre se lisent au niveau du MODULE DU GROUPE, tous types
   * confondus — exactement ce que l'écran affiche (`modulesDuGroupe`). Un
   * module présentiel au S1 et synchrone au S2 est annuel pour tout le monde.
   */
  const infosModules = new Map();
  const infoModule = (groupe, module) => {
    if (!infosModules.has(groupe)) {
      infosModules.set(
        groupe,
        new Map(modulesDuGroupe(base, groupe).map((m) => [m.code, m]))
      );
    }
    return infosModules.get(groupe).get(module) ?? {};
  };

  // ─── 1. Les tâches, tirées des affectations ───
  const taches = new Map();
  for (const affectation of base?.affectations ?? []) {
    const formateur = String(affectation.formateur ?? '').trim();
    const module = String(affectation.module ?? '').trim();
    if (formateur === '' || module === '') continue;

    const membres = [
      ...new Set(
        separerFusion(affectation.groupe)
          .map((nom) => canonique.get(String(nom).trim().toUpperCase()))
          .filter(Boolean)
      ),
    ].sort();
    if (membres.length === 0) continue;

    const synchrone = affectation.type === TYPES_COURS.SYNCHRONE;
    const ensembles = synchrone ? [membres] : membres.map((groupe) => [groupe]);

    for (const groupes of ensembles) {
      const id = [formateur, groupes.join('+'), module, synchrone ? 'S' : 'P'].join('|');
      const tache = taches.get(id) ?? {
        id,
        formateur,
        groupes,
        module,
        type: synchrone ? TYPES.SYNCHRONE : TYPES.PRESENTIEL,
        s1: 0,
        s2: 0,
      };
      tache.s1 += Number(affectation.s1Heures) || 0;
      tache.s2 += Number(affectation.s2Heures) || 0;
      taches.set(id, tache);
    }
  }

  // Les parts (groupe, module, type) que le générateur couvre.
  const couvertes = new Set();
  for (const tache of taches.values()) {
    for (const groupe of tache.groupes) couvertes.add(`${cleCase(groupe, tache.module)}||${tache.type}`);
  }

  // ─── 2. Ce qu'on garde des plannings actuels ───
  const groupesTouches = [...new Set([...taches.values()].flatMap((t) => t.groupes))].sort();
  const conserves = {};
  let partsRemplacees = 0;
  // Les groupes dont une case est effacée : à réécrire même sans nouvelle pose.
  const groupesVides = new Set();
  for (const groupe of groupesTouches) {
    conserves[groupe] = {};
    for (const [module, cellules] of Object.entries(plannings[groupe] ?? {})) {
      for (const [semaine, cellule] of Object.entries(cellules ?? {})) {
        const parts = partsDeCellule(cellule);
        for (const type of [TYPES.PRESENTIEL, TYPES.SYNCHRONE]) {
          if (parts[type] <= 0) continue;
          if (!completer && couvertes.has(`${cleCase(groupe, module)}||${type}`)) {
            partsRemplacees += 1;
            groupesVides.add(groupe);
            continue;
          }
          conserves[groupe][module] ??= {};
          conserves[groupe][module][semaine] ??= { P: 0, S: 0 };
          conserves[groupe][module][semaine][type] += parts[type];
        }
      }
    }
  }
  const conserve = (groupe, module, semaine, type) =>
    conserves[groupe]?.[module]?.[semaine]?.[type] ?? 0;

  // ─── 3. Formations : jours par semaine et par formateur ───
  const formationsDe = new Map();
  const formationDe = (formateur) => {
    if (!formationsDe.has(formateur)) {
      formationsDe.set(
        formateur,
        new Map(
          semainesEnFormation(semainesCommunes, formateurDeCle(base, formateur), formations).map(
            (s) => [s.numero, s.jours]
          )
        )
      );
    }
    return formationsDe.get(formateur);
  };

  // ─── 4. Tâches au format du solveur ───
  const tachesSolveur = [];
  const descriptions = new Map();
  const casesUtilisees = new Set();
  const dejaParFormateur = new Map();

  /*
   * ═══ LA RÉSERVE DES MODULES RÉGIONAUX (2026-10-04, demande du porteur) ═══
   * 2,5 h laissées non planifiées sur chaque module régional, PAR GROUPE. Elle
   * se prend sur la tâche PRÉSENTIELLE du groupe ; sur la synchrone seulement
   * si le module n'a pas de présentiel dans ce groupe — sans quoi un module
   * mixte perdrait deux fois 2,5 h.
   */
  const avecPresentiel = new Set(
    [...taches.values()]
      .filter((t) => t.type === TYPES.PRESENTIEL && t.s1 + t.s2 > 0)
      .flatMap((t) => t.groupes.map((groupe) => cleCase(groupe, t.module)))
  );
  const porteReserve = (tache) =>
    tache.groupes.some((groupe) => infoModule(groupe, tache.module).estRegional) &&
    (tache.type === TYPES.PRESENTIEL ||
      tache.groupes.every((groupe) => !avecPresentiel.has(cleCase(groupe, tache.module))));
  let reserveRegionale = 0;

  for (const tache of [...taches.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const formation = [...formationDe(tache.formateur)].map(([numero, jours]) => ({ numero, jours }));
    const lignes = tache.groupes.map((groupe) =>
      new Map(semainesDeLaLigne(semainesDe(groupe), { formation }).map((s) => [s.numero, s]))
    );

    // Ce que la tâche porte déjà, semaine par semaine (mode « compléter »).
    const deja = new Map();
    if (completer) {
      for (let numero = 1; numero <= semainesCommunes.length; numero += 1) {
        const heures = Math.max(
          ...tache.groupes.map((groupe) => conserve(groupe, tache.module, numero, tache.type))
        );
        if (heures > 0) deja.set(numero, heures);
      }
      const parSemaine = dejaParFormateur.get(tache.formateur) ?? new Map();
      for (const [numero, heures] of deja) parSemaine.set(numero, (parSemaine.get(numero) ?? 0) + heures);
      dejaParFormateur.set(tache.formateur, parSemaine);
    }

    // ⚠️ Découpage S1/S2 arrondi au pas, total inchangé (11,11 + 8,89 → 10 + 10).
    const reserve = retirerReserve(
      repartirSemestresAuPas(tache.s1, tache.s2),
      porteReserve(tache) ? RESERVE_REGIONALE : 0
    );
    reserveRegionale += reserve.retenu * tache.groupes.length;

    const totalDeja = [...deja.values()].reduce((somme, h) => somme + h, 0);
    let resteTotal = Math.max(0, reserve.s1 + reserve.s2 - totalDeja);

    const lots = [];

    // ⚠️ Groupe PIE : 5 h par semaine pour TOUT le groupe, donc pour chaque module.
    const plafondDuGroupe = tache.groupes.some(estGroupePIE) ? PLAFOND_HEBDOMADAIRE_PIE : Infinity;

    /*
     * ═══ « MÉTIER ET FORMATION » : S1, AU PLUS TARD S2 (2026-10-04) ═══
     * Un seul lot, dans les deux premières semaines où le groupe a cours, au
     * rythme qu'il faut pour y tenir — la règle « une journée par module » ne
     * peut pas s'appliquer à une fenêtre de deux semaines.
     */
    const metierFormation = tache.groupes.some((groupe) =>
      estModuleMetierFormation(intitules.get(cleGroupeModule(groupe, tache.module)))
    );
    if (metierFormation) {
      const aPoser = arrondir(resteTotal);
      const plafondLigne = (numero) =>
        Math.min(...lignes.map((ligne) => plafondSemaine(ligne.get(numero))));
      const fenetre = semainesCommunes
        .map((semaine) => semaine.numero)
        .filter((numero) => plafondLigne(numero) > 0)
        .slice(0, SEMAINES_METIER_FORMATION);
      const plafondModule = Math.min(
        plafondHebdomadaireModule(aPoser, SEMAINES_METIER_FORMATION),
        plafondDuGroupe
      );
      const plafonds = {};
      for (const numero of fenetre) {
        const libre = Math.min(plafondLigne(numero), plafondModule) - (deja.get(numero) ?? 0);
        if (libre > 0) plafonds[numero] = libre;
      }
      if (aPoser > 0) lots.push({ heures: aPoser, plafonds, semestre: 'S1', echeance: null });
    }

    for (const [semestre, heures] of metierFormation
      ? []
      : [
          ['S1', reserve.s1],
          ['S2', reserve.s2],
        ]) {
      if (heures <= 0) continue;
      const dejaFenetre = semainesDuSemestre(semestre).reduce(
        (somme, numero) => somme + (deja.get(numero) ?? 0),
        0
      );
      // ⚠️ Jamais plus que ce qui manque AU TOTAL : des heures saisies hors de
      //    leur semestre comptent quand même comme faites.
      const aPoser = arrondir(Math.min(Math.max(0, heures - dejaFenetre), resteTotal));
      resteTotal -= aPoser;
      if (aPoser <= 0) continue;

      // ⚠️ Le S1 reste ouvert sur le S2 : ce qui n'y tient pas sans
      //    surcharger un formateur déborde (`fenetreDuSemestre`).
      const { semaines: fenetre, echeance } = fenetreDuSemestre(semestre);
      const plafondLigne = (numero) =>
        Math.min(...lignes.map((ligne) => plafondSemaine(ligne.get(numero))));

      /*
       * ⚠️ PAS PLUS D'UNE JOURNÉE PAR SEMAINE POUR CE MODULE (2026-10-04,
       *    demande du porteur : « ne pas condenser la masse d'un module ») —
       *    sauf si sa masse l'exige pour tenir dans les semaines ouvertes de
       *    SON semestre (`plafondHebdomadaireModule`).
       */
      const ouvertesDuSemestre = semainesDuSemestre(semestre).filter(
        (numero) => plafondLigne(numero) > 0
      ).length;
      // ⚠️ Le synchrone : une séance de 5 h par semaine (2026-10-04).
      const plafondModule = Math.min(
        tache.type === TYPES.SYNCHRONE
          ? plafondHebdomadaireSynchrone(heures, ouvertesDuSemestre)
          : plafondHebdomadaireModule(heures, ouvertesDuSemestre),
        plafondDuGroupe
      );

      const plafonds = {};
      for (const numero of fenetre) {
        const plafond = Math.min(plafondLigne(numero), plafondModule);
        const libre = plafond - (deja.get(numero) ?? 0);
        if (libre > 0) plafonds[numero] = libre;
      }
      lots.push({ heures: aPoser, plafonds, semestre, echeance });
    }
    if (lots.length === 0) continue;

    const priorite = metierFormation
      ? PRIORITE_METIER_FORMATION
      : Math.min(
          ...tache.groupes.map((groupe) => prioriteGeneration(infoModule(groupe, tache.module)))
        );
    const masseModule = Math.max(
      ...tache.groupes.map((groupe) => {
        const masses = infoModule(groupe, tache.module).masses ?? {};
        return (masses.presentiel ?? 0) + (masses.synchrone ?? 0);
      })
    );
    const poseMin = metierFormation ? null : poseMinimaleModule(tache.module, masseModule);
    const cellules = tache.groupes.map((groupe) => cleCase(groupe, tache.module));
    cellules.forEach((cle) => casesUtilisees.add(cle));

    tachesSolveur.push({
      id: tache.id,
      formateur: tache.formateur,
      groupes: tache.groupes,
      cellules,
      priorite,
      // « Les séances synchrones doivent être de 5 h. »
      ...(tache.type === TYPES.SYNCHRONE ? { pasTache: SEANCE_SYNCHRONE } : {}),
      // « Modules de 70 h et plus : des séances de 5 h à 10 h, sauf EG… »
      ...(poseMin ? { poseMin } : {}),
      /*
       * ⚠️ MODULE ANNUEL : SON S1 ENCHAÎNE SUR SON S2 (2026-10-04, demande du
       *    porteur : aucun arrêt entre les deux). Sans cela, un module
       *    prioritaire voyait ses heures du S1 servies d'un bloc en octobre,
       *    puis attendait janvier.
       */
      lots: lots.map(({ heures, plafonds, echeance }, index) => ({
        heures,
        plafonds,
        ...(echeance === null ? {} : { echeance }),
        ...(echeance !== null && index < lots.length - 1
          ? { ecartSuivant: ECART_MAX_MODULE_ANNUEL }
          : {}),
      })),
    });
    descriptions.set(tache.id, { ...tache, priorite, lots, metierFormation });
  }

  /*
   * ═══ LE SYNCHRONE NI AU DÉBUT NI À LA FIN DU MODULE (2026-10-04, demande
   *     du porteur) ═══ Une tâche synchrone est « encadrée » par les tâches
   *     présentielles du même module, dans ses groupes : le solveur ne la pose
   *     que strictement après leur première semaine et avant leur dernière.
   *     Un module sans présentiel (tout à distance) n'a pas d'encadrante, et
   *     reste libre.
   */
  for (const tache of tachesSolveur) {
    const synchrone = descriptions.get(tache.id);
    if (synchrone.type !== TYPES.SYNCHRONE) continue;
    const encadrantes = tachesSolveur
      .filter((autre) => {
        const presentiel = descriptions.get(autre.id);
        return (
          presentiel.type === TYPES.PRESENTIEL &&
          presentiel.module === synchrone.module &&
          presentiel.groupes.some((groupe) => synchrone.groupes.includes(groupe))
        );
      })
      .map((autre) => autre.id);
    if (encadrantes.length > 0) tache.encadreePar = encadrantes;
  }

  // ─── 5. Cases et groupes : plafonds et charges conservées ───
  const charge = (groupe, module, semaine) =>
    conserve(groupe, module, semaine, TYPES.PRESENTIEL) + conserve(groupe, module, semaine, TYPES.SYNCHRONE);

  const cellulesSolveur = [...casesUtilisees].sort().map((id) => {
    const [groupe, module] = id.split('||');
    const plafonds = {};
    const charges = {};
    for (const semaine of semainesDe(groupe)) {
      // Groupe PIE : la case ne peut pas porter plus que le groupe entier.
      const plafond = Math.min(
        plafondSemaine(semaine),
        estGroupePIE(groupe) ? PLAFOND_HEBDOMADAIRE_PIE : Infinity
      );
      if (plafond > 0) plafonds[semaine.numero] = plafond;
      const pris = charge(groupe, module, semaine.numero);
      if (pris > 0) charges[semaine.numero] = pris;
    }
    return { id, plafonds, charges };
  });

  const groupesUtilises = [...new Set(tachesSolveur.flatMap((t) => t.groupes))].sort();
  const groupesSolveur = groupesUtilises.map((groupe) => {
    const plafondsDurs = {};
    const plafondsSouples = {};
    const plafondsToleres = {};
    const charges = {};
    // ⚠️ Groupe PIE : 5 h au TOTAL par semaine, tous plafonds confondus — même
    //    « en cas de besoin » ou pour éviter une semaine à vide au formateur.
    const limite = estGroupePIE(groupe) ? PLAFOND_HEBDOMADAIRE_PIE : Infinity;
    for (const semaine of semainesDe(groupe)) {
      const dur = Math.min(limite, capaciteSemaine(semaine));
      if (dur > 0) {
        plafondsDurs[semaine.numero] = dur;
        plafondsSouples[semaine.numero] = Math.min(dur, plafondSoupleGroupe(semaine));
        // « En cas de besoin, 30 h peuvent être dépassées, mais pas trop. »
        plafondsToleres[semaine.numero] = Math.min(
          dur,
          Math.max(plafondsSouples[semaine.numero], plafondTolereGroupe(semaine, dur))
        );
      }
      const pris = Object.keys(conserves[groupe] ?? {}).reduce(
        (somme, module) => somme + charge(groupe, module, semaine.numero),
        0
      );
      if (pris > 0) charges[semaine.numero] = arrondir(pris);
    }
    return { id: groupe, plafondsSouples, plafondsToleres, plafondsDurs, charges };
  });

  // ─── 6. Formateurs : masse affectée → cible de chaque semaine (B, C, D) ───
  const formateursSolveur = [];
  const cibles = new Map();
  const parFormateur = new Map();
  for (const tache of taches.values()) {
    const liste = parFormateur.get(tache.formateur) ?? [];
    liste.push(tache);
    parFormateur.set(tache.formateur, liste);
  }

  for (const formateur of [...new Set(tachesSolveur.map((t) => t.formateur))].sort()) {
    const sesTaches = parFormateur.get(formateur);
    const masseAffectee = arrondir(sesTaches.reduce((somme, t) => somme + t.s1 + t.s2, 0));
    const cibleBase = cibleHebdomadaire(masseAffectee);
    const disponibles = joursDisponibles(indisponibilites.get(formateur) ?? []);
    const sesGroupes = [...new Set(sesTaches.flatMap((t) => t.groupes))];
    const formation = formationDe(formateur);

    const parSemaine = {};
    const minimums = {};
    for (const commune of semainesCommunes) {
      if (!commune.disponible) continue;
      const ouverts = sesGroupes
        .map((groupe) => semainesDe(groupe)[commune.numero - 1])
        .filter((semaine) => semaine?.disponible);
      // Aucun de ses groupes n'est là (rentrée à venir, stages) : rien à viser.
      if (ouverts.length === 0) continue;

      const perdus = joursPerdusFormateur({
        feries: commune.feries?.length ?? 0,
        formation: formation.get(commune.numero) ?? 0,
        groupes: ouverts.map((semaine) =>
          Math.max(semaine.joursStage ?? 0, semaine.joursRentree ?? 0)
        ),
      });
      const plancher = plancherHebdomadaire(masseAffectee, {
        ferieSurJourDisponible: ferieSurJourDisponible(commune.feries, disponibles),
      });
      const cible = cibleDeLaSemaine(cibleBase, perdus, plancher);
      if (cible > 0) parSemaine[commune.numero] = cible;
      /*
       * Le minimum de la semaine : sous lui, le solveur laisse un module annuel
       * commencer plus tôt que son enchaînement ne le voudrait.
       */
      const minimum = cibleDeLaSemaine(0, perdus, plancher);
      if (minimum > 0) minimums[commune.numero] = Math.min(cible, minimum);
    }

    const charges = Object.fromEntries(
      [...(dejaParFormateur.get(formateur) ?? new Map())].map(([numero, heures]) => [
        numero,
        arrondir(heures),
      ])
    );

    cibles.set(formateur, { masseAffectee, cibleHebdomadaire: cibleBase, parSemaine });
    formateursSolveur.push({ id: formateur, cibles: parSemaine, minimums, charges });
  }

  return {
    probleme: {
      pas: PAS,
      semaines: semainesCommunes.map((semaine) => semaine.numero),
      formateurs: formateursSolveur,
      groupes: groupesSolveur,
      cellules: cellulesSolveur,
      taches: tachesSolveur,
    },
    descriptions,
    conserves,
    cibles,
    groupesTouches,
    groupesVides,
    reserveRegionale: arrondir(reserveRegionale),
    partsRemplacees,
    semainesDe,
  };
}

/**
 * La réponse du solveur, CONTRÔLÉE puis assemblée en plannings de groupe.
 *
 * ⚠️ PYTHON N'EST PAS CRU SUR PAROLE (`ai/README.md` : « Node revalide avant
 *    d'écrire »). Une pose hors fenêtre, hors pas ou au-delà d'un plafond
 *    arrête tout : écrire une grille fausse dans vingt groupes serait pire
 *    que de ne rien générer.
 */
export function assemblerSolution(construit, solution) {
  const { probleme, descriptions, conserves, semainesDe } = construit;
  const incoherence = (message) =>
    new HttpError(502, 'Le générateur a rendu une répartition incohérente', {
      code: 'SOLUTION_INCOHERENTE',
      details: [{ message }],
    });

  const lotsPar = new Map(probleme.taches.map((t) => [t.id, t.lots]));
  const courtes = new Set();
  const posesParTache = new Map();

  /*
   * Les plannings partent de ce qui est conservé.
   *
   * ⚠️ SEULS LES GROUPES QUI CHANGENT sont rendus — ceux qui reçoivent une pose,
   *    ou dont une case est effacée (mode « remplacer »). Réécrire un groupe
   *    intact ferait avancer sa version pour rien, et le collègue qui l'a
   *    ouvert verrait son enregistrement refusé sans que rien n'ait bougé.
   */
  const modifies = new Set(construit.groupesVides);
  for (const pose of solution.poses ?? []) {
    for (const groupe of descriptions.get(pose.tacheId)?.groupes ?? []) modifies.add(groupe);
  }
  const parts = {};
  for (const groupe of construit.groupesTouches) {
    if (modifies.has(groupe)) parts[groupe] = structuredClone(conserves[groupe] ?? {});
  }

  for (const pose of solution.poses ?? []) {
    const tache = descriptions.get(pose.tacheId);
    if (!tache) throw incoherence(`tâche inconnue « ${pose.tacheId} »`);
    const heures = Number(pose.heures);
    if (!(heures > 0) || Math.abs(heures / PAS - Math.round(heures / PAS)) > 1e-6) {
      throw incoherence(`${heures} h ne tombe pas sur un pas de ${PAS} h`);
    }
    const plafond = lotsPar.get(pose.tacheId)[pose.lot]?.plafonds[pose.semaine] ?? 0;
    if (heures > plafond + 1e-6) {
      throw incoherence(`${heures} h en S${pose.semaine} pour « ${pose.tacheId} », plafond ${plafond} h`);
    }
    /*
     * ⚠️ SÉANCES SYNCHRONES DE 5 h — une seule plus courte par tâche : celle
     *    qui solde le reliquat de sa masse (2026-10-04).
     */
    if (
      tache.type === TYPES.SYNCHRONE &&
      Math.abs(heures / SEANCE_SYNCHRONE - Math.round(heures / SEANCE_SYNCHRONE)) > 1e-6
    ) {
      if (courtes.has(pose.tacheId)) {
        throw incoherence(
          `« ${pose.tacheId} » : plus d'une séance synchrone de moins de ${SEANCE_SYNCHRONE} h`
        );
      }
      courtes.add(pose.tacheId);
    }
    posesParTache.set(pose.tacheId, (posesParTache.get(pose.tacheId) ?? 0) + heures);

    for (const groupe of tache.groupes) {
      const module = (parts[groupe][tache.module] ??= {});
      const cellule = (module[pose.semaine] ??= { P: 0, S: 0 });
      cellule[tache.type] = arrondir(cellule[tache.type] + heures);
    }
  }

  for (const [id, posees] of posesParTache) {
    const demandees = lotsPar.get(id).reduce((somme, lot) => somme + lot.heures, 0);
    if (posees > demandees + 1e-6) throw incoherence(`« ${id} » : ${posees} h posées pour ${demandees} h`);
  }

  // Aucune case ne doit dépasser ce que sa semaine permet.
  const plannings = {};
  for (const [groupe, modules] of Object.entries(parts)) {
    const semaines = semainesDe(groupe);
    plannings[groupe] = {};
    for (const [module, cellules] of Object.entries(modules)) {
      plannings[groupe][module] = {};
      for (const [numero, valeur] of Object.entries(cellules)) {
        const avant = conserves[groupe]?.[module]?.[numero];
        const ajoute = avant ? valeur.P + valeur.S - avant.P - avant.S : valeur.P + valeur.S;
        if (ajoute > 0 && valeur.P + valeur.S > plafondSemaine(semaines[Number(numero) - 1]) + 1e-6) {
          throw incoherence(`${groupe} · ${module} · S${numero} dépasse son plafond`);
        }
        const cellule = celluleDepuisParts(valeur);
        if (cellule) plannings[groupe][module][numero] = cellule;
      }
    }
  }

  return plannings;
}

/** Ce que le directeur lit avant d'appliquer. */
function bilan(construit, solution, plannings, base) {
  const { descriptions, cibles } = construit;

  const chargeFormateur = new Map();
  for (const pose of solution.poses ?? []) {
    const { formateur } = descriptions.get(pose.tacheId);
    const semaines = chargeFormateur.get(formateur) ?? {};
    semaines[pose.semaine] = arrondir((semaines[pose.semaine] ?? 0) + pose.heures);
    chargeFormateur.set(formateur, semaines);
  }
  for (const formateur of construit.probleme.formateurs) {
    const semaines = chargeFormateur.get(formateur.id) ?? {};
    for (const [numero, heures] of Object.entries(formateur.charges)) {
      semaines[numero] = arrondir((semaines[numero] ?? 0) + heures);
    }
    chargeFormateur.set(formateur.id, semaines);
  }

  const formateurs = [...cibles]
    .map(([identifiant, { masseAffectee, cibleHebdomadaire: cible, parSemaine }]) => {
      const charges = chargeFormateur.get(identifiant) ?? {};
      const actives = Object.keys(charges).map(Number).filter((n) => charges[n] > 0);
      const derniere = actives.length > 0 ? Math.max(...actives) : null;
      // On ne juge l'écart qu'avant la DERNIÈRE semaine travaillée : finir tôt
      // (plancher de 25 h) n'est pas être sous la cible.
      const jugees = Object.keys(parSemaine)
        .map(Number)
        .filter((n) => derniere !== null && n < derniere);
      const ecart = (n) => (charges[n] ?? 0) - parSemaine[n];
      return {
        identifiant,
        nom: nomDuFormateur(base, identifiant),
        masseAffectee,
        cibleHebdomadaire: cible,
        moyenne:
          jugees.length > 0
            ? arrondir(jugees.reduce((s, n) => s + (charges[n] ?? 0), 0) / jugees.length)
            : 0,
        semainesSousCible: jugees.filter((n) => ecart(n) < -PAS).length,
        semainesAuDessus: jugees.filter((n) => ecart(n) > PAS).length,
        derniereSemaine: derniere,
        cibles: parSemaine,
        charges,
      };
    })
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  const nonPlanifiees = (solution.nonPoses ?? [])
    .map((nonPose) => {
      const tache = descriptions.get(nonPose.tacheId);
      const semestre = tache.lots[nonPose.lot]?.semestre ?? '';
      return {
        groupes: tache.groupes,
        module: tache.module,
        type: tache.type,
        formateur: nomDuFormateur(base, tache.formateur),
        semestre,
        heures: nonPose.heures,
        cause: nonPose.cause,
        motif: (MOTIFS[
          tache.metierFormation
            ? 'metier_formation'
            : nonPose.cause === 'hors_pas' && tache.type === TYPES.SYNCHRONE
              ? 'hors_seance'
              : nonPose.cause
        ] ??
          (() => nonPose.cause))(semestre),
      };
    })
    .sort((a, b) => a.groupes[0].localeCompare(b.groupes[0], 'fr') || a.module.localeCompare(b.module, 'fr'));

  /*
   * ═══ LES HEURES DU S1 TOMBÉES AU S2 ═══ La charge hebdomadaire prime sur
   * l'échéance de semestre (`fenetreDuSemestre`) : ce report est donc voulu,
   * mais le directeur doit le VOIR — un module régional du S1 qui finit en S20
   * se prépare autrement.
   */
  const debordements = new Map();
  for (const pose of solution.poses ?? []) {
    const tache = descriptions.get(pose.tacheId);
    const lot = tache.lots[pose.lot];
    if (lot?.echeance == null || pose.semaine <= lot.echeance) continue;
    const ligne = debordements.get(pose.tacheId) ?? {
      groupes: tache.groupes,
      module: tache.module,
      type: tache.type,
      formateur: nomDuFormateur(base, tache.formateur),
      semestre: lot.semestre,
      heures: 0,
      derniereSemaine: 0,
    };
    ligne.heures = arrondir(ligne.heures + pose.heures);
    ligne.derniereSemaine = Math.max(ligne.derniereSemaine, pose.semaine);
    debordements.set(pose.tacheId, ligne);
  }

  const heuresDemandees = [...descriptions.values()].reduce(
    (somme, t) => somme + t.lots.reduce((s, lot) => s + lot.heures, 0),
    0
  );

  return {
    groupes: Object.keys(plannings).length,
    cellules: Object.values(plannings).reduce(
      (somme, modules) => somme + Object.values(modules).reduce((s, c) => s + Object.keys(c).length, 0),
      0
    ),
    partsRemplacees: construit.partsRemplacees,
    heuresDemandees: arrondir(heuresDemandees),
    reserveRegionale: construit.reserveRegionale,
    heuresPlanifiees: arrondir((solution.poses ?? []).reduce((s, p) => s + p.heures, 0)),
    heuresNonPlanifiees: arrondir(nonPlanifiees.reduce((s, n) => s + n.heures, 0)),
    nonPlanifiees,
    debordements: [...debordements.values()].sort(
      (a, b) => a.groupes[0].localeCompare(b.groupes[0], 'fr') || a.module.localeCompare(b.module, 'fr')
    ),
    heuresDebordees: arrondir([...debordements.values()].reduce((s, d) => s + d.heures, 0)),
    formateurs,
    rapport: solution.rapport ?? {},
  };
}

/**
 * Génère le chronogramme de TOUS les groupes de l'année.
 *
 * ⚠️ TOUJOURS TOUT L'ÉTABLISSEMENT, jamais un groupe isolé : la cible d'un
 *    formateur porte sur l'ensemble de ses groupes. Générer un seul groupe
 *    ignorerait ce qu'il fait ailleurs la même semaine.
 *
 * ⚠️ LA SIMULATION EST LE DÉFAUT : elle rend exactement le bilan de
 *    l'écriture, sans rien écrire. C'est ce que l'écran montre avant de
 *    demander confirmation.
 */
export async function generer(etablissementId, anneeScolaire, { mode = MODES.REMPLACER, simulation = true } = {}) {
  const [base, etablissement, existants, configuration] = await Promise.all([
    Base.findOne({ etablissementId, anneeScolaire }),
    Etablissement.findById(etablissementId).select('calendrier stages formations'),
    Chronogramme.find({ etablissementId, anneeScolaire }),
    AutoGenConfig.findOne({ etablissementId, anneeScolaire }).select('contraintes').lean(),
  ]);
  if (!base) throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });

  const [{ joursFeries }, national, intitules] = await Promise.all([
    joursFeriesEtablissement(etablissementId, anneeScolaire),
    calendrierNational(anneeScolaire),
    intitulesParGroupe(
      base,
      (base.affectations ?? []).flatMap((affectation) =>
        separerFusion(affectation.groupe).map((groupe) => ({ groupe, module: affectation.module }))
      )
    ),
  ]);

  const construit = construireProblemeChronogramme(
    anneeScolaire,
    {
      base,
      joursFeries,
      vacances: vacancesEffectives(national, etablissement),
      stages: etablissement?.stages ?? [],
      formations: etablissement?.formations ?? [],
      rentrees: national.rentrees,
      plannings: Object.fromEntries(existants.map((c) => [c.groupe, depuisMongo(c.planning)])),
      intitules,
      indisponibilites: new Map(
        (configuration?.contraintes ?? []).map((c) => [
          String(c.formateur ?? '').trim(),
          c.indisponibilites ?? [],
        ])
      ),
    },
    { mode }
  );

  const solution =
    construit.probleme.taches.length > 0
      ? await resoudreChronogramme(construit.probleme)
      : { poses: [], nonPoses: [], rapport: {} };

  const plannings = assemblerSolution(construit, solution);
  const resultat = { mode, simulation, ...bilan(construit, solution, plannings, base) };
  if (simulation) return resultat;

  /*
   * ⚠️ TRANSACTIONNEL, comme l'import de classeur : vingt groupes écrits à
   *    moitié laisseraient des formateurs à 40 h et d'autres à rien, sans
   *    moyen de savoir lesquels. Chaque version avance : une grille ouverte
   *    avant la génération est périmée, et son enregistrement sera refusé
   *    plutôt que d'écraser ce qui vient d'être généré.
   */
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const [groupe, planning] of Object.entries(plannings)) {
        await Chronogramme.findOneAndUpdate(
          { etablissementId, anneeScolaire, groupe },
          { $set: { planning: versMongo(planning) }, $inc: { version: 1 } },
          { upsert: true, session }
        );
      }
    });
  } finally {
    await session.endSession();
  }

  return { ...resultat, groupesEcrits: Object.keys(plannings) };
}

export { MODES as MODES_GENERATION };
