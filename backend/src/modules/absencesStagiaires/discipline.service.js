import mongoose from 'mongoose';
import { TYPES_ABSENCE } from 'shared/constants';
import {
  anneeDuNomGroupe,
  bornesAnneeScolaire,
  enJour,
  examenDiscipline,
  noteDiscipline,
  sanctionComportement,
} from 'shared/domain';
import { AbsenceStagiaire } from '../../models/AbsenceStagiaire.js';
import { Base } from '../../models/Base.js';
import { cleGroupeModule, intitulesParGroupe } from '../../lib/intitulesModules.js';
import { IndisciplineStagiaire } from '../../models/IndisciplineStagiaire.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { badRequest, notFound } from '../../lib/httpError.js';
import { presenter as presenterAbsence } from './absencesStagiaires.service.js';

/**
 * ═══ LA NOTE DE DISCIPLINE (F9) ═══ ← vue SQL `vue_note_discipline` +
 * api/data/get_notes_discipline.php — devenue une agrégation, et surtout
 * recalculée par `noteDiscipline` du domaine, sur la grille réglementaire.
 *
 * ⚠️ LA NOTE EST CELLE D'UN STAGIAIRE, PAS D'UN GROUPE : elle compte TOUTES ses
 * absences de l'année, y compris celles de sa formation qualifiante. On choisit
 * un groupe pour lister des stagiaires ; on ne filtre pas leurs absences par lui.
 *
 * ⚠️ `aggregate` NE CONVERTIT PAS LES TYPES, contrairement à `find` : sans le
 * `ObjectId` et le `Number` explicites, la correspondance échoue et chaque note
 * ressort à 15/15 — sans erreur (piège déjà payé sur la liste des semaines).
 */

const nomDuStagiaire = (s) => [s.nom, s.prenom].filter(Boolean).join(' ').trim() || s.matricule;

/** Les groupes de la base Konosys de l'année, avec leur effectif. */
export async function groupes(etablissementId, anneeScolaire) {
  const lignes = await Stagiaire.aggregate([
    {
      $match: {
        etablissementId: new mongoose.Types.ObjectId(String(etablissementId)),
        anneeScolaire: Number(anneeScolaire),
      },
    },
    { $unwind: '$groupes' },
    { $group: { _id: '$groupes', effectif: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  return lignes.map((l) => ({ groupe: l._id, effectif: l.effectif }));
}

/** Les faits comptés par stagiaire : { matricule → {absencesNJ, absencesJ, retardsNJ, retardsJ, indisciplines} }. */
async function faitsParStagiaire(etablissementId, anneeScolaire, matricules) {
  const correspondance = {
    etablissementId: new mongoose.Types.ObjectId(String(etablissementId)),
    anneeScolaire: Number(anneeScolaire),
    matricule: { $in: matricules },
  };
  const [absences, indisciplines] = await Promise.all([
    AbsenceStagiaire.aggregate([
      { $match: correspondance },
      {
        $group: {
          _id: { matricule: '$matricule', type: '$typeAbsence', justifiee: '$justifiee' },
          n: { $sum: 1 },
        },
      },
    ]),
    IndisciplineStagiaire.aggregate([
      { $match: correspondance },
      { $group: { _id: '$matricule', n: { $sum: 1 } } },
    ]),
  ]);

  const faits = new Map(
    matricules.map((m) => [m, { absencesNJ: 0, absencesJ: 0, retardsNJ: 0, retardsJ: 0, indisciplines: 0 }])
  );
  for (const { _id, n } of absences) {
    const f = faits.get(_id.matricule);
    if (!f) continue;
    const cle = `${_id.type === TYPES_ABSENCE.RETARD ? 'retards' : 'absences'}${_id.justifiee ? 'J' : 'NJ'}`;
    f[cle] += n;
  }
  for (const { _id, n } of indisciplines) {
    const f = faits.get(_id);
    if (f) f.indisciplines = n;
  }
  return faits;
}

/**
 * ⚠️ SEULES LES ABSENCES ET RETARDS NON JUSTIFIÉS RETIRENT DES POINTS — règle de
 * `vue_note_discipline`, conservée. Les justifiés restent affichés : on doit
 * pouvoir voir qu'un stagiaire a manqué, même s'il avait une raison.
 */
const noter = (f, groupe) =>
  noteDiscipline({
    seancesAbsentes: f.absencesNJ,
    retards: f.retardsNJ,
    indisciplines: f.indisciplines,
    // 1ʳᵉ année : passage (/20) ; 2ᵉ et 3ᵉ : fin de formation (/15).
    anneeFormation: anneeDuNomGroupe(groupe),
  });

/** Les notes de discipline de tout un groupe, stagiaire par stagiaire. */
export async function notes(etablissementId, anneeScolaire, groupe) {
  const stagiaires = await Stagiaire.find({ etablissementId, anneeScolaire, groupes: groupe })
    .select('matricule nom prenom')
    .sort({ nom: 1, prenom: 1 })
    .lean();
  const faits = await faitsParStagiaire(
    etablissementId,
    anneeScolaire,
    stagiaires.map((s) => s.matricule)
  );

  return {
    groupe,
    examen: examenDiscipline(anneeDuNomGroupe(groupe)),
    stagiaires: stagiaires.map((s) => {
      const f = faits.get(s.matricule);
      return { matricule: s.matricule, nom: nomDuStagiaire(s), ...f, note: noter(f, groupe) };
    }),
  };
}

/**
 * Les notes de PLUSIEURS groupes d'un coup — pour l'export (2026-10-11).
 * ⚠️ UNE SEULE LECTURE DES FAITS pour tous les stagiaires, pas `notes()` groupe
 * par groupe : trente groupes feraient soixante requêtes. Même calcul que
 * `notes()` : la note d'un stagiaire compte toutes ses absences de l'année.
 * Un groupe sans stagiaire n'apparaît pas.
 */
export async function notesDesGroupes(etablissementId, anneeScolaire, groupesDemandes) {
  const stagiaires = await Stagiaire.find({ etablissementId, anneeScolaire, groupes: { $in: groupesDemandes } })
    .select('matricule nom prenom groupes')
    .sort({ nom: 1, prenom: 1 })
    .lean();
  const faits = await faitsParStagiaire(
    etablissementId,
    anneeScolaire,
    [...new Set(stagiaires.map((s) => s.matricule))]
  );

  return groupesDemandes
    .map((groupe) => {
      const membres = stagiaires.filter((s) => (s.groupes ?? []).includes(groupe));
      if (membres.length === 0) return null;
      return {
        groupe,
        examen: examenDiscipline(anneeDuNomGroupe(groupe)),
        stagiaires: membres.map((s) => {
          const f = faits.get(s.matricule);
          return { matricule: s.matricule, nom: nomDuStagiaire(s), ...f, note: noter(f, groupe) };
        }),
      };
    })
    .filter(Boolean);
}

/**
 * ═══ LE TABLEAU DE BORD DU GESTIONNAIRE (2026-09-29, demande du porteur :
 * « une page d'accueil pour gestionnaire … avec des statistiques sur
 * l'absence et la discipline des stagiaires ») ═══
 *
 * ⚠️ AGRÉGÉ EN UNE SEULE PASSE, PAS GROUPE PAR GROUPE : `notes()` ci-dessus
 * lit un groupe à la fois — parcourir les vingt ou trente groupes d'un
 * établissement pour un simple total aurait fait autant de requêtes qu'il y a
 * de groupes, à chaque ouverture de l'accueil. Ici, une poignée d'agrégations
 * MongoDB suffisent, quel que soit le nombre de groupes.
 *
 * ⚠️ MÊME RÈGLE QUE `noter()` : seuls les non justifiés comptent contre le
 * stagiaire — mais ICI on montre AUSSI le justifié, pour la même raison que la
 * fiche : on doit voir qu'il a manqué, même avec une raison valable.
 */
export async function tableauDeBord(etablissementId, anneeScolaire) {
  const correspondance = {
    etablissementId: new mongoose.Types.ObjectId(String(etablissementId)),
    anneeScolaire: Number(anneeScolaire),
  };

  const [
    parType,
    parGroupeAbsences,
    parGroupeRetards,
    parGroupeIndisciplines,
    totalIndisciplines,
    dernieresIndisciplines,
    dernieresAbsences,
    dernieresRetards,
    repartition,
    base,
    effectifs,
    cumuls,
    joursMarques,
    parJour,
  ] = await Promise.all([
      AbsenceStagiaire.aggregate([
        { $match: correspondance },
        { $group: { _id: { type: '$typeAbsence', justifiee: '$justifiee' }, n: { $sum: 1 } } },
      ]),
      /*
       * ⚠️ ABSENCES ET RETARDS COMPTÉS À PART (2026-09-29, demande du porteur :
       * « séparer l'absence et retard, ajouter une autre card pour le
       * retard ») : sans le filtre `typeAbsence`, « les groupes les plus
       * absents » mélangeait les deux faits sous un même total, alors que les
       * tuiles du haut les affichent déjà séparément.
       */
      AbsenceStagiaire.aggregate([
        { $match: { ...correspondance, typeAbsence: { $ne: TYPES_ABSENCE.RETARD } } },
        { $group: { _id: '$groupe', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 5 },
      ]),
      AbsenceStagiaire.aggregate([
        { $match: { ...correspondance, typeAbsence: TYPES_ABSENCE.RETARD } },
        { $group: { _id: '$groupe', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 5 },
      ]),
      IndisciplineStagiaire.aggregate([
        { $match: correspondance },
        { $group: { _id: '$groupe', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 5 },
      ]),
      IndisciplineStagiaire.countDocuments(correspondance),
      IndisciplineStagiaire.find(correspondance)
        .sort({ date: -1, createdAt: -1 })
        .limit(5)
        .select('matricule nomComplet groupe date motif')
        .lean(),
      /*
       * ⚠️ « DERNIÈRES ABSENCES / RETARDS », COMME LES INDISCIPLINES
       * (2026-09-29, demande du porteur : « je veux ajouter les Dernières
       * absent et retard comme indisciplines ») — même forme, même tri, pour
       * retrouver vite un fait récent sans ouvrir le registre.
       */
      AbsenceStagiaire.find({ ...correspondance, typeAbsence: { $ne: TYPES_ABSENCE.RETARD } })
        .sort({ date: -1, createdAt: -1 })
        .limit(5)
        .select('matricule nomComplet groupe date module justifiee')
        .lean(),
      AbsenceStagiaire.find({ ...correspondance, typeAbsence: TYPES_ABSENCE.RETARD })
        .sort({ date: -1, createdAt: -1 })
        .limit(5)
        .select('matricule nomComplet groupe date module justifiee')
        .lean(),
      /*
       * ⚠️ OÙ LES STAGIAIRES S'ABSENTENT (2026-10-23, demande du porteur : « sous
       * forme de graphe chaque groupe ou les formateurs (module) pour voir
       * exactement où les stagiaires s'absentent ») : les absences — retards
       * exclus — par groupe, module et formateur de la séance manquée. Une
       * agrégation, quel que soit le nombre de groupes.
       */
      AbsenceStagiaire.aggregate([
        { $match: { ...correspondance, typeAbsence: { $ne: TYPES_ABSENCE.RETARD } } },
        {
          $group: {
            _id: { groupe: '$groupe', module: '$module', formateur: '$formateurMatricule' },
            n: { $sum: 1 },
            nonJustifiees: { $sum: { $cond: ['$justifiee', 0, 1] } },
            // Qui a manqué — le radar les nomme au survol (2026-10-23, demande du porteur).
            stagiaires: { $push: { matricule: '$matricule', nom: '$nomComplet', justifiee: '$justifiee' } },
          },
        },
      ]),
      Base.findOne({ etablissementId, anneeScolaire }).select('formateurs affectations groupes groupeFilieres').lean(),
      groupes(etablissementId, anneeScolaire),
      /*
       * ⚠️ LE CUMUL NON JUSTIFIÉ DE CHAQUE STAGIAIRE (2026-10-25, demande du
       * porteur : le tableau des seuils de la grille d'assiduité à la place des
       * « Dernières absences ») — les mêmes faits que `noter()`, pour tous les
       * stagiaires de l'établissement en une agrégation.
       */
      AbsenceStagiaire.aggregate([
        { $match: { ...correspondance, justifiee: { $ne: true } } },
        { $sort: { date: -1 } },
        {
          $group: {
            _id: '$matricule',
            nom: { $first: '$nomComplet' },
            groupe: { $first: '$groupe' },
            seances: { $sum: { $cond: [{ $eq: ['$typeAbsence', TYPES_ABSENCE.RETARD] }, 0, 1] } },
            retards: { $sum: { $cond: [{ $eq: ['$typeAbsence', TYPES_ABSENCE.RETARD] }, 1, 0] } },
          },
        },
      ]),
      // Les jours où chaque stagiaire a manqué au moins une séance.
      AbsenceStagiaire.aggregate([
        { $match: { ...correspondance, typeAbsence: { $ne: TYPES_ABSENCE.RETARD } } },
        {
          $group: {
            _id: { matricule: '$matricule', groupe: '$groupe', date: '$date' },
            absent: { $max: { $cond: [{ $eq: ['$typeAbsence', TYPES_ABSENCE.RETARD] }, 0, 1] } },
          },
        },
      ]),
      /*
       * ⚠️ L'ÉVOLUTION PAR SEMAINE (2026-10-25, demande du porteur) : par jour et
       * par groupe, absences et retards à part — l'écran regroupe en semaines et
       * filtre par groupe sans nouvelle requête.
       */
      AbsenceStagiaire.aggregate([
        { $match: correspondance },
        {
          $group: {
            _id: { date: '$date', groupe: '$groupe' },
            absences: { $sum: { $cond: [{ $eq: ['$typeAbsence', TYPES_ABSENCE.RETARD] }, 0, 1] } },
            retards: { $sum: { $cond: [{ $eq: ['$typeAbsence', TYPES_ABSENCE.RETARD] }, 1, 0] } },
          },
        },
      ]),
    ]);
  const series = joursAbsentsConsecutifs(joursMarques);

  /* ⚠️ L'INTITULÉ DANS LA FILIÈRE DU GROUPE (2026-10-23, « affiche le nom
     complet du module ») : un même code change de sens d'une filière à l'autre. */
  const affectes = modulesAffectes(base, new Map());
  const intitules = await intitulesParGroupe(base, [
    ...repartition.map(({ _id }) => ({ groupe: _id.groupe, module: _id.module })),
    ...affectes,
  ]);
  const intituleDe = (groupe, module) => intitules.get(cleGroupeModule(groupe, module)) ?? '';

  // Le matricule du formateur de la séance → son nom, comme la feuille d'absence.
  const nomsFormateurs = new Map();
  for (const f of base?.formateurs ?? []) {
    for (const cle of [f.matricule, f.nomUnique, f.nomComplet]) {
      if (String(cle ?? '').trim()) nomsFormateurs.set(String(cle).trim(), f.nomComplet);
    }
  }

  let absencesJ = 0;
  let absencesNJ = 0;
  let retardsJ = 0;
  let retardsNJ = 0;
  for (const { _id, n } of parType) {
    if (_id.type === TYPES_ABSENCE.RETARD) {
      if (_id.justifiee) retardsJ += n;
      else retardsNJ += n;
    } else if (_id.justifiee) absencesJ += n;
    else absencesNJ += n;
  }

  const presenterMarquage = (a) => ({
    matricule: a.matricule,
    nom: a.nomComplet,
    groupe: a.groupe,
    date: a.date,
    module: a.module,
    justifiee: a.justifiee,
  });

  return {
    absences: {
      total: absencesJ + absencesNJ,
      justifiees: absencesJ,
      nonJustifiees: absencesNJ,
      recentes: dernieresAbsences.map(presenterMarquage),
    },
    retards: {
      total: retardsJ + retardsNJ,
      justifies: retardsJ,
      nonJustifies: retardsNJ,
      recents: dernieresRetards.map(presenterMarquage),
    },
    indisciplines: {
      total: totalIndisciplines,
      recentes: dernieresIndisciplines.map((i) => ({
        matricule: i.matricule,
        nom: i.nomComplet,
        groupe: i.groupe,
        date: i.date,
        motif: i.motif,
      })),
    },
    /*
     * ⚠️ L'EFFECTIF DE CHAQUE GROUPE (2026-10-24, demande du porteur : « les
     * badges groupes avec une couleur qui désigne leur taux d'absence ») : le
     * filtre du radar rapporte les séances manquées au nombre de stagiaires —
     * sans lui, un groupe de trente paraîtrait toujours plus absent qu'un de dix.
     */
    effectifsGroupes: effectifs,
    absencesParJour: parJour.map(({ _id, absences, retards }) => ({
      date: _id.date,
      groupe: _id.groupe ?? '',
      absences,
      retards,
    })),
    /*
     * Les stagiaires qui ont atteint au moins le premier palier (1 point) — la
     * sanction se lit sur `noteDiscipline`, la règle unique de la grille.
     */
    seuilsAssiduite: cumuls
      .map(({ _id, nom, groupe, seances, retards }) => ({
        matricule: _id,
        nom: nom || _id,
        groupe,
        seances,
        retards,
        points: noteDiscipline({ seancesAbsentes: seances, retards }).assiduite.pointsRetires,
        serieAbsence: series.get(_id) ?? null,
      }))
      .filter((stagiaire) => stagiaire.points >= 1)
      .sort((a, b) => b.points - a.points || a.nom.localeCompare(b.nom, 'fr')),
    groupesAbsences: parGroupeAbsences.map((g) => ({ groupe: g._id, n: g.n })),
    groupesRetards: parGroupeRetards.map((g) => ({ groupe: g._id, n: g.n })),
    groupesIndisciplines: parGroupeIndisciplines.map((g) => ({ groupe: g._id, n: g.n })),
    repartitionAbsences: repartition.map(({ _id, n, nonJustifiees, stagiaires }) => ({
      groupe: _id.groupe ?? '',
      module: _id.module ?? '',
      intitule: intituleDe(_id.groupe, _id.module),
      stagiaires: parStagiaire(stagiaires),
      formateur: nomsFormateurs.get(String(_id.formateur ?? '').trim()) ?? String(_id.formateur ?? '').trim(),
      n,
      nonJustifiees,
    })),
    /*
     * ⚠️ TOUS LES MODULES AFFECTÉS, MÊME SANS ABSENCE (2026-10-23, demande du
     * porteur : « affiche tous les modules même s'il n'y a pas d'absence ») :
     * le radar pose un axe par module du groupe ou du formateur filtré, à zéro
     * quand personne n'y a manqué. Un couple (groupe, module, formateur) une
     * fois, présentiel et synchrone confondus.
     */
    modulesAffectes: modulesAffectes(base, nomsFormateurs).map((affectation) => ({
      ...affectation,
      intitule: intituleDe(affectation.groupe, affectation.module),
    })),
  };
}

/**
 * ═══ N JOURS D'ABSENCE SUCCESSIFS ═══ (2026-10-25, demande du porteur : le
 * repère du risque d'abandon à côté des noms des seuils d'assiduité).
 *
 * ⚠️ LA PLUS LONGUE SÉRIE DE L'ANNÉE, PAS SEULEMENT CELLE EN COURS (revient
 * sur un premier calcul qui exigeait une série allant jusqu'au dernier jour de
 * cours du groupe : absent les 23, 24 et 25 septembre, ABID OUSSAMA n'avait
 * aucun repère). À égalité, la plus récente.
 *
 * ⚠️ DES JOURS SUCCESSIFS SEULEMENT : absent lundi puis mercredi n'est PAS une
 * série de deux jours. Seul le dimanche, jamais travaillé, se saute : samedi
 * puis lundi restent successifs. Un jour compte dès une séance manquée ; un
 * simple retard ne compte pas. Justifiée ou non, peu importe — un stagiaire
 * qui décroche peut fournir un certificat.
 */
export function joursAbsentsConsecutifs(joursMarques) {
  const absents = new Map();
  for (const { _id, absent } of joursMarques) {
    if (!absent) continue;
    if (!absents.has(_id.matricule)) absents.set(_id.matricule, new Set());
    absents.get(_id.matricule).add(_id.date);
  }

  const resultat = new Map();
  for (const [matricule, dates] of absents) {
    let meilleure = null;
    let serie = null;
    for (const date of [...dates].sort()) {
      serie = serie && successifs(serie.au, date) ? { ...serie, au: date, jours: serie.jours + 1 } : { du: date, au: date, jours: 1 };
      // `>=` : à égalité, la série la plus récente l'emporte.
      if (!meilleure || serie.jours >= meilleure.jours) meilleure = serie;
    }
    resultat.set(matricule, meilleure);
  }
  return resultat;
}

/** `avant` est la veille de `apres` — ou le samedi d'un lundi, le dimanche n'étant jamais travaillé. */
function successifs(avant, apres) {
  const ecart = (Date.parse(apres) - Date.parse(avant)) / 86_400_000;
  return ecart === 1 || (ecart === 2 && new Date(`${apres}T00:00:00Z`).getUTCDay() === 1);
}

/** Les absences d'une case, par stagiaire : le plus absent d'abord. */
function parStagiaire(marquages) {
  const parMatricule = new Map();
  for (const { matricule, nom, justifiee } of marquages ?? []) {
    const stagiaire = parMatricule.get(matricule) ?? { matricule, nom: nom || matricule, n: 0, nonJustifiees: 0 };
    stagiaire.n += 1;
    if (!justifiee) stagiaire.nonJustifiees += 1;
    parMatricule.set(matricule, stagiaire);
  }
  return [...parMatricule.values()].sort((a, b) => b.n - a.n || a.nom.localeCompare(b.nom, 'fr'));
}

function modulesAffectes(base, nomsFormateurs) {
  const vus = new Map();
  for (const affectation of base?.affectations ?? []) {
    const formateur = nomsFormateurs.get(String(affectation.formateur ?? '').trim()) ?? affectation.formateur;
    const cle = `${affectation.groupe}||${affectation.module}||${formateur}`;
    if (!vus.has(cle)) vus.set(cle, { groupe: affectation.groupe, module: affectation.module, formateur });
  }
  return [...vus.values()];
}

async function stagiaireDeLAnnee(etablissementId, anneeScolaire, matricule) {
  const stagiaire = await Stagiaire.findOne({ etablissementId, anneeScolaire, matricule })
    .select('matricule nom prenom groupePrincipal groupes')
    .lean();
  if (!stagiaire) {
    throw notFound('Ce stagiaire ne figure pas dans la base Konosys de l’année', {
      code: 'STAGIAIRE_INTROUVABLE',
    });
  }
  return stagiaire;
}

function presenterIndiscipline(indiscipline, rang) {
  return {
    id: String(indiscipline._id),
    date: indiscipline.date,
    motif: indiscipline.motif,
    observation: indiscipline.observation,
    rang,
    sanction: sanctionComportement(rang),
  };
}

/**
 * La fiche d'un stagiaire : sa note, ses absences et retards, ses indisciplines.
 *
 * ⚠️ LE RANG D'UNE INDISCIPLINE SE DÉDUIT DE L'ORDRE CHRONOLOGIQUE : la 3ᵉ est
 * un blâme parce que deux l'ont précédée, et en retirer une fait remonter les
 * suivantes — c'est pourquoi il n'est pas stocké.
 */
export async function fiche(etablissementId, anneeScolaire, matricule) {
  const stagiaire = await stagiaireDeLAnnee(etablissementId, anneeScolaire, matricule);
  const [absences, indisciplines, faits] = await Promise.all([
    AbsenceStagiaire.find({ etablissementId, anneeScolaire, matricule }).sort({ date: -1, seance: 1 }).lean(),
    IndisciplineStagiaire.find({ etablissementId, anneeScolaire, matricule }).sort({ date: 1, createdAt: 1 }).lean(),
    faitsParStagiaire(etablissementId, anneeScolaire, [matricule]),
  ]);
  const f = faits.get(matricule);
  const groupe = stagiaire.groupePrincipal || stagiaire.groupes?.[0] || '';

  return {
    matricule,
    nom: nomDuStagiaire(stagiaire),
    groupe,
    ...f,
    note: noter(f, groupe),
    absences: absences.map(presenterAbsence),
    indisciplines: indisciplines.map((ind, i) => presenterIndiscipline(ind, i + 1)).reverse(),
  };
}

export async function ajouterIndiscipline(etablissementId, anneeScolaire, corps, acteurId) {
  const stagiaire = await stagiaireDeLAnnee(etablissementId, anneeScolaire, corps.matricule);

  const { debut, fin } = bornesAnneeScolaire(anneeScolaire);
  if (corps.date < debut || corps.date > fin) {
    throw badRequest(`Le ${corps.date} n’appartient pas à l’année scolaire affichée`, { code: 'DATE_HORS_ANNEE' });
  }
  if (corps.date > enJour(new Date())) {
    throw badRequest('Une indiscipline ne se déclare pas à l’avance', { code: 'DATE_FUTURE' });
  }

  const creee = await IndisciplineStagiaire.create({
    etablissementId,
    anneeScolaire,
    matricule: stagiaire.matricule,
    nomComplet: nomDuStagiaire(stagiaire),
    groupe: stagiaire.groupePrincipal || stagiaire.groupes?.[0] || '',
    date: corps.date,
    motif: corps.motif,
    observation: corps.observation ?? '',
    saisiePar: acteurId ?? null,
  });
  return { id: String(creee._id) };
}

export async function supprimerIndiscipline(etablissementId, anneeScolaire, id) {
  const { deletedCount } = await IndisciplineStagiaire.deleteOne({ _id: id, etablissementId, anneeScolaire });
  if (deletedCount === 0) throw notFound('Indiscipline introuvable', { code: 'INDISCIPLINE_INTROUVABLE' });
}
