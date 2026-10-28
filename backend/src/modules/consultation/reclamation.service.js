import { ROLES } from 'shared/constants';
import { anneeDuNomGroupe, enJour, separerFusion } from 'shared/domain';
import { Base } from '../../models/Base.js';
import { Etablissement } from '../../models/Etablissement.js';
import { cleGroupeModule, intitulesParGroupe } from '../../lib/intitulesModules.js';
import { Seance } from '../../models/Seance.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { User } from '../../models/User.js';
import { badRequest, forbidden, notFound } from '../../lib/httpError.js';
import * as horairesService from '../horaires/horaires.service.js';
import { construireFeuillePresence } from '../absencesStagiaires/exportFeuillePresence.service.js';
import { construireDocxEnteteExamen } from '../absencesStagiaires/exportEnteteExamenDocx.js';
import { convertirDocxEnPdf } from '../seances/libreOffice.js';
import { envoyer as envoyerMessage } from '../messagerie/messagerie.service.js';

/**
 * ═══ LA FICHE DE RÉCLAMATION, REMPLIE PAR LE FORMATEUR (2026-10-25, demande du
 * porteur) ═══ Depuis « Mes documents » : il choisit UNE de ses séances dans son
 * emploi du temps — elle donne la date, l'heure et le lieu —, un ou plusieurs stagiaires de ce cours,
 * puis saisit l'action non disciplinaire et les dégâts immobiliers. La partie
 * « Surveillant » (journées d'absence, autres sanctions) se remplit d'office
 * depuis le dossier du stagiaire. Une fiche par stagiaire.
 *
 * ⚠️ TOUT SE VÉRIFIE ICI, PAS À L'ÉCRAN : la séance doit être la sienne, les
 *    stagiaires ceux de son groupe. Le formateur ne voit ni ne remplit la fiche
 *    d'un cours qu'il n'a pas donné.
 *
 * ═══ ET POUR LA DIRECTION (2026-10-26, demande du porteur : « les mêmes options
 * pour le gestionnaire et le directeur, en page Documents ») ═══ Les mêmes
 * fonctions, avec `matricule` à `null` : toute séance DE L'ÉTABLISSEMENT est
 * admise, et c'est son FORMATEUR — pas le compte connecté — que la fiche nomme.
 * ⚠️ `null` n'est passé que par les routes réservées à l'encadrement ; celles du
 *    formateur passent toujours SON matricule, tiré du jeton.
 */

/** « 14/10/2026 » depuis « 2026-10-14 ». */
const dateFr = (iso) => String(iso ?? '').split('-').reverse().join('/');

/** Une séance avec son horaire en vigueur — ce que la fiche écrit en « Date & Heure » et « Lieu ». */
function presenter(seance, horaires) {
  const jeu = seance.jour === 'Vendredi' ? horaires?.vendredi : horaires?.semaine;
  const plage = jeu?.[seance.seance] ?? null;
  const date = seance.date ? enJour(seance.date) : '';
  return {
    id: String(seance._id),
    date,
    dateFr: dateFr(date),
    jour: seance.jour,
    seance: seance.seance,
    debut: plage?.debut ?? '',
    fin: plage?.fin ?? '',
    groupe: seance.groupe,
    module: seance.module,
    salle: seance.salle ?? '',
  };
}

/**
 * La séance `id` de l'établissement — et, quand `matricule` est donné, à condition
 * qu'elle soit celle de ce formateur. `null` : l'encadrement, toute séance admise.
 */
async function saSeance(etablissementId, anneeScolaire, matricule, id) {
  const seance = await Seance.findOne({ _id: id, etablissementId, anneeScolaire }).lean();
  if (!seance) throw notFound('Séance introuvable', { code: 'SEANCE_INTROUVABLE' });
  if (matricule !== null && String(seance.formateurMatricule ?? '').trim() !== String(matricule).trim()) {
    throw forbidden('Cette séance n’est pas la vôtre', { code: 'SEANCE_ETRANGERE' });
  }
  return seance;
}

/** Le formateur d'une séance, pour la fiche que l'encadrement remplit : son nom tiré de la base. */
async function formateurDeLaSeance(etablissementId, anneeScolaire, seance) {
  const matricule = String(seance.formateurMatricule ?? '').trim();
  const base = await Base.findOne({ etablissementId, anneeScolaire }).select('formateurs').lean();
  const fiche = (base?.formateurs ?? []).find((f) => String(f.matricule ?? '').trim() === matricule);
  return { matricule, nomComplet: fiche?.nomComplet || matricule };
}

/**
 * ═══ UNE DE SES SÉANCES, PRÊTE À ÉCRIRE SUR UN DOCUMENT (2026-10-26) ═══
 * Pour la feuille de présence CC/EFM : la date, l'horaire en vigueur, les groupes
 * d'un cours fusionné, et l'INTITULÉ du module dans la filière du groupe — la
 * feuille a une case « Intitulé du module », un code seul n'y suffit pas.
 */
export async function seanceAvecIntitule(etablissementId, anneeScolaire, matricule, id) {
  const seance = await saSeance(etablissementId, anneeScolaire, matricule, id);
  const [{ courant }, base] = await Promise.all([
    horairesService.obtenir(),
    Base.findOne({ etablissementId, anneeScolaire }).select('affectations groupes groupeFilieres').lean(),
  ]);
  const intitules = base
    ? await intitulesParGroupe(base, [{ groupe: seance.groupe, module: seance.module }])
    : new Map();
  return {
    ...presenter(seance, courant),
    groupes: separerFusion(seance.groupe),
    intitule: intitules.get(cleGroupeModule(seance.groupe, seance.module)) ?? '',
  };
}

/**
 * Les stagiaires du cours — de CHAQUE groupe d'un cours fusionné (« GM101+GM102 »),
 * chacun avec le groupe sous lequel la fiche le nommera.
 */
export async function stagiairesDeLaSeance(etablissementId, anneeScolaire, matricule, id) {
  const seance = await saSeance(etablissementId, anneeScolaire, matricule, id);
  const groupes = separerFusion(seance.groupe);
  const stagiaires = await Stagiaire.find({ etablissementId, anneeScolaire, groupes: { $in: groupes } })
    .select('matricule nom prenom groupes')
    .sort({ nom: 1, prenom: 1 })
    .lean();
  return stagiaires.map((s) => ({
    matricule: s.matricule,
    nom: [s.nom, s.prenom].filter(Boolean).join(' ').trim() || s.matricule,
    groupe: groupes.find((groupe) => (s.groupes ?? []).includes(groupe)) ?? groupes[0],
  }));
}

/**
 * Ce que la fiche écrit — vérifié une fois, que le formateur la TÉLÉCHARGE ou
 * l'ENVOIE : séance à lui, stagiaires de son cours.
 *
 * @param {{ matricule: string, nomComplet: string } | null} formateur — le compte connecté, jamais la
 *   requête ; `null` pour l'encadrement : le formateur de la séance.
 */
async function preparer(etablissementId, anneeScolaire, formateur, demande) {
  const seance = await saSeance(etablissementId, anneeScolaire, formateur?.matricule ?? null, demande.seanceId);
  const nomme = formateur ?? (await formateurDeLaSeance(etablissementId, anneeScolaire, seance));
  const groupes = separerFusion(seance.groupe);

  const voulus = [...new Set(demande.matricules)];
  const stagiaires = await Stagiaire.find({
    etablissementId,
    anneeScolaire,
    groupes: { $in: groupes },
    matricule: { $in: voulus },
  })
    .select('matricule nom prenom')
    .sort({ nom: 1, prenom: 1 })
    .lean();
  if (stagiaires.length !== voulus.length) {
    const connus = new Set(stagiaires.map((s) => s.matricule));
    throw badRequest('Ces stagiaires ne sont pas de ce cours', {
      code: 'STAGIAIRE_ETRANGER',
      details: { matricules: voulus.filter((m) => !connus.has(m)) },
    });
  }

  const { courant } = await horairesService.obtenir();
  const s = presenter(seance, courant);
  const heure = s.debut ? `, ${s.debut} – ${s.fin}` : '';

  return {
    groupes,
    matricules: voulus,
    stagiaires: stagiaires.map((st) => [st.nom, st.prenom].filter(Boolean).join(' ').trim() || st.matricule),
    contenu: {
      dateHeure: `${s.jour} ${s.dateFr}${heure} (${s.seance})`,
      lieu: s.salle,
      formateur: nomme.nomComplet,
      matriculeFormateur: nomme.matricule,
      actionNonDisciplinaire: demande.actionNonDisciplinaire ?? '',
      degats: demande.degats ?? '',
    },
  };
}

/** La fiche, une page par stagiaire. */
export async function ficheReclamation(etablissementId, anneeScolaire, formateur, demande) {
  const fiche = await preparer(etablissementId, anneeScolaire, formateur, demande);
  return construireFeuillePresence(etablissementId, anneeScolaire, 'reclamation', {
    format: demande.format,
    groupes: fiche.groupes,
    matricules: fiche.matricules,
    reclamation: fiche.contenu,
  });
}

/**
 * La feuille de présence CC/EFM d'une séance (2026-10-26) : la séance donne le
 * groupe, le module et son intitulé, la date et l'horaire ; `epreuve` dit les
 * cases à cocher — voir `completerPresenceCcEfm`.
 *
 * @param {string | null} matricule — le formateur connecté, ou `null` pour l'encadrement
 */
export async function feuilleCcEfmDeSeance(etablissementId, anneeScolaire, matricule, { format, seanceId, epreuve }) {
  const seance = await seanceAvecIntitule(etablissementId, anneeScolaire, matricule, seanceId);
  return construireFeuillePresence(etablissementId, anneeScolaire, 'cc-efm', {
    format,
    groupes: seance.groupes,
    examen: {
      ...(epreuve ?? {}),
      // L'intitulé SEUL, sans le code (2026-10-26, demande du porteur) ; le code ne sert qu'à défaut d'intitulé.
      module: seance.intitule || seance.module,
      date: `${seance.jour} ${seance.dateFr}`,
      debut: seance.debut,
      fin: seance.fin,
    },
  });
}

/**
 * ═══ L'EN-TÊTE D'UNE ÉPREUVE, DEPUIS UNE SÉANCE (2026-10-26, demande du porteur) ═══
 * Contrôle continu ou EFM : la séance — la sienne, vérifiée — donne la filière et le niveau
 * (ceux des stagiaires du groupe), l'année, le module, son intitulé et la date ; le formateur
 * choisit le reste (n° du contrôle ou portée de l'EFM, épreuve, durée — le barème suit l'épreuve). Sans séance :
 * l'exemplaire VIERGE, seul l'établissement écrit. Nom, groupe et V restent toujours vides —
 * voir `exportEnteteExamenDocx.js`.
 *
 * @param {string | null} matricule — le formateur connecté, ou `null` pour l'encadrement
 */
export async function enteteExamenDeSeance(
  etablissementId,
  anneeScolaire,
  matricule,
  { type, seanceId = null, numero, portee, epreuve, duree }
) {
  const etablissement = await Etablissement.findById(etablissementId).select('nom nomAbrege complexe region').lean();
  const contenu = {
    type,
    numero,
    portee,
    epreuve,
    duree,
    anneeScolaire,
    complexe: etablissement?.complexe ?? '',
    efp: etablissement?.nomAbrege || etablissement?.nom || '',
    region: etablissement?.region ?? '',
  };

  let groupe = '';
  if (seanceId) {
    const seance = await seanceAvecIntitule(etablissementId, anneeScolaire, matricule, seanceId);
    // La filière et le niveau : ceux des stagiaires du groupe (d'un cours fusionné, le premier qui en a).
    const stagiaire = await Stagiaire.findOne({ etablissementId, anneeScolaire, groupes: { $in: seance.groupes } })
      .select('filiere niveau')
      .lean();
    groupe = seance.groupes[0] ?? '';
    Object.assign(contenu, {
      filiere: stagiaire?.filiere ?? '',
      niveau: String(stagiaire?.niveau ?? '').trim().toUpperCase(),
      annee: groupe ? anneeDuNomGroupe(groupe) : null,
      module: seance.module,
      intitule: seance.intitule,
      date: seance.dateFr,
    });
  }

  const docx = await construireDocxEnteteExamen(contenu);
  const titre = type === 'efm' ? 'EFM' : `Controle${numero ? `_${numero}` : ''}`;
  const suite = seanceId ? [groupe, contenu.module].filter(Boolean).join('_') : 'vierge';
  return {
    // Word seulement (2026-10-28, demande du porteur) : le sujet s'écrit sous l'en-tête.
    tampon: docx,
    nomFichier: `${titre}_${suite}`.replace(/[^\p{L}\p{N}]+/gu, '_') + '.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}

/**
 * ═══ ENVOYER LA FICHE AU DIRECTEUR ET AUX GESTIONNAIRES (2026-10-26, demande
 * du porteur) ═══ Par la messagerie, la fiche jointe pour impression : la
 * direction la reçoit, l'imprime depuis le message (`imprimerReclamation`).
 *
 * Les destinataires : le directeur — le propriétaire de l'établissement — et
 * chaque gestionnaire ACTIF de l'établissement. Ni l'un ni l'autre : refusé,
 * plutôt qu'un envoi annoncé réussi que personne ne recevra.
 *
 * @param {{ id: string, matricule: string, nomComplet: string }} formateur
 */
export async function envoyerReclamation(etablissementId, anneeScolaire, formateur, demande) {
  const fiche = await preparer(etablissementId, anneeScolaire, formateur, demande);

  const [etablissement, gestionnaires] = await Promise.all([
    Etablissement.findById(etablissementId).select('proprietaireId').lean(),
    User.find({ role: ROLES.GESTIONNAIRE, etablissementIds: etablissementId, estActif: true }).select('_id').lean(),
  ]);
  const destinataires = [
    ...new Set([etablissement?.proprietaireId, ...gestionnaires.map((g) => g._id)].filter(Boolean).map(String)),
  ];
  if (destinataires.length === 0) {
    throw badRequest('Aucun directeur ni gestionnaire à qui envoyer la fiche', { code: 'SANS_DESTINATAIRE' });
  }

  const { contenu } = fiche;
  const lignes = [
    `Fiche de réclamation de ${contenu.formateur} — séance du ${contenu.dateHeure}${contenu.lieu ? `, ${contenu.lieu}` : ''}.`,
    `Stagiaire(s) : ${fiche.stagiaires.join(', ')} (${fiche.groupes.join(', ')}).`,
    contenu.actionNonDisciplinaire && `Action non disciplinaire : ${contenu.actionNonDisciplinaire}`,
    contenu.degats && `Dégâts immobiliers : ${contenu.degats}`,
    'La fiche est jointe : imprimez-la depuis ce message.',
  ].filter(Boolean);

  return envoyerMessage(formateur.id, {
    destinataires,
    sujet: `Fiche de réclamation — ${fiche.groupes.join(', ')} — ${contenu.dateHeure}`,
    corps: lignes.join('\n\n'),
    reclamation: { etablissementId: String(etablissementId), anneeScolaire, ...fiche },
  });
}
