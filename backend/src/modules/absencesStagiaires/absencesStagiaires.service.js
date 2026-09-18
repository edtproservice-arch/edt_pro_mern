import mongoose from 'mongoose';
import { JOURS, ROLES, TYPES_ABSENCE } from 'shared/constants';
import { bornesAnneeScolaire, enJour, semaineDansAnnee, separerFusion } from 'shared/domain';
import { AbsenceStagiaire } from '../../models/AbsenceStagiaire.js';
import { Base } from '../../models/Base.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { badRequest, notFound } from '../../lib/httpError.js';
import { semaine as semaineDeLaGrille } from '../seances/seances.service.js';

/**
 * ═══ L'APPEL DES STAGIAIRES (F9) ═══ (2026-09-14, plan validé par le porteur)
 * ← api/data/save_absence_stagiaire.php · update_absence_stagiaire.php ·
 *   get_absences_stagiaires.php — quatre routes que AUCUN écran de l'existant
 *   n'appelait (vérifié dans tout `public/`) : c'est une fonctionnalité neuve.
 *
 * ═══ ⚠️ ON NE FAIT L'APPEL QUE D'UN COURS QUI A EU LIEU ═══ (décision du
 * porteur : « les séances de l'emploi ».) Les créneaux proposés sont ceux où le
 * groupe a cours ce jour-là dans l'emploi du temps ; une absence hors cours est
 * refusée. Le module et le formateur viennent de la SÉANCE, jamais du client.
 *
 * ═══ ⚠️ LE FORMATEUR NE VOIT ET NE MARQUE QUE SES SÉANCES ═══ (décision du
 * porteur.) Il est reconnu par son `identifiant` (matricule) sur
 * `Seance.formateurMatricule` ; le registre, lui, est filtré sur le formateur
 * de la séance, stocké au moment de l'appel.
 */

const memeNom = (a, b) => String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();
const estFormateur = (acteur) => acteur.role === ROLES.FORMATEUR;
const nomDuStagiaire = (s) => [s.nom, s.prenom].filter(Boolean).join(' ').trim() || s.matricule;

/**
 * Un jour « AAAA-MM-JJ » → son jour de semaine et sa semaine scolaire.
 *
 * ⚠️ À MIDI, JAMAIS À MINUIT : minuit local est 23 h UTC la veille au Maroc.
 * ⚠️ `semaineDansAnnee`, PAS `semaineDe` : l'année est celle que l'écran
 * consulte, et elle seule — le même calcul que l'import e-note.
 */
export function lireJour(anneeScolaire, date, maintenant = new Date()) {
  const { debut, fin } = bornesAnneeScolaire(anneeScolaire);
  if (date < debut || date > fin) {
    throw badRequest(`Le ${date} n’appartient pas à l’année scolaire affichée`, { code: 'DATE_HORS_ANNEE' });
  }
  if (date > enJour(maintenant)) {
    throw badRequest('On ne fait pas l’appel d’un jour à venir', { code: 'DATE_FUTURE' });
  }

  const midi = new Date(`${date}T12:00:00`);
  // getDay() : 0 = dimanche, qui n'a pas de colonne dans la grille.
  const jour = JOURS[midi.getDay() - 1];
  if (!jour) throw badRequest('Le dimanche ne porte aucune séance', { code: 'DATE_DIMANCHE' });

  const { numero } = semaineDansAnnee(anneeScolaire, midi);
  return { date, jour, semaine: `${anneeScolaire}-W${numero}` };
}

/**
 * Pourquoi ce cours n'accepte pas d'appel — ou `null`.
 * ⚠️ La même lecture du calendrier que la grille (`semaine()` de l'emploi du
 * temps), comme pour le rattrapage : une seconde lecture finirait par ouvrir un
 * jour que la grille ferme.
 */
function motifDeFermeture(etat, seance) {
  if (etat?.ferie) return `Jour férié — ${etat.ferie.intitule}`;
  if (etat?.vacances) return 'Vacances';
  if (seance?.statut === 'absent') return 'Le formateur était absent : le cours n’a pas eu lieu';

  const membres = separerFusion(seance?.groupe ?? '');
  const stage = (etat?.stages ?? []).find((s) => membres.some((m) => memeNom(s.groupe, m)));
  if (stage) return `${stage.groupe} est en stage`;
  return null;
}

async function nomsDesFormateurs(etablissementId, anneeScolaire) {
  const base = await Base.findOne({ etablissementId, anneeScolaire }).select('formateurs').lean();
  const noms = new Map();
  for (const f of base?.formateurs ?? []) {
    for (const cle of [f.matricule, f.nomUnique, f.nomComplet]) {
      if (String(cle ?? '').trim()) noms.set(String(cle).trim(), f.nomComplet);
    }
  }
  return noms;
}

/**
 * Les cours d'une journée ouverts à l'appel pour cette personne.
 *
 * ⚠️ UNE SEULE ENTRÉE PAR (CRÉNEAU, GROUPE) : un EFM porte une séance PAR
 * SURVEILLANT, sur le même groupe et le même créneau. L'appel, lui, porte sur
 * les stagiaires : deux lignes identiques feraient faire l'appel deux fois.
 */
export async function seancesDuJour(etablissementId, anneeScolaire, { date, groupe }, acteur) {
  const jourLu = lireJour(anneeScolaire, date);
  const [grille, noms] = await Promise.all([
    semaineDeLaGrille(etablissementId, anneeScolaire, jourLu.semaine),
    nomsDesFormateurs(etablissementId, anneeScolaire),
  ]);
  const etat = grille.jours.find((j) => j.jour === jourLu.jour);

  const vues = new Set();
  const seances = grille.seances
    .filter((s) => s.jour === jourLu.jour && s.groupe)
    .filter((s) => (estFormateur(acteur) ? memeNom(s.formateurMatricule, acteur.identifiant) : true))
    .filter((s) => !groupe || separerFusion(s.groupe).includes(groupe))
    .filter((s) => {
      const cle = `${s.seance}|${s.periode}|${s.groupe}`;
      if (vues.has(cle)) return false;
      vues.add(cle);
      return true;
    })
    .sort((a, b) => a.seance.localeCompare(b.seance) || a.groupe.localeCompare(b.groupe, 'fr'))
    .map((s) => ({
      seance: s.seance,
      periode: s.periode,
      groupe: s.groupe,
      module: s.module,
      salle: s.salle,
      estEfm: s.estEfm,
      formateurMatricule: s.formateurMatricule,
      formateur: noms.get(String(s.formateurMatricule ?? '').trim()) ?? s.formateurMatricule,
      ferme: motifDeFermeture(etat, s),
    }));

  return { ...jourLu, fermeture: motifDeFermeture(etat, null), seances };
}

/**
 * Retrouve LE cours désigné par l'écran, et la liste des stagiaires qu'il réunit.
 * Tout ce qui s'écrit ensuite en est tiré.
 */
async function coursEtListe(etablissementId, anneeScolaire, { date, seance, periode = 'jour', groupe }, acteur) {
  const jour = await seancesDuJour(etablissementId, anneeScolaire, { date }, acteur);
  const cours = jour.seances.find(
    (s) => s.seance === seance && s.periode === periode && s.groupe === groupe
  );
  if (!cours) {
    throw notFound(
      estFormateur(acteur)
        ? `Vous n’avez pas cours avec ${groupe} le ${date} en ${seance}`
        : `${groupe} n’a pas cours le ${date} en ${seance}`,
      { code: 'SEANCE_INTROUVABLE' }
    );
  }

  // ⚠️ UNE FUSION RÉUNIT PLUSIEURS GROUPES : la liste est leur réunion, et chaque
  // stagiaire garde SON groupe — c'est lui qui figure sur sa note.
  const membres = separerFusion(cours.groupe);
  const stagiaires = await Stagiaire.find({ etablissementId, anneeScolaire, groupes: { $in: membres } })
    .select('matricule nom prenom groupes filiere')
    .sort({ nom: 1, prenom: 1 })
    .lean();

  const liste = stagiaires.map((s) => ({
    matricule: s.matricule,
    nom: nomDuStagiaire(s),
    groupe: membres.find((m) => (s.groupes ?? []).includes(m)) ?? membres[0],
    filiere: s.filiere ?? '',
  }));

  return { jour, cours, liste };
}

/** La liste d'appel d'un cours, avec ce qui y est déjà marqué. */
export async function appel(etablissementId, anneeScolaire, creneau, acteur) {
  const { jour, cours, liste } = await coursEtListe(etablissementId, anneeScolaire, creneau, acteur);
  const marques = await AbsenceStagiaire.find({
    etablissementId,
    anneeScolaire,
    date: jour.date,
    seance: cours.seance,
    periode: cours.periode,
    matricule: { $in: liste.map((s) => s.matricule) },
  }).lean();
  const parMatricule = new Map(marques.map((m) => [m.matricule, m]));

  return {
    date: jour.date,
    jour: jour.jour,
    semaine: jour.semaine,
    cours,
    stagiaires: liste.map((s) => {
      const marque = parMatricule.get(s.matricule);
      return {
        ...s,
        marque: marque
          ? { id: String(marque._id), type: marque.typeAbsence, justifiee: marque.justifiee }
          : null,
      };
    }),
  };
}

/**
 * Enregistre l'appel d'un cours : l'écran envoie l'état de la liste entière.
 *
 * ⚠️ UNE SEULE TRANSACTION : un appel à moitié écrit laisserait des absents
 * marqués et d'autres non, sans que l'écran puisse dire lesquels.
 * ⚠️ Passer d'absent à retard GARDE la justification et le motif déjà saisis.
 */
export async function enregistrerAppel(etablissementId, anneeScolaire, corps, acteur) {
  const { jour, cours, liste } = await coursEtListe(etablissementId, anneeScolaire, corps, acteur);

  if (cours.ferme) {
    throw badRequest(`Ce cours n’accepte pas d’appel : ${cours.ferme}`, {
      code: 'CRENEAU_FERME',
      details: [{ message: cours.ferme }],
    });
  }

  const inscrits = new Map(liste.map((s) => [s.matricule, s]));
  const inconnus = corps.marques.filter((m) => !inscrits.has(m.matricule)).map((m) => m.matricule);
  if (inconnus.length > 0) {
    throw badRequest(`Hors de la liste de ce cours : ${inconnus.join(', ')}`, {
      code: 'STAGIAIRE_HORS_GROUPE',
      details: inconnus.map((matricule) => ({ message: `${matricule} n’est pas inscrit à ce cours`, matricule })),
    });
  }

  const creneau = {
    etablissementId,
    anneeScolaire,
    date: jour.date,
    seance: cours.seance,
    periode: cours.periode,
  };
  const operations = corps.marques.map(({ matricule, type }) => {
    const filtre = { ...creneau, matricule };
    if (type === null) return { deleteOne: { filter: filtre } };

    const stagiaire = inscrits.get(matricule);
    return {
      updateOne: {
        filter: filtre,
        update: {
          $set: {
            typeAbsence: type,
            nomComplet: stagiaire.nom,
            groupe: stagiaire.groupe,
            filiere: stagiaire.filiere,
            semaine: jour.semaine,
            jour: jour.jour,
            groupeSeance: cours.groupe,
            module: cours.module ?? '',
            formateurMatricule: cours.formateurMatricule ?? '',
          },
          $setOnInsert: { saisiePar: acteur.id ?? null },
        },
        upsert: true,
      },
    };
  });

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (operations.length > 0) await AbsenceStagiaire.bulkWrite(operations, { session });
    });
  } finally {
    await session.endSession();
  }

  const compter = (type) => corps.marques.filter((m) => m.type === type).length;
  return {
    absences: compter(TYPES_ABSENCE.ABSENCE),
    retards: compter(TYPES_ABSENCE.RETARD),
    presents: compter(null),
  };
}

export function presenter(absence) {
  return {
    id: String(absence._id),
    date: absence.date,
    jour: absence.jour,
    semaine: absence.semaine,
    seance: absence.seance,
    periode: absence.periode,
    matricule: absence.matricule,
    nomComplet: absence.nomComplet,
    groupe: absence.groupe,
    groupeSeance: absence.groupeSeance,
    module: absence.module,
    formateurMatricule: absence.formateurMatricule,
    type: absence.typeAbsence,
    justifiee: absence.justifiee,
    motif: absence.motif,
    observation: absence.observation,
  };
}

/** Au-delà, le registre se lit filtré : l'année entière d'un établissement peut en compter des milliers. */
const LIMITE_REGISTRE = 500;

export async function lister(etablissementId, anneeScolaire, { groupe, matricule } = {}, acteur) {
  const filtre = { etablissementId, anneeScolaire };
  if (groupe) filtre.groupe = groupe;
  if (matricule) filtre.matricule = matricule;
  if (estFormateur(acteur)) filtre.formateurMatricule = acteur.identifiant;

  const [absences, total] = await Promise.all([
    AbsenceStagiaire.find(filtre).sort({ date: -1, seance: 1, nomComplet: 1 }).limit(LIMITE_REGISTRE).lean(),
    AbsenceStagiaire.countDocuments(filtre),
  ]);
  return { absences: absences.map(presenter), total, limite: LIMITE_REGISTRE };
}

export async function justifier(etablissementId, anneeScolaire, id, champs) {
  const absence = await AbsenceStagiaire.findOneAndUpdate(
    { _id: id, etablissementId, anneeScolaire },
    { $set: champs },
    { new: true }
  ).lean();
  if (!absence) throw notFound('Absence introuvable', { code: 'ABSENCE_INTROUVABLE' });
  return presenter(absence);
}

export async function supprimer(etablissementId, anneeScolaire, id) {
  const { deletedCount } = await AbsenceStagiaire.deleteOne({ _id: id, etablissementId, anneeScolaire });
  if (deletedCount === 0) throw notFound('Absence introuvable', { code: 'ABSENCE_INTROUVABLE' });
}
