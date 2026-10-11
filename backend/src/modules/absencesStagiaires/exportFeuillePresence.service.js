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
 * @param {'eff' | 'cc-efm' | 'liste' | 'badges-sans' | 'badges-infos' | 'checklist' | 'verification' | 'retrait-definitif' | 'retrait-provisoire' | 'attestation-poursuite' | 'convention' | 'convocation-eff' | 'transfert' | 'pv-discipline' | 'reclamation'} cleModele
 * @param {{format, groupes, examen?: {date?, debut?, fin?, epreuve?}}} options — `examen` : la convocation à l'EFF
 */
export async function construireFeuillePresence(
  etablissementId,
  anneeScolaire,
  cleModele,
  { format, groupes: demandes, examen = null, matricules = null }
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

  const efp = etablissement?.nomAbrege || etablissement?.nom || '';
  // « Casablanca-Settat » → « CS », comme sur la check-list des diplômes.
  const region = String(etablissement?.region ?? '')
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((mot) => mot[0].toUpperCase())
    .join('');

  const feuilles = groupes
    .map((groupe) => {
      const liste = stagiaires.filter((s) => (s.groupes ?? []).includes(groupe));
      if (liste.length === 0) return null;
      const decoupe = /^([A-Za-z]+)(\d.*)$/.exec(groupe);
      return {
        groupe,
        anneeScolaire,
        examen,
        mode: base?.groupeModes?.[groupe] ?? '',
        efp,
        region,
        etablissement: etablissement?.nom ?? '',
        complexe: etablissement?.complexe ?? '',
        directionRegionale: etablissement?.region ? `Direction Régionale ${etablissement.region}` : '',
        drRegion: etablissement?.region ? `DR ${etablissement.region}` : '',
        drSrio: etablissement?.region ? `DR ${etablissement.region} /SRIO` : '',
        region: etablissement?.region ?? '',
        directeur: directeur?.nomComplet ?? '',
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
        stagiaires: liste.map((s) => ({
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
