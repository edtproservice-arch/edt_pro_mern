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
