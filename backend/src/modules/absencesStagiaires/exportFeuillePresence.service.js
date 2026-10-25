import mongoose from 'mongoose';
import { TYPES_ABSENCE } from 'shared/constants';
import { AbsenceStagiaire } from '../../models/AbsenceStagiaire.js';
import { Base } from '../../models/Base.js';
import { Etablissement } from '../../models/Etablissement.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { User } from '../../models/User.js';
import { anneeDuNomGroupe } from 'shared/domain';
import { badRequest } from '../../lib/httpError.js';
import { IndisciplineStagiaire } from '../../models/IndisciplineStagiaire.js';
import { notesDesGroupes } from './discipline.service.js';
import { MODELES, construireDocxFeuillePresence, construirePdfFeuillePresence } from './exportFeuillePresenceDocx.js';

/**
 * Une feuille de présence d'épreuve — EFF ou contrôle continu / EFM — ou la
 * liste des stagiaires, pour un ou plusieurs groupes, en Word ou PDF
 * (2026-10-02, demandes du porteur, canevas transmis). Depuis la page
 * Documents, comme la feuille d'absence hebdomadaire. Une page par groupe ;
 * voir `exportFeuillePresenceDocx.js`.
 *
 * ⚠️ « FILIÈRE » ET « GROUPE » VIENNENT DU NOM DU GROUPE, pas de
 * `Stagiaire.filiere` : les canevas écrivent « DEVOWFS » | « 201 » pour le
 * groupe DEVOWFS201, quand `filiere` porte l'intitulé complet (« Génie
 * Mécanique option… ») qui ne tiendrait pas dans la case. Un nom qui ne suit
 * pas le modèle lettres + numéro garde l'intitulé et le nom entier.
 *
 * ⚠️ L'ÉTABLISSEMENT EST LE NOM ABRÉGÉ (« ISTA BEN M'SIK »), comme « CFP MGD
 * HASSANIA » sur les canevas : le nom complet déborderait.
 *
 * @param {'eff' | 'cc-efm' | 'liste' | 'badges-sans' | 'badges-infos' | 'checklist' | 'verification' | 'retrait-definitif' | 'retrait-provisoire' | 'attestation-poursuite' | 'convention' | 'convocation-eff' | 'transfert' | 'pv-discipline' | 'reclamation' | 'duplicata' | 'reorientation' | 'soins'} cleModele
 * @param {{format, groupes, examen?: {date?, debut?, fin?, epreuve?}, reclamation?: object}} options — `examen` : la
 *   convocation à l'EFF ; `reclamation` : la fiche remplie par le formateur (séance, saisies — 2026-10-25)
 */
export async function construireFeuillePresence(
  etablissementId,
  anneeScolaire,
  cleModele,
  { format, groupes: demandes, examen = null, matricules = null, reclamation = null }
) {
  const modele = MODELES[cleModele];
  if (!modele) throw badRequest(`Feuille de présence « ${cleModele} » inconnue`, { code: 'MODELE_INCONNU' });

  /*
   * ⚠️ UN DOCUMENT RÉSERVÉ À CERTAINES ANNÉES (la convocation à l'EFF : 2ᵉ et 3ᵉ
   * année, 2026-10-11) : les groupes d'une année plus basse sont écartés ICI, pas
   * seulement par la fenêtre — une requête directe ne doit pas convoquer une 1ʳᵉ
   * année à un examen de fin de formation.
   */
  const groupesDeLAnnee = modele.anneeMinimale
    ? demandes.filter((groupe) => anneeDuNomGroupe(groupe) >= modele.anneeMinimale)
    : demandes;
  if (groupesDeLAnnee.length === 0) {
    throw badRequest(`Ce document ne concerne que les groupes de ${modele.anneeMinimale}e année et au-delà`, {
      code: 'ANNEE_NON_CONCERNEE',
    });
  }

  const etablissement = await Etablissement.findById(etablissementId)
    .select('nom nomAbrege region complexe stages proprietaireId')
    .lean();

  /*
   * ⚠️ LA CONVENTION DE STAGE NE CONCERNE QUE LES GROUPES AYANT UNE PÉRIODE DE
   * STAGE (2026-10-11, demande du porteur) — même règle que la fenêtre, tenue ici
   * pour une requête directe : une convention sans dates ne sert à rien.
   */
  const avecStage = new Set((etablissement?.stages ?? []).map((stage) => stage.groupe));
  const groupes = modele.exigeStage ? groupesDeLAnnee.filter((groupe) => avecStage.has(groupe)) : groupesDeLAnnee;
  if (groupes.length === 0) {
    throw badRequest('Aucun des groupes demandés n’a de période de stage — déclarez-la dans Paramètres → Stages', {
      code: 'SANS_PERIODE_DE_STAGE',
    });
  }

  const [stagiaires, base] = await Promise.all([
    Stagiaire.find({ etablissementId, anneeScolaire, groupes: { $in: groupes } })
      .select(
        'matricule nom prenom nomArabe prenomArabe cin dateNaissance lieuNaissance dateInscription niveauScolaire telephone filiere niveau annee groupes'
      )
      .sort({ nom: 1, prenom: 1 })
      .lean(),
    // Le mode du groupe (Alterné / Résidentiel), que porte la carte — pour l'attestation de poursuite.
    Base.findOne({ etablissementId, anneeScolaire }).select('groupeModes').lean(),
  ]);

  // Le directeur — le propriétaire de l'établissement —, nommé sur la convention de stage.
  const directeur = etablissement?.proprietaireId
    ? await User.findById(etablissement.proprietaireId).select('nomComplet').lean()
    : null;

  const feuilles = groupes
    .map((groupe) => {
      const liste = stagiaires.filter((s) => (s.groupes ?? []).includes(groupe));
      if (liste.length === 0) return null;
      const decoupe = /^([A-Za-z]+)(\d.*)$/.exec(groupe);
      return {
        ...champsEtablissement(etablissement, directeur),
        groupe,
        anneeScolaire,
        examen,
        mode: base?.groupeModes?.[groupe] ?? '',
        /* La période de stage du groupe (Paramètres → Stages) ; s'il en a
           plusieurs, la DERNIÈRE — celle de fin de formation. */
        stage:
          (etablissement?.stages ?? [])
            .filter((periode) => periode.groupe === groupe && periode.debut && periode.fin)
            .sort((a, b) => a.fin.localeCompare(b.fin))
            .at(-1) ?? null,
        filiere: decoupe ? decoupe[1] : liste[0].filiere ?? '',
        numero: decoupe ? decoupe[2] : groupe,
        niveau: liste.find((s) => s.niveau)?.niveau ?? '',
        effectif: String(liste.length),
        stagiaires: liste.map((s, index) => ({
          /* Le rang dans la liste COMPLÈTE du groupe, fixé avant tout filtre par
             stagiaire : un badge de table réimprimé seul garde son numéro (2026-10-17). */
          rang: index + 1,
          matricule: s.matricule,
          nom: s.nom ?? '',
          prenom: s.prenom ?? '',
          niveau: s.niveau ?? '',
          annee: s.annee ?? '',
          filiereLibelle: s.filiere ?? '',
          cin: s.cin ?? '',
          nomArabe: s.nomArabe ?? '',
          prenomArabe: s.prenomArabe ?? '',
          // Konosys donne « 06/10/2007 00:00:00 » : la date seule.
          dateNaissance: String(s.dateNaissance ?? '').split(' ')[0],
          lieuNaissance: s.lieuNaissance ?? '',
          dateInscription: String(s.dateInscription ?? '').split(' ')[0],
          // Le niveau d'études à l'entrée — le formulaire de transfert le demande (2026-10-11).
          niveauScolaire: s.niveauScolaire ?? '',
          // Le téléphone de Konosys — le PV du conseil de discipline le demande (2026-10-11).
          telephone: s.telephone ?? '',
        })),
      };
    })
    .filter(Boolean);

  if (feuilles.length === 0) {
    throw badRequest('Aucun stagiaire dans les groupes demandés', { code: 'GROUPE_VIDE' });
  }

  /*
   * `matricules` : seulement ces stagiaires (2026-10-11 — le PV d'UN stagiaire
   * depuis « Notes de discipline »). ⚠️ DEMANDÉ NOMMÉMENT, le PV sort même sans
   * sanction du conseil : c'est la direction qui décide de l'y traduire (le
   * canevas prévoit « Autre (à préciser) »). Par groupes, seuls ceux qui en
   * relèvent restent.
   */
  if (matricules?.length) {
    const voulus = new Set(matricules);
    for (const feuille of feuilles) feuille.stagiaires = feuille.stagiaires.filter((s) => voulus.has(s.matricule));
    for (let i = feuilles.length - 1; i >= 0; i -= 1) if (feuilles[i].stagiaires.length === 0) feuilles.splice(i, 1);
    if (feuilles.length === 0) {
      throw badRequest('Ces stagiaires ne figurent pas dans les groupes demandés', { code: 'GROUPE_VIDE' });
    }
  }

  if (modele.exigeConseil) {
    await garderCeuxDuConseil(etablissementId, anneeScolaire, feuilles, { tous: Boolean(matricules?.length) });
    if (feuilles.length === 0) {
      throw badRequest('Aucun stagiaire de ces groupes ne relève du conseil de discipline', { code: 'AUCUN_CONSEIL' });
    }
  }

  /*
   * La fiche de réclamation REMPLIE par le formateur (2026-10-25) : la même pour
   * chaque page, et la partie surveillant tirée du dossier de chaque stagiaire.
   */
  if (reclamation) {
    await ajouterDonneesSurveillant(etablissementId, anneeScolaire, feuilles);
    for (const feuille of feuilles) feuille.reclamation = reclamation;
  }

  // `nommes` : des stagiaires demandés nommément — la fiche de réclamation sort alors une page par stagiaire.
  const donnees = { anneeScolaire, feuilles, nommes: Boolean(matricules?.length) };
  const nomFichier =
    feuilles.length === 1
      ? `Feuille_${modele.nomFichier}_${feuilles[0].groupe}`
      : `Feuilles_${modele.nomFichier}_${feuilles.length}_groupes`;

  if (format === 'docx') {
    return {
      tampon: await construireDocxFeuillePresence(modele, donnees),
      nomFichier: `${nomFichier}.docx`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  return {
    tampon: await construirePdfFeuillePresence(modele, donnees),
    nomFichier: `${nomFichier}.pdf`,
    contentType: 'application/pdf',
  };
}

/**
 * ═══ LE PV DU CONSEIL DE DISCIPLINE NE CONCERNE QUE CEUX QUI EN RELÈVENT
 * (2026-10-11) ═══ Un stagiaire est traduit devant le conseil quand sa sanction
 * d'assiduité OU de comportement est de son autorité (« CD » : blâme, exclusion…)
 * — la même note que l'onglet « Notes de discipline » (`notesDesGroupes`). Les
 * autres sont retirés des feuilles, et une feuille vidée disparaît.
 *
 * Chaque stagiaire retenu reçoit ses FAITS, écrits sur la ligne « en raison de » :
 * séances d'absence et retards non justifiés, puis ses indisciplines datées.
 */
async function garderCeuxDuConseil(etablissementId, anneeScolaire, feuilles, { tous = false } = {}) {
  const notes = await notesDesGroupes(etablissementId, anneeScolaire, feuilles.map((f) => f.groupe));
  const parMatricule = new Map(notes.flatMap((g) => g.stagiaires).map((s) => [s.matricule, s]));
  const indisciplines = await IndisciplineStagiaire.find({
    etablissementId,
    anneeScolaire,
    matricule: { $in: [...parMatricule.keys()] },
  })
    .sort({ date: 1, createdAt: 1 })
    .select('matricule date motif')
    .lean();

  const dateFr = (iso) => String(iso ?? '').slice(0, 10).split('-').reverse().join('/');
  for (const feuille of feuilles) {
    feuille.stagiaires = feuille.stagiaires
      .map((stagiaire) => {
        const note = parMatricule.get(stagiaire.matricule);
        const conseilAbsence = note?.note?.assiduite?.sanction?.autorite === 'CD';
        const conseilConduite = note?.note?.comportement?.sanction?.autorite === 'CD';
        if (!conseilAbsence && !conseilConduite && !tous) return null;
        const siens = indisciplines.filter((i) => i.matricule === stagiaire.matricule);
        const faits = [
          note?.absencesNJ ? `${note.absencesNJ} séance(s) d'absence non justifiée(s)` : '',
          note?.retardsNJ ? `${note.retardsNJ} retard(s) non justifié(s)` : '',
          siens.length ? `${siens.length} indiscipline(s) : ${siens.map((i) => `${i.motif} (${dateFr(i.date)})`).join(' ; ')}` : '',
        ]
          .filter(Boolean)
          .join(' ; ');
        return { ...stagiaire, conseilAbsence, conseilConduite, faits };
      })
      .filter(Boolean);
  }
  for (let i = feuilles.length - 1; i >= 0; i -= 1) if (feuilles[i].stagiaires.length === 0) feuilles.splice(i, 1);
}

/**
 * ═══ LA PARTIE « SURVEILLANT » DE LA FICHE DE RÉCLAMATION, REMPLIE D'OFFICE
 * (2026-10-25, demande du porteur) ═══
 *   - « Absence : … Jr » : les JOURNÉES d'absence de l'année, JUSTIFIÉES
 *     COMPRISES mais SÉPARÉES (décisions du porteur, 2026-10-25) — des dates
 *     distinctes, pas des séances : deux séances manquées le même jour font une
 *     journée. ⚠️ Une journée n'est « justifiée » que si TOUTES ses absences le
 *     sont : une seule séance non justifiée la range de l'autre côté, et une même
 *     journée n'est jamais comptée deux fois ;
 *   - « Autre Action Disciplinaire » : les sanctions déjà encourues, d'assiduité
 *     et de comportement — la même note que l'onglet « Notes de discipline ».
 *     « Aucune » quand il n'y en a pas : une case vide se lirait comme oubliée.
 */
async function ajouterDonneesSurveillant(etablissementId, anneeScolaire, feuilles) {
  const matricules = [...new Set(feuilles.flatMap((f) => f.stagiaires.map((s) => s.matricule)))];
  const [notes, journees] = await Promise.all([
    notesDesGroupes(etablissementId, anneeScolaire, feuilles.map((f) => f.groupe)),
    AbsenceStagiaire.aggregate([
      {
        $match: {
          etablissementId: new mongoose.Types.ObjectId(String(etablissementId)),
          anneeScolaire: Number(anneeScolaire),
          matricule: { $in: matricules },
          typeAbsence: TYPES_ABSENCE.ABSENCE,
        },
      },
      {
        $group: {
          _id: { matricule: '$matricule', date: '$date' },
          justifiee: { $min: { $cond: [{ $eq: ['$justifiee', true] }, 1, 0] } },
        },
      },
      { $group: { _id: '$_id.matricule', total: { $sum: 1 }, justifiees: { $sum: '$justifiee' } } },
    ]),
  ]);

  const jours = new Map(journees.map((j) => [j._id, { nonJustifiees: j.total - j.justifiees, justifiees: j.justifiees }]));
  const accorder = (n, mot) => `${n} Jr ${mot}${n > 1 ? 's' : ''}`;
  const parMatricule = new Map(notes.flatMap((g) => g.stagiaires).map((s) => [s.matricule, s]));
  for (const feuille of feuilles) {
    for (const stagiaire of feuille.stagiaires) {
      const note = parMatricule.get(stagiaire.matricule)?.note;
      const sanctions = [
        note?.assiduite?.sanction && `${note.assiduite.sanction.libelle} (assiduité)`,
        note?.comportement?.sanction && `${note.comportement.sanction.libelle} (comportement)`,
      ].filter(Boolean);
      const { nonJustifiees = 0, justifiees = 0 } = jours.get(stagiaire.matricule) ?? {};
      stagiaire.surveillant = {
        // « 2 Jr non justifiées, 1 Jr justifiée » — l'unité est dans la valeur, le « Jr » du canevas s'efface.
        joursAbsence: `${accorder(nonJustifiees, 'non justifiée')}, ${accorder(justifiees, 'justifiée')}`,
        autresActions: sanctions.join(' ; ') || 'Aucune',
      };
    }
  }
}

/**
 * Les champs d'une feuille qui viennent de l'ÉTABLISSEMENT, pas du groupe ni du
 * stagiaire — partagés par les feuilles de groupe et les documents vierges.
 *
 * ⚠️ DEUX ÉCRITURES DE LA RÉGION (2026-10-18) : `region`, son nom
 * (« Casablanca-Settat », le PV du conseil) ; `sigleRegion`, ses initiales
 * (« CS », la case de la check-list des diplômes). Elles partageaient la clé
 * `region` — le nom, posé après, écrasait le sigle, et la check-list écrivait
 * « Casablanca-Settat » dans sa petite case.
 */
function champsEtablissement(etablissement, directeur) {
  const region = etablissement?.region ?? '';
  return {
    efp: etablissement?.nomAbrege || etablissement?.nom || '',
    etablissement: etablissement?.nom ?? '',
    complexe: etablissement?.complexe ?? '',
    region,
    sigleRegion: region
      .split(/[-\s]+/)
      .filter(Boolean)
      .map((mot) => mot[0].toUpperCase())
      .join(''),
    directionRegionale: region ? `Direction Régionale ${region}` : '',
    drRegion: region ? `DR ${region}` : '',
    drSrio: region ? `DR ${region} /SRIO` : '',
    directeur: directeur?.nomComplet ?? '',
  };
}

/**
 * ═══ « IMPRIMER VIERGE », POUR TOUS LES DOCUMENTS (2026-10-18, demande du
 * porteur) ═══ Chaque modèle de la page Documents se télécharge aussi VIDE :
 * aucun groupe, aucun stagiaire — seul l'établissement, qui l'émet, est écrit
 * (en-tête, EFP, complexe, région, directeur). Un formulaire sort en un seul
 * exemplaire à remplir à la main ; une LISTE, avec des lignes vides ; les
 * BADGES, numérotés et sans nom.
 */
export const DOCUMENTS_VIERGES = Object.fromEntries(
  Object.entries(MODELES).map(([cle, modele]) => [cle, `${modele.nomFichier}_vierge`])
);

/** Combien de stagiaires vides : les listes ont des lignes à remplir, les badges des numéros. */
const exemplairesVierges = (cle, modele) => (cle.startsWith('badges') ? 30 : modele.construireCorps ? 1 : 20);

/** Un stagiaire sans rien : chaque champ qu'un modèle peut lire, vide. */
const STAGIAIRE_VIERGE = Object.freeze({
  matricule: '',
  nom: '',
  prenom: '',
  niveau: '',
  annee: '',
  filiereLibelle: '',
  cin: '',
  nomArabe: '',
  prenomArabe: '',
  dateNaissance: '',
  lieuNaissance: '',
  dateInscription: '',
  niveauScolaire: '',
  telephone: '',
  faits: '',
  conseilAbsence: false,
  conseilConduite: false,
});

export async function construireDocumentVierge(etablissementId, anneeScolaire, cle, format) {
  const modele = MODELES[cle];
  const etablissement = await Etablissement.findById(etablissementId).select('nom nomAbrege region complexe proprietaireId').lean();
  const directeur = etablissement?.proprietaireId
    ? await User.findById(etablissement.proprietaireId).select('nomComplet').lean()
    : null;
  const donnees = {
    anneeScolaire,
    feuilles: [
      {
        ...champsEtablissement(etablissement, directeur),
        groupe: '',
        anneeScolaire,
        examen: null,
        mode: '',
        stage: null,
        filiere: '',
        numero: '',
        niveau: '',
        effectif: '',
        stagiaires: Array.from({ length: exemplairesVierges(cle, modele) }, () => ({ ...STAGIAIRE_VIERGE })),
      },
    ],
  };
  const nom = DOCUMENTS_VIERGES[cle];
  if (format === 'docx') {
    return {
      tampon: await construireDocxFeuillePresence(modele, donnees),
      nomFichier: `${nom}.docx`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  return { tampon: await construirePdfFeuillePresence(modele, donnees), nomFichier: `${nom}.pdf`, contentType: 'application/pdf' };
}
