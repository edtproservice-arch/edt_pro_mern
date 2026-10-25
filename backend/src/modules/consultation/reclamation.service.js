import { ROLES } from 'shared/constants';
import { enJour, separerFusion } from 'shared/domain';
import { Etablissement } from '../../models/Etablissement.js';
import { Seance } from '../../models/Seance.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { User } from '../../models/User.js';
import { badRequest, forbidden, notFound } from '../../lib/httpError.js';
import * as horairesService from '../horaires/horaires.service.js';
import { construireFeuillePresence } from '../absencesStagiaires/exportFeuillePresence.service.js';
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

/** La séance `id`, à condition qu'elle soit la sienne. */
async function saSeance(etablissementId, anneeScolaire, matricule, id) {
  const seance = await Seance.findOne({ _id: id, etablissementId, anneeScolaire }).lean();
  if (!seance) throw notFound('Séance introuvable', { code: 'SEANCE_INTROUVABLE' });
  if (String(seance.formateurMatricule ?? '').trim() !== String(matricule).trim()) {
    throw forbidden('Cette séance n’est pas la vôtre', { code: 'SEANCE_ETRANGERE' });
  }
  return seance;
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
 * @param {{ matricule: string, nomComplet: string }} formateur — le compte connecté, jamais la requête
 */
async function preparer(etablissementId, anneeScolaire, formateur, demande) {
  const seance = await saSeance(etablissementId, anneeScolaire, formateur.matricule, demande.seanceId);
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
      formateur: formateur.nomComplet,
      matriculeFormateur: formateur.matricule,
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
