import mongoose from 'mongoose';
import { TYPES_ABSENCE } from 'shared/constants';
import { anneeDuNomGroupe, dureeSeance, noteDiscipline } from 'shared/domain';
import { AbsenceStagiaire } from '../../models/AbsenceStagiaire.js';
import { Etablissement } from '../../models/Etablissement.js';
import { IndisciplineStagiaire } from '../../models/IndisciplineStagiaire.js';
import { PvSanction } from '../../models/PvSanction.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { badRequest, notFound } from '../../lib/httpError.js';
import { convertirDocxEnPdf } from '../seances/libreOffice.js';
import { construireDocxPvSanctions, typeDuPalier } from './exportPvSanctionDocx.js';

/**
 * ═══ LES PV DES SANCTIONS D'ASSIDUITÉ (2026-10-26, demande du porteur) ═══
 * La liste des stagiaires dont la sanction d'assiduité ACTUELLE — 1ère ou 2ème mise
 * en garde, 1er ou 2ème avertissement, blâme : de 1 à 5 points retirés — n'a pas
 * encore son PV ; un bouton « Imprimer » par stagiaire ; une fois imprimé, il sort de
 * la liste (`PvSanction`), jusqu'au palier suivant.
 *
 * ⚠️ LA MÊME NOTE QUE « NOTES DE DISCIPLINE » : `noteDiscipline` du domaine, sur les
 *    absences et retards NON JUSTIFIÉS et les indisciplines de l'année — un stagiaire
 *    ne peut pas être sanctionné ici et pas là.
 * ⚠️ L'ASSIDUITÉ SEULE : le canevas parle de « غيابه المتكرر » (ses absences répétées).
 *    Au-delà de 5 points (exclusion), c'est le PV du conseil de discipline.
 */

/** Les faits de discipline des stagiaires de l'année (tous, ou un seul `matricule`). */
async function situations(etablissementId, anneeScolaire, { matricule = null } = {}) {
  const stagiaires = await Stagiaire.find({
    etablissementId,
    anneeScolaire,
    ...(matricule && { matricule }),
  })
    .select('matricule nom prenom nomArabe prenomArabe groupes groupePrincipal filiere niveau')
    .sort({ nom: 1, prenom: 1 })
    .lean();
  if (stagiaires.length === 0) return [];

  const matricules = stagiaires.map((s) => s.matricule);
  const correspondance = { etablissementId, anneeScolaire, matricule: { $in: matricules } };
  const [absences, indisciplines] = await Promise.all([
    AbsenceStagiaire.find(correspondance).select('matricule typeAbsence justifiee seance').lean(),
    IndisciplineStagiaire.aggregate([
      {
        $match: {
          etablissementId: new mongoose.Types.ObjectId(String(etablissementId)),
          anneeScolaire: Number(anneeScolaire),
          matricule: { $in: matricules },
        },
      },
      { $group: { _id: '$matricule', n: { $sum: 1 } } },
    ]),
  ]);

  const faits = new Map(matricules.map((m) => [m, { absencesNJ: 0, retardsNJ: 0, heuresNJ: 0, indisciplines: 0 }]));
  for (const a of absences) {
    const f = faits.get(a.matricule);
    if (!f || a.justifiee) continue;
    if (a.typeAbsence === TYPES_ABSENCE.RETARD) {
      f.retardsNJ += 1;
    } else {
      f.absencesNJ += 1;
      f.heuresNJ += dureeSeance(a.seance);
    }
  }
  for (const { _id, n } of indisciplines) {
    const f = faits.get(_id);
    if (f) f.indisciplines = n;
  }

  return stagiaires.map((s) => {
    const f = faits.get(s.matricule);
    const groupe = s.groupePrincipal || s.groupes?.[0] || '';
    const note = noteDiscipline({
      seancesAbsentes: f.absencesNJ,
      retards: f.retardsNJ,
      indisciplines: f.indisciplines,
    });
    const points = note.assiduite.pointsRetires;
    // Le palier de la grille : les points retirés, entiers — la règle de `sanctionAssiduite`.
    const palier = Math.floor(Math.round(points * 4) / 4);
    return { stagiaire: s, groupe, faits: f, sanction: note.assiduite.sanction, points, palier };
  });
}

const nomLatin = (s) => [s.nom, s.prenom].filter(Boolean).join(' ').trim() || s.matricule;
const nomArabe = (s) => [s.nomArabe, s.prenomArabe].filter(Boolean).join(' ').trim();

/**
 * La liste « PV de sanction ».
 *
 * @param {{ imprimes?: boolean }} options — `imprimes` : inclure aussi ceux dont le PV
 *   du palier actuel est déjà sorti (pour réimprimer), marqués comme tels.
 */
export async function lister(etablissementId, anneeScolaire, { imprimes = false } = {}) {
  const concernes = (await situations(etablissementId, anneeScolaire)).filter(
    (s) => s.palier >= 1 && s.palier <= 5 && s.sanction
  );
  const deja = await PvSanction.find({
    etablissementId,
    anneeScolaire,
    matricule: { $in: concernes.map((s) => s.stagiaire.matricule) },
  })
    .select('matricule palier imprimeLe langue')
    .lean();
  const parCle = new Map(deja.map((pv) => [`${pv.matricule}|${pv.palier}`, pv]));

  return concernes
    .map(({ stagiaire, groupe, faits, sanction, points, palier }) => {
      const pv = parCle.get(`${stagiaire.matricule}|${palier}`);
      return {
        matricule: stagiaire.matricule,
        nom: nomLatin(stagiaire),
        groupe,
        palier,
        sanction,
        points,
        absencesNJ: faits.absencesNJ,
        retardsNJ: faits.retardsNJ,
        heuresNJ: faits.heuresNJ,
        imprime: pv ? { le: pv.imprimeLe, langue: pv.langue } : null,
      };
    })
    .filter((ligne) => imprimes || !ligne.imprime);
}

/** « 26/10/2026 » — la date d'impression, en heure locale. */
function aujourdhui(maintenant = new Date()) {
  const deux = (n) => String(n).padStart(2, '0');
  return `${deux(maintenant.getDate())}/${deux(maintenant.getMonth() + 1)}/${maintenant.getFullYear()}`;
}

/**
 * Le PV du palier ACTUEL d'un stagiaire, en français ou en arabe — et la trace qu'il
 * est sorti, ce qui le retire de la liste. La trace n'est écrite qu'une fois le
 * document construit : un PDF qui échoue ne fait pas disparaître le stagiaire.
 */
export async function imprimer(etablissementId, anneeScolaire, matricule, { langue, format }, acteurId = null) {
  const [situation] = await situations(etablissementId, anneeScolaire, { matricule });
  if (!situation) throw notFound('Stagiaire introuvable', { code: 'STAGIAIRE_INCONNU' });
  const { stagiaire, groupe, faits, sanction, points, palier } = situation;
  if (!typeDuPalier(palier) || !sanction) {
    throw badRequest('Ce stagiaire n’a pas de sanction d’assiduité à notifier par PV', { code: 'SANS_SANCTION_PV' });
  }

  const etablissement = await Etablissement.findById(etablissementId).select('nom nomAbrege').lean();
  const docx = await construireDocxPvSanctions([
    {
      langue,
      palier,
      etablissement: etablissement?.nom ?? '',
      anneeScolaire,
      date: aujourdhui(),
      heures: faits.heuresNJ,
      points,
      // En arabe, le nom arabe de Konosys quand il existe ; sinon le nom latin.
      nom: (langue === 'ar' && nomArabe(stagiaire)) || nomLatin(stagiaire),
      matricule: stagiaire.matricule,
      filiere: stagiaire.filiere ?? '',
      niveau: String(stagiaire.niveau ?? '').trim().toUpperCase(),
      anneeFormation: groupe ? anneeDuNomGroupe(groupe) : null,
      groupe,
    },
  ]);
  const tampon = format === 'pdf' ? await convertirDocxEnPdf(docx) : docx;

  await PvSanction.findOneAndUpdate(
    { etablissementId, anneeScolaire, matricule, palier },
    { $set: { sanction: sanction.libelle, langue, imprimeLe: new Date(), imprimePar: acteurId } },
    { upsert: true }
  );

  const base = `PV_${sanction.libelle.replace(/[^\p{L}\p{N}]+/gu, '_')}_${nomLatin(stagiaire).replace(/[^\p{L}\p{N}]+/gu, '_')}`;
  return {
    tampon,
    nomFichier: `${base}${langue === 'ar' ? '_AR' : ''}.${format}`,
    contentType:
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}
