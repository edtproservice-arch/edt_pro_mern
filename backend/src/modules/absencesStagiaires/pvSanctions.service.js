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
  const { stagiaire, sanction, palier } = situation;
  if (!typeDuPalier(palier) || !sanction) {
    throw badRequest('Ce stagiaire n’a pas de sanction d’assiduité à notifier par PV', { code: 'SANS_SANCTION_PV' });
  }

  const etablissement = await Etablissement.findById(etablissementId).select('nom nomAbrege complexe').lean();
  const docx = await construireDocxPvSanctions([donneesPv(situation, etablissement, anneeScolaire, langue)]);
  const tampon = format === 'pdf' ? await convertirDocxEnPdf(docx) : docx;

  await tracer(etablissementId, anneeScolaire, [situation], langue, acteurId);

  const base = `PV_${sanction.libelle.replace(/[^\p{L}\p{N}]+/gu, '_')}_${nomLatin(stagiaire).replace(/[^\p{L}\p{N}]+/gu, '_')}`;
  return { tampon, nomFichier: `${base}${langue === 'ar' ? '_AR' : ''}.${format}`, contentType: typeDeContenu(format) };
}

/**
 * ═══ TOUS LES PV EN ATTENTE, D'UN COUP (2026-10-26, demande du porteur) ═══
 * Ceux de la liste (`lister`, sans les déjà imprimés), un par page, dans UN seul document —
 * rangés par groupe puis par nom, pour la distribution. Tous sortent ensuite de la liste.
 */
export async function imprimerTous(etablissementId, anneeScolaire, { langue, format }, acteurId = null) {
  const concernes = (await situations(etablissementId, anneeScolaire)).filter(
    (s) => s.sanction && typeDuPalier(s.palier)
  );
  const deja = await PvSanction.find({
    etablissementId,
    anneeScolaire,
    matricule: { $in: concernes.map((s) => s.stagiaire.matricule) },
  })
    .select('matricule palier')
    .lean();
  const sortis = new Set(deja.map((pv) => `${pv.matricule}|${pv.palier}`));
  const aImprimer = concernes
    .filter((s) => !sortis.has(`${s.stagiaire.matricule}|${s.palier}`))
    .sort((a, b) => a.groupe.localeCompare(b.groupe, 'fr') || nomLatin(a.stagiaire).localeCompare(nomLatin(b.stagiaire), 'fr'));
  if (aImprimer.length === 0) throw badRequest('Aucun PV de sanction en attente', { code: 'AUCUN_PV_EN_ATTENTE' });

  const etablissement = await Etablissement.findById(etablissementId).select('nom nomAbrege complexe').lean();
  const docx = await construireDocxPvSanctions(aImprimer.map((s) => donneesPv(s, etablissement, anneeScolaire, langue)));
  const tampon = format === 'pdf' ? await convertirDocxEnPdf(docx) : docx;

  await tracer(etablissementId, anneeScolaire, aImprimer, langue, acteurId);

  return {
    tampon,
    nomFichier: `PV_sanctions_${aImprimer.length}${langue === 'ar' ? '_AR' : ''}.${format}`,
    contentType: typeDeContenu(format),
  };
}

/**
 * ═══ LES PV DE SANCTION DE LA PAGE DOCUMENTS (2026-10-26, demande du porteur) ═══
 * Section « Discipline » : les PV des stagiaires SANCTIONNÉS des groupes choisis (ou des seuls
 * stagiaires cochés), imprimés ou non — on y réimprime aussi. Les autres sont ignorés : un
 * stagiaire sans sanction d'assiduité n'a pas de PV.
 * VIERGE : un exemplaire de chaque PV — mise en garde, avertissement, blâme —, sans nom ni
 * case cochée, à remplir à la main. Aucune trace : personne n'est notifié.
 */
export async function imprimerDocuments(
  etablissementId,
  anneeScolaire,
  { langue, format, vierge = false, groupes = [], matricules = [] },
  acteurId = null
) {
  const etablissement = await Etablissement.findById(etablissementId).select('nom nomAbrege complexe').lean();
  const enTete = {
    complexe: etablissement?.complexe ?? '',
    efp: etablissement?.nomAbrege || etablissement?.nom || '',
    anneeScolaire,
  };

  if (vierge) {
    const docx = await construireDocxPvSanctions([1, 3, 5].map((palier) => ({ ...enTete, langue, palier, vierge: true })));
    return {
      tampon: format === 'pdf' ? await convertirDocxEnPdf(docx) : docx,
      nomFichier: `PV_sanctions_vierges${langue === 'ar' ? '_AR' : ''}.${format}`,
      contentType: typeDeContenu(format),
    };
  }

  const choisis = new Set(matricules);
  const dansLesGroupes = new Set(groupes);
  const aImprimer = (await situations(etablissementId, anneeScolaire))
    .filter((s) => s.sanction && typeDuPalier(s.palier))
    .filter(({ stagiaire, groupe }) =>
      choisis.size > 0
        ? choisis.has(stagiaire.matricule)
        : dansLesGroupes.has(groupe) || (stagiaire.groupes ?? []).some((g) => dansLesGroupes.has(g))
    )
    .sort((a, b) => a.groupe.localeCompare(b.groupe, 'fr') || nomLatin(a.stagiaire).localeCompare(nomLatin(b.stagiaire), 'fr'));
  if (aImprimer.length === 0) {
    throw badRequest('Aucun stagiaire sanctionné (mise en garde, avertissement ou blâme) dans cette sélection', {
      code: 'AUCUN_PV_SANCTION',
    });
  }

  const docx = await construireDocxPvSanctions(aImprimer.map((s) => donneesPv(s, etablissement, anneeScolaire, langue)));
  const tampon = format === 'pdf' ? await convertirDocxEnPdf(docx) : docx;
  await tracer(etablissementId, anneeScolaire, aImprimer, langue, acteurId);
  return {
    tampon,
    nomFichier: `PV_sanctions_${aImprimer.length}${langue === 'ar' ? '_AR' : ''}.${format}`,
    contentType: typeDeContenu(format),
  };
}

const typeDeContenu = (format) =>
  format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Ce que la page d'un PV affiche, d'après la situation d'un stagiaire. */
function donneesPv({ stagiaire, groupe, faits, points, palier }, etablissement, anneeScolaire, langue) {
  return {
    langue,
    palier,
    // « CFP : … / EFP : … » — l'ouverture des autres documents (le nom abrégé, comme eux).
    complexe: etablissement?.complexe ?? '',
    efp: etablissement?.nomAbrege || etablissement?.nom || '',
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
  };
}

/** La trace « PV sorti » — écrite APRÈS la construction du document, qui peut échouer. */
async function tracer(etablissementId, anneeScolaire, situationsImprimees, langue, acteurId) {
  const imprimeLe = new Date();
  await PvSanction.bulkWrite(
    situationsImprimees.map(({ stagiaire, palier, sanction }) => ({
      updateOne: {
        filter: { etablissementId, anneeScolaire, matricule: stagiaire.matricule, palier },
        update: { $set: { sanction: sanction.libelle, langue, imprimeLe, imprimePar: acteurId } },
        upsert: true,
      },
    }))
  );
}
