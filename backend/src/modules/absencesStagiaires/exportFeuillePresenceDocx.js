import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { echapperXml } from '../seances/xmlCellules.js';
import { chargerCanevasTampon } from '../seances/canevasCache.js';
import { convertirDocxEnPdf, prechaufferLibreOffice } from '../seances/libreOffice.js';
import { LIBELLES_NIVEAUX } from 'shared/domain';
import { corpsBadgesNumeros } from './exportBadgesNumeros.js';
import { corpsFicheFilsAgent } from './exportFicheFilsAgentDocx.js';
import { corpsDemandeDuplicata } from './exportDemandeDuplicataDocx.js';
import { corpsPvReorientation } from './exportPvReorientationDocx.js';
import { corpsBonDeSoins } from './exportBonDeSoinsDocx.js';

/**
 * Les feuilles de présence des stagiaires aux épreuves — GREFFÉES dans les
 * canevas transmis : l'EFF (2026-10-02, `Feuille_Presence_EFF_DEVOWFS201.docx`)
 * et le contrôle continu / EFM (2026-10-02, `Feuille_Presence_DEVOWFS201 (4).docx`).
 *
 * ═══ UN MÊME GABARIT, DEUX MODÈLES ═══
 * Les deux canevas ont la même forme : des tableaux SANS imbrication dans le
 * corps — un tableau d'en-tête (établissement, filière, groupe…) et la liste
 * des stagiaires, en-tête répété (`tblHeader`) puis une ligne par stagiaire.
 * Le titre et l'année sont dans l'EN-TÊTE de page, le tableau des surveillants
 * dans le PIED : tous deux se répètent seuls sur chaque page. `MODELES` dit,
 * pour chacun, QUEL tableau et QUELLES cases recevoir — le reste (épreuve,
 * date, heures, session, cases CC / EFM / Local / Régional) se remplit à la
 * main le jour de l'épreuve.
 *
 * ⚠️ UNE LIGNE PAR STAGIAIRE, ET AUCUNE LIGNE VIDE (2026-10-02, demande du
 * porteur : « si la ligne est vide ne l'affiche pas ») — les canevas
 * complétaient jusqu'à 25 lignes. Au-delà d'une page, la liste continue sur la
 * suivante, en-tête répété.
 *
 * ⚠️ UNE PAGE PAR GROUPE, dans le même fichier — comme la feuille d'absence.
 *
 * ⚠️ TROIS RETOUCHES DES CANEVAS TRANSMIS, faites UNE FOIS dans les copies de
 * `canevas/` (2026-10-02, demandes du porteur) :
 *   - le logo est celui des autres canevas, avec ombre ;
 *   - Calibri au lieu d'Aptos, que LibreOffice ne connaît pas et remplaçait
 *     par une police plus grasse — le PDF sortait « en gras » ;
 *   - le logo est EN LIGNE dans sa cellule (il flottait, décalé de -0,37 cm) :
 *     la cellule centrée verticalement l'aligne enfin sur le titre.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const canevas = (nom) => path.join(__dirname, 'canevas', nom);

/**
 * `entete` : [ligne, case, champ] — le champ de la feuille écrit dans cette
 * case du tableau d'en-tête. `ligne` : les champs écrits, case après case,
 * dans la ligne d'un stagiaire.
 */
export const MODELES = {
  eff: {
    chemin: canevas('feuillePresenceEff.docx'),
    nomFichier: 'Presence_EFF',
    tableEntete: 1,
    entete: [
      [1, 0, 'efp'],
      [1, 1, 'filiere'],
      [1, 2, 'numero'],
    ],
    tableListe: 3,
    ligne: (s) => [s.matricule, `${s.nom} ${s.prenom}`.trim()],
  },
  /* ⚠️ NOUVEAU CANEVAS (2026-10-22, `Feuille_Presence_CC_EFM.docx`) : le bloc central
     ajoute les contrôles 1 à 6, Écrit / Oral / TP, Inscrits / Présents et l'horaire
     « Du … Au … » — tout à la main ; l'en-tête et la liste gardent leurs cases. Sa
     marge du bas (0,25 cm) passe à 3,3 cm, la hauteur du pied « Surveillants » :
     Word l'agrandissait seul, LibreOffice (le PDF) y faisait chevaucher la liste. */
  'cc-efm': {
    chemin: canevas('feuillePresenceCcEfm.docx'),
    nomFichier: 'Presence_CC_EFM',
    tableEntete: 0,
    entete: [
      [0, 1, 'efp'],
      [0, 3, 'filiere'],
      [1, 3, 'numero'],
    ],
    /* Depuis une séance du formateur (2026-10-26) : le module et la date. Sans
       séance, ces cases restent vides — elles se remplissent à la main. */
    enteteFacultative: [
      [1, 1, 'examen.module'],
      [2, 1, 'examen.date'],
    ],
    completerPage: completerPresenceCcEfm,
    tableListe: 2,
    ligne: (s, index) => [String(index + 1), s.matricule, s.nom, s.prenom],
  },
  /* La liste des stagiaires d'un groupe (2026-10-02, `Liste_Stagiaires_DEVOWFS201.docx`) :
     même gabarit, l'en-tête porte le niveau et l'effectif, et le GROUPE ENTIER. */
  liste: {
    chemin: canevas('listeStagiaires.docx'),
    nomFichier: 'Liste_Stagiaires',
    tableEntete: 0,
    entete: [
      [0, 1, 'efp'],
      [0, 3, 'niveau'],
      [1, 1, 'groupe'],
      [1, 3, 'effectif'],
    ],
    tableListe: 1,
    ligne: (s, index) => [String(index + 1), s.matricule, s.nom, s.prenom],
  },
  /* Les badges de numéros de table sans informations (2026-10-02) : une grille
     de badges à découper, pas un en-tête suivi d'une liste — `construireCorps`
     remplace la page type, voir `exportBadgesNumeros.js`. */
  'badges-sans': {
    chemin: canevas('badgesNumerosSansInfos.docx'),
    nomFichier: 'Badges_Numeros',
    construireCorps: corpsBadgesNumeros(['numero', 'efp']),
  },
  /* La liste des stagiaires pour vérification (2026-10-02,
     `Liste_Verification_DEVOWFS201.docx`) : en paysage, le titre dans le CORPS,
     l'EFP et le groupe dans la même case que leur étiquette, puis CIN, noms
     arabes et date de naissance. La colonne Observation reste à la main. */
  verification: {
    chemin: canevas('listeVerification.docx'),
    nomFichier: 'Liste_Verification',
    remplacements: { 'CFP MGD HASSANIA': 'efp', DEVOWFS201: 'groupe' },
    tableListe: 2,
    ligne: (s, index) => [
      String(index + 1),
      s.matricule,
      s.cin,
      s.nom,
      s.prenom,
      s.prenomArabe,
      s.nomArabe,
      s.dateNaissance,
    ],
  },
  /* Le retrait définitif de l'attestation du bac (2026-10-02,
     `Retrait_Définitif_du_Bac.docx`) : un formulaire par stagiaire. L'identité
     est remplie ; le bac (type, année, spécialité, série) et le motif ne sont
     pas dans Konosys et restent en pointillés.
     ⚠️ L'EN-TÊTE ET LE PIED VENAIENT DU CF MEDIOUNA : le nom de l'établissement
     les remplace ; son adresse et ses téléphones sont retirés — la fiche
     établissement n'en porte pas, et ceux d'un autre centre seraient faux. */
  'retrait-definitif': modeleRetraitBac('retraitDefinitifBac.docx', 'Retrait_Definitif_Bac'),
  /* Le retrait PROVISOIRE (2026-10-02, `Retrait_Provisoire_Bac (1).docx`) : le
     même formulaire et le même en-tête du CF Mediouna ; « À rendre le » et
     « Rendu le » se remplissent à la main. */
  'retrait-provisoire': modeleRetraitBac('retraitProvisoireBac.docx', 'Retrait_Provisoire_Bac'),
  /* La check-list de vérification des diplômes (2026-10-02,
     `Checklist_Diplomes_DEVOWFS201.docx`) : UNE PAGE PAR STAGIAIRE — l'encadré
     d'identité est rempli, la vérification et les visas se font à la main. */
  checklist: {
    chemin: canevas('checklistDiplomes.docx'),
    nomFichier: 'Checklist_Diplomes',
    construireCorps: corpsParStagiaire({
      // Le sigle de la région (« CS »), pas son nom — voir `champsEtablissement`.
      CS: 'sigleRegion',
      'CFP MGD HASSANIA': 'efp',
      TS: 'niveau',
      'Développement Digital option Web Full Stack': 'filiereLibelle',
      DEVOWFS201: 'groupe',
      'ABBAOUI WALID': 'nomComplet',
      '2006113000155': 'matricule',
    }),
  },
  /* L'attestation de poursuite de formation (2026-10-10,
     `Attestation_Poursuite_Formation.docx`) : une page par stagiaire. Identité,
     niveau, spécialité, année, mode et date d'inscription viennent de Konosys
     et de la carte ; le numéro de référence et la ville (« Fait à ») restent en
     pointillés — aucune fiche ne les porte. Dans la copie de `canevas/`, la
     naissance et le nom de l'établissement, coupés en plusieurs runs, sont
     réunis en un seul ; Aptos passe en Calibri et le logo est celui des autres. */
  'attestation-poursuite': {
    chemin: canevas('attestationPoursuiteFormation.docx'),
    nomFichier: 'Attestation_Poursuite_Formation',
    construireCorps: corpsParStagiaire(
      {
        'Réf : 049/2024': 'reference',
        'CENTRE DE FORMATION PROFESSIONNELLE HASSANIA DANS LES METIERS DE GESTION ET DU DIGITAL CASABLANCA':
          'etablissement',
        'NOUZRI MOUAD': 'nomComplet',
        '29/04/2006 à Casablanca': 'naissance',
        'Technicien spécialisé': 'niveauLibelle',
        'Développement Digital (1A)': 'specialite',
        '1ère année': 'anneeLibelle',
        'Résidentielle': 'typeFormation',
        'Diplômante': 'modeFormation',
        '2006042900082': 'matricule',
        '2024/2025': 'anneeFormation',
        '06/09/2024': 'depuis',
        Casablanca: 'faitA',
        '17/10/2024': 'faitLe',
      },
      valeursAttestation
    ),
    remplacementsDocument: { 'CFP MGD HASSANIA': 'efp' },
  },
  /* La convention de stage de fin de formation (2026-10-10,
     `Convention_Stage_NOUZRI_MOUAD (1).docx`) : une par stagiaire. Le stagiaire,
     le groupe, l'établissement, son directeur et la période de stage du groupe
     (Paramètres → Stages) sont remplis ; l'entreprise, son représentant et le
     lieu et la date de signature restent en pointillés, pour l'entreprise.
     Dans la copie de `canevas/` : le « du du » de l'article 3 est corrigé,
     Aptos passe en Calibri et le logo est celui des autres. */
  convention: {
    chemin: canevas('conventionStage.docx'),
    nomFichier: 'Convention_Stage',
    // Seuls les groupes AYANT une période de stage (2026-10-11) — voir le service.
    exigeStage: true,
    construireCorps: corpsParStagiaire(
      {
        'CFP MGD HASSANIA': 'efp',
        'Année de formation 2025 /2026': 'anneeFormation',
        '2ème ANNEE': 'anneeLibelle',
        'Le CENTRE DE FORMATION PROFESSIONNELLE HASSANIA DANS LES METIERS DE GESTION ET DU DIGITAL CASABLANCA':
          'etablissement',
        'Mme HILAL FATIMAZAHRAA': 'directeur',
        'NOUZRI MOUAD': 'nomComplet',
        BM54946: 'cin',
        'De la filière : Développement digital option Web Full Stack': 'filiere',
        201: 'numero',
        '02 Mars 2026 au 11 Avril 2026': 'periodeStage',
        'A Casablanca, le ....................................................................................................':
          'faitA',
      },
      valeursConvention,
      // Le nom abrégé revient au milieu des articles 3, 5, 6, 7 et de la note « Important ».
      { 'CFP MGD HASSANIA': 'efp' }
    ),
    remplacementsDocument: {
      'DRCasa-settat': 'drRegion',
      'Complexe de Formation BEN MSICK': 'complexe',
      'CENTRE DE FORMATION PROFESSIONNELLE HASSANIA DANS LES METIERS DE GESTION ET DU DIGITAL': 'etablissement',
      CASABLANCA: 'vide',
    },
  },
  /* La convocation à l'EFF (2026-10-11, `Convocation_Examens_NOUZRI_MOUAD.docx`) :
     une page par stagiaire, SEULEMENT pour les groupes de 2ᵉ et 3ᵉ année
     (`anneeMinimale`) — la fin de formation ne concerne pas la 1ʳᵉ année.
     L'identité vient de Konosys ; la date, l'horaire et le type d'épreuve, communs
     à tous, sont saisis dans la fenêtre de téléchargement (`examen`). Dans la
     copie de `canevas/` : l'horaire, coupé en deux runs, est réuni en un seul, et
     Aptos passe en Calibri. Les consignes restent telles quelles. */
  'convocation-eff': {
    chemin: canevas('convocationEff.docx'),
    nomFichier: 'Convocation_EFF',
    anneeMinimale: 2,
    construireCorps: corpsParStagiaire(
      {
        'CENTRE DE FORMATION PROFESSIONNELLE HASSANIA DANS LES MÉTIERS DE GESTION ET DU DIGITAL': 'etablissement',
        '2006042900082': 'matricule',
        'NOUZRI MOUAD': 'nomComplet',
        BM54946: 'cin',
        'Technicien spécialisé': 'niveauLibelle',
        'Développement Digital Option Web Full Stack': 'filiere',
        'Lundi 22 Juin 2026': 'dateExamen',
        'Epreuve de synthèse': 'typeEpreuve',
        'de 08h30 à 12h30': 'horaire',
      },
      valeursConvocation
    ),
  },
  /* Le formulaire de transfert (2026-10-11, `Formulaire_de_transfert (1).docx`) :
     un par stagiaire, la « partie réservée au demandeur » PRÉ-REMPLIE — identité,
     naissance, niveau scolaire, établissement, niveau / année / mode cochés,
     filière, date d'inscription — et le nom du stagiaire repris dans la partie de
     l'établissement d'origine. Le reste (établissement demandé, motifs, visas)
     se remplit à la main. Copie de `canevas/` : Aptos → Calibri, logo commun. */
  transfert: {
    chemin: canevas('formulaireTransfert.docx'),
    nomFichier: 'Formulaire_Transfert',
    construireCorps: corpsTransfert,
    remplacementsDocument: {},
  },
  /* Le PV du conseil de discipline (2026-10-11, `PV_Conseil_Discipline.docx`) :
     un PV par stagiaire QUI RELÈVE DU CONSEIL — sa sanction d'assiduité ou de
     comportement est de l'autorité « CD » (voir le service, `exigeConseil`).
     Identité, filière, année, niveau, mode, téléphone et les faits (absences,
     retards, indisciplines) sont remplis ; les motifs exposés, la décision et les
     signatures restent à la main. L'en-tête et le pied venaient de la DR Casa
     Settat et du CF Médiouna : la région et l'établissement les remplacent.
     Copie de `canevas/` : Aptos → Calibri, logo commun. */
  'pv-discipline': {
    chemin: canevas('pvConseilDiscipline.docx'),
    nomFichier: 'PV_Conseil_Discipline',
    exigeConseil: true,
    construireCorps: corpsPvDiscipline,
    remplacementsDocument: { 'DR Casa Settat /SRIO': 'drSrio' },
    partielsDocument: { 'DR Casa Settat': 'drRegion' },
  },
  /* La fiche de réclamation (2026-10-11, `Fiche_Reclamation_Discipline.docx`) :
     le formateur, le surveillant puis le conseil la remplissent à la main. Pré-
     remplis : l'établissement (en-tête) et le groupe — UNE FICHE PAR GROUPE depuis
     Documents, les noms à écrire ; UNE PAR STAGIAIRE, son nom écrit, quand il est
     demandé nommément (« Notes de discipline »). Copie de `canevas/` : Aptos →
     Calibri, logo commun, la ligne « Groupe : … Nom & Prénom : » en un seul run. */
  reclamation: {
    chemin: canevas('ficheReclamation.docx'),
    nomFichier: 'Fiche_Reclamation',
    construireCorps: corpsReclamation,
    remplacementsDocument: { 'CF MEDIOUNA ': 'complexe', 'CFMMS TIT MELLIL': 'efp' },
  },
  /* La fiche du candidat fils d'agent OFPPT (2026-10-17, Annexe 14 du code
     d'admission, transmise en PDF) : l'EN-TÊTE de l'attestation de poursuite —
     le style des autres documents —, un corps composé — voir
     `exportFicheFilsAgentDocx.js`. Téléchargée VIERGE depuis Documents
     (`construireDocumentVierge`) ; pré-remplie si on lui donne des stagiaires. */
  'fils-agent': {
    chemin: canevas('attestationPoursuiteFormation.docx'),
    nomFichier: 'Fiche_Fils_Agent',
    construireCorps: corpsFicheFilsAgent,
    remplacementsDocument: { 'CFP MGD HASSANIA': 'efp' },
  },
  /* La demande de duplicata du diplôme (2026-10-17, canevas transmis) : une par
     stagiaire choisi, pré-remplie — voir `exportDemandeDuplicataDocx.js`. */
  duplicata: {
    chemin: canevas('attestationPoursuiteFormation.docx'),
    nomFichier: 'Demande_Duplicata_Diplome',
    construireCorps: corpsDemandeDuplicata,
    remplacementsDocument: { 'CFP MGD HASSANIA': 'efp' },
  },
  /* Le PV de réorientation (2026-10-17, `VF-Modèle PV Réorientation 2021.docx`) :
     un par stagiaire choisi, COMPOSÉ au style des autres documents sur l'en-tête de
     l'attestation (2026-10-18) — voir `exportPvReorientationDocx.js`. */
  reorientation: {
    chemin: canevas('attestationPoursuiteFormation.docx'),
    nomFichier: 'PV_Reorientation',
    construireCorps: corpsPvReorientation,
    remplacementsDocument: { 'CFP MGD HASSANIA': 'efp' },
  },
  /* Le bon de soins (2026-10-18, `Bon de soins.docx`) : un par stagiaire choisi et
     par page, composé au style des autres documents — voir `exportBonDeSoinsDocx.js`. */
  soins: {
    chemin: canevas('attestationPoursuiteFormation.docx'),
    nomFichier: 'Bon_De_Soins',
    construireCorps: corpsBonDeSoins,
    remplacementsDocument: { 'CFP MGD HASSANIA': 'efp' },
  },
  /* Les mêmes badges, AVEC les informations du stagiaire (2026-10-02). */
  'badges-infos': {
    chemin: canevas('badgesNumerosAvecInfos.docx'),
    nomFichier: 'Badges_Numeros_Table',
    construireCorps: corpsBadgesNumeros(['numero', 'efp', 'groupe', 'matricule', 'nom', 'prenom']),
  },
};

for (const { chemin } of Object.values(MODELES)) prechaufferLibreOffice(chemin);

/*
 * ⚠️ UN SAUT DE PAGE D'UN POINT DE HAUT (2026-10-11, signalé par le porteur :
 * « une page reste vide » après le formulaire de transfert). Sur une page déjà
 * pleine, un paragraphe de taille normale portant le saut glissait sur la page
 * suivante — et le saut en créait alors une de plus, blanche. Réduit à 1 pt, il
 * tient toujours au bas de la page qu'il termine.
 */
const SAUT_DE_PAGE =
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>' +
  '<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr>' +
  '<w:r><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr><w:br w:type="page"/></w:r></w:p>';

/**
 * Le corps d'un document à UNE PAGE PAR STAGIAIRE (la check-list des
 * diplômes) : la page du canevas recopiée pour chacun, ses textes d'exemple
 * remplacés par les siens. `remplacements` : le texte EXACT d'un `<w:t>` du
 * canevas → le champ qui le remplace (`nomComplet`, `matricule`, `region`…).
 */
/**
 * Les deux retraits du bac — définitif et provisoire — partagent formulaire,
 * en-tête et pied : seuls le canevas et le nom du fichier changent.
 * ⚠️ UNE DÉCLARATION DE FONCTION, hissée : `MODELES`, plus haut, l'appelle à son chargement.
 */
function modeleRetraitBac(fichier, nomFichier) {
  const formulaire = corpsFormulaire([
    [/^Noms\s*&\s*Prénoms/, (v) => `${v.nom} ${v.prenom}`],
    [/^Date\s*&\s*lieu\s*de\s*naissance/, (v) => [v.dateNaissance, v.lieuNaissance].filter(Boolean).join(' à ')],
    [/^N°\s*C\.N\.I\./, (v) => v.cin],
    [/^Filière\s*de\s*formation/, (v) => v.filiereLibelle],
    [/^CEF/, (v) => v.matricule],
  ]);
  return {
    chemin: canevas(fichier),
    nomFichier,
    /*
     * ⚠️ LE CORPS PARLAIT AUSSI DE CASABLANCA (2026-10-18, signalé par le
     * porteur) : « … envoyés à la DR Casa Settat pour valider l'exclusion » — la
     * direction régionale de l'établissement la remplace (« DR » seul si la
     * région manque) ; « Casablanca, le … » — la ville n'est dans aucune fiche :
     * des pointillés, comme sur le PV du conseil de discipline.
     */
    construireCorps: (gabarit, feuilles, sautDePage) =>
      formulaire(
        remplacerPartiels(
          gabarit,
          { 'DR Casa Settat': 'drRegion', 'Casablanca, le': 'villeLe' },
          { drRegion: feuilles[0]?.drRegion || 'DR', villeLe: '………………, le' }
        ),
        feuilles,
        sautDePage
      ),
    remplacementsDocument: {
      // Le COMPLEXE, pas le nom abrégé (2026-10-02, demande du porteur).
      'CF MEDIOUNA CASABLANCA': 'complexe',
      'CENTRE DE FORMATION DANS LES MÉTIERS DE LA MÉTALLERIE SOUDURE': 'etablissement',
      'Direction Régionale Casa Settat Casablanca': 'directionRegionale',
      '50 Rue Caporal Driss Chbakou Aïn Bordja -': 'vide',
      '☎ 05 22 60 04 32   05 22 60.00 82': 'vide',
    },
  };
}

/** Où tombent les « : » des lignes du retrait du bac (twips, depuis la marge) — celle du canevas ouvert dans Word. */
const TAB_FORMULAIRE = 3440;

/**
 * ═══ ⚠️ TOUTES LES LIGNES « Libellé : … » SUR UNE MÊME TABULATION GAUCHE ═══
 * (2026-10-02, constaté par le porteur dans Word.) Le canevas place ses « : »
 * de deux façons : une tabulation DROITE que les pointillés remplissent sur
 * toute la largeur, et — pour « Motif du retrait » — des ESPACES. Les deux ne
 * tombent au même endroit que par la largeur des pointillés et des espaces, qui
 * n'est pas la même dans Word et dans LibreOffice : une ligne remplie, passée
 * en tabulation gauche, se décalait toujours dans l'un des deux. Toutes les
 * lignes, remplies ou non, passent donc sur la même tabulation gauche.
 */
function alignerLigneFormulaire(paragraphe, texte) {
  const gauche = `<w:tab w:val="left" w:pos="${TAB_FORMULAIRE}"/>`;
  if (/<w:tab w:val="right" w:pos="\d+"\/>/.test(paragraphe)) {
    return paragraphe.replace(/<w:tab w:val="right" w:pos="\d+"\/>/, gauche);
  }
  if (!/^Motif du retrait/.test(texte)) return paragraphe;
  // Les espaces qui poussaient le « : » disparaissent ; une tabulation les remplace.
  const avecTabulation = paragraphe
    .replace(/<w:t(?:\s[^>]*)?>\s+<\/w:t>/g, '<w:t></w:t>')
    .replace(/(<w:t(?:\s[^>]*)?>):(<\/w:t>)/, '<w:tab/>$1:$2');
  return /<w:tabs>/.test(avecTabulation)
    ? avecTabulation.replace('<w:tabs>', `<w:tabs>${gauche}`)
    : avecTabulation.replace(/<w:pPr>/, `<w:pPr><w:tabs>${gauche}</w:tabs>`);
}

/**
 * Le corps d'un FORMULAIRE à une page par stagiaire (le retrait du bac) : chaque
 * ligne « Libellé : ………… » dont le libellé correspond reçoit la valeur du
 * stagiaire à la place de ses pointillés. Une valeur vide garde les
 * pointillés : la ligne se remplit alors à la main.
 *
 * @param {Array<[RegExp, (valeurs) => string]>} champs — le libellé (sur le
 *   texte du paragraphe, runs réunis) et ce qu'on y écrit
 */
function corpsFormulaire(champs) {
  return (gabarit, feuilles, sautDePage) => {
    /*
     * ⚠️ DES POINTILLÉS DE MÊME LONGUEUR : maintenant qu'elles partent toutes de
     * la même tabulation, une ligne aux pointillés plus courts (« Motif du
     * retrait » du retrait provisoire) s'arrêtait avant les autres. Toutes
     * prennent la longueur de la plus longue.
     */
    const longueur = Math.max(0, ...[...gabarit.matchAll(/>:\s*(…+)<\/w:t>/g)].map((m) => m[1].length));
    const page = gabarit.replace(/(<w:t(?:\s[^>]*)?>):\s*…+(<\/w:t>)/g, `$1:  ${'…'.repeat(longueur)}$2`);
    return feuilles
      .flatMap((feuille) =>
        feuille.stagiaires.map((stagiaire) => {
          const valeurs = { ...feuille, ...stagiaire };
          return page.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphe) => {
            // ⚠️ LE TEXTE DU XML EST ÉCHAPPÉ : « Noms & Prénoms » y est « Noms &amp; Prénoms ».
            const texte = [...paragraphe.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
              .map((m) => m[1])
              .join('')
              .replaceAll('&amp;', '&');
            const aligne = alignerLigneFormulaire(paragraphe, texte);
            const champ = champs.find(([libelle]) => libelle.test(texte));
            const valeur = champ ? String(champ[1](valeurs) ?? '').trim() : '';
            if (!valeur) return aligne;
            // Le run des pointillés commence par « : » — lui seul change.
            return aligne.replace(
              /<w:t(?:\s[^>]*)?>:\s*…+<\/w:t>/,
              `<w:t xml:space="preserve">:  ${echapperXml(valeur)}</w:t>`
            );
          });
        })
      )
      .join(sautDePage);
  };
}

// ⚠️ UNE DÉCLARATION DE FONCTION, hissée : `MODELES`, plus haut, l'appelle à son chargement.
/**
 * `completer` (facultatif) : les champs CALCULÉS d'un modèle, à partir des valeurs de base.
 * `partiels` (facultatif) : un texte remplacé PARTOUT où il apparaît, même au
 * milieu d'une phrase — le nom de l'établissement dans les articles d'une convention.
 */
function corpsParStagiaire(remplacements, completer = (valeurs) => valeurs, partiels = {}) {
  return (gabarit, feuilles, sautDePage) =>
    feuilles
      .flatMap((feuille) =>
        feuille.stagiaires.map((stagiaire) => {
          const valeurs = completer({
            ...feuille,
            ...stagiaire,
            nomComplet: `${stagiaire.nom} ${stagiaire.prenom}`.trim(),
          });
          return remplacerPartiels(remplacerTextes(gabarit, remplacements, valeurs), partiels, valeurs);
        })
      )
      .join(sautDePage);
}

/** Chaque clé de `partiels`, remplacée dans le texte des `<w:t>` — le XML autour ne bouge pas. */
function remplacerPartiels(xml, partiels, valeurs) {
  const cles = Object.keys(partiels);
  if (cles.length === 0) return xml;
  return xml.replace(/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g, (tout, ouverture, texte, fermeture) => {
    let nouveau = texte;
    for (const cle of cles) nouveau = nouveau.replaceAll(echapperXml(cle), echapperXml(valeurs[partiels[cle]] ?? ''));
    return nouveau === texte ? tout : `${ouverture}${nouveau}${fermeture}`;
  });
}

const POINTILLES = '……………………';

/** « 1A » → « 1ère année », « 2A » → « 2ème année » ; une autre écriture reste telle quelle. */
function libelleAnnee(annee) {
  const numero = /^(\d+)\s*A$/i.exec(String(annee ?? '').trim());
  if (!numero) return String(annee ?? '');
  return numero[1] === '1' ? '1ère année' : `${numero[1]}ème année`;
}

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

/** « 2026-03-02 » → « 02 Mars 2026 », l'écriture du canevas. */
function dateEnLettres(iso) {
  const [annee, mois, jour] = String(iso ?? '').split('-');
  return jour && MOIS[Number(mois) - 1] ? `${jour} ${MOIS[Number(mois) - 1]} ${annee}` : '';
}

/**
 * Les champs de la convention de stage. ⚠️ Une période de stage absente garde
 * des pointillés : elle se planifie dans Paramètres → Stages, et une date
 * inventée engagerait l'entreprise sur une période fausse.
 */
function valeursConvention(v) {
  const ouPointilles = (texte) => (String(texte ?? '').trim() ? texte : POINTILLES);
  const annee = /^(\d+)\s*A$/i.exec(String(v.annee ?? '').trim());
  return {
    ...v,
    anneeFormation: `Année de formation ${v.anneeScolaire} /${v.anneeScolaire + 1}`,
    anneeLibelle: annee ? `${annee[1]}${annee[1] === '1' ? 'ère' : 'ème'} ANNEE` : POINTILLES,
    directeur: ouPointilles(v.directeur),
    cin: ouPointilles(v.cin),
    filiere: `De la filière : ${ouPointilles(v.filiereLibelle)}`,
    periodeStage: v.stage
      ? `${dateEnLettres(v.stage.debut)} au ${dateEnLettres(v.stage.fin)}`
      : `${POINTILLES} au ${POINTILLES}`,
    faitA: `A ${POINTILLES}, le ${POINTILLES}`,
  };
}

const JOURS_SEMAINE = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

/** « 2026-06-22 » → « Lundi 22 Juin 2026 », l'écriture du canevas. */
function dateLongue(iso) {
  const lettres = dateEnLettres(iso);
  if (!lettres) return '';
  return `${JOURS_SEMAINE[new Date(`${String(iso).slice(0, 10)}T12:00:00`).getDay()]} ${lettres}`;
}

/** « 08:30 » → « 08h30 ». */
const heure = (valeur) => String(valeur ?? '').trim().replace(':', 'h');

/**
 * Les champs de la convocation à l'EFF. La date, l'horaire et le type d'épreuve
 * viennent de la fenêtre (`examen`) ; laissés vides, ils restent en pointillés
 * — la convocation se complète alors à la main, jamais avec l'exemple du canevas.
 */
function valeursConvocation(v) {
  const ouPointilles = (texte) => (String(texte ?? '').trim() ? texte : POINTILLES);
  const examen = v.examen ?? {};
  return {
    ...v,
    cin: ouPointilles(v.cin),
    niveauLibelle: ouPointilles(LIBELLES_NIVEAUX[v.niveau] ?? v.niveau),
    filiere: ouPointilles(v.filiereLibelle),
    dateExamen: ouPointilles(dateLongue(examen.date)),
    typeEpreuve: ouPointilles(examen.epreuve),
    horaire: `de ${heure(examen.debut) || '………'} à ${heure(examen.fin) || '………'}`,
  };
}

/**
 * ═══ LE FORMULAIRE DE TRANSFERT (2026-10-11) ═══ Un canevas SANS valeur
 * d'exemple : ses lignes sont « Libellé ………… ». Chaque ligne reconnue voit ses
 * pointillés remplacés par la valeur du stagiaire — une valeur absente les
 * garde, la ligne se remplit alors à la main. Les cases ☐ de « Niveau », de
 * l'année et du « Mode » sont cochées (☒) d'après Konosys et la carte.
 */
const COCHEE = '☒';

/** `texte` dont le n-ième groupe de pointillés reçoit `valeurs[n]` — une valeur vide garde les siens. */
function remplirPointilles(texte, valeurs) {
  let rang = -1;
  return texte.replace(/…+/g, (pointilles) => {
    rang += 1;
    const valeur = String(valeurs[rang] ?? '').trim();
    return valeur ? echapperXml(valeur) : pointilles;
  });
}

/** Coche la n-ième case ☐ d'un texte (`rangs` : les cases à cocher, à partir de 0). */
function cocher(texte, rangs) {
  let rang = -1;
  return texte.replace(/☐/g, (caseVide) => {
    rang += 1;
    return rangs.includes(rang) ? COCHEE : caseVide;
  });
}

/** Les lignes du demandeur reconnues par leur début, et ce qu'elles reçoivent. */
const LIGNES_TRANSFERT = [
  [/^Je soussigné, Mlle/, (v) => [v.nomComplet]],
  [/^Né \(e\) le/, (v) => [v.dateNaissance, v.lieuNaissance]],
  [/^Niveau scolaire/, (v) => [v.niveauScolaire]],
  [/^Déclare être inscrit/, (v) => [v.etablissement]],
  [/^Filière de formation/, (v) => [v.filiereLibelle]],
  [/^ le /, (v) => [v.dateInscription]], // « depuis le … » : le run qui suit « depuis »
  [/^ que Mlle, Mme, Mr/, (v) => [v.nomComplet]], // partie de l'établissement d'origine
  // L'EFP d'origine, c'est le nôtre : son directeur certifie.
  [/^Je soussigné, directeur de l'EFP/, (v) => [v.etablissement]],
];

function corpsTransfert(gabarit, feuilles, sautDePage) {
  return feuilles
    .flatMap((feuille) =>
      feuille.stagiaires.map((stagiaire) => {
        const v = { ...feuille, ...stagiaire, nomComplet: `${stagiaire.nom} ${stagiaire.prenom}`.trim() };
        // Les cases de « Niveau : TS ☐ - T ☐ - Q ☐ - S ☐  ☐ 1ère Année ☐ 2ème Année », dans l'ordre.
        const niveaux = ['TS', 'T', 'Q', 'S'];
        const rangNiveau = niveaux.indexOf(String(v.niveau ?? '').toUpperCase());
        const annee = Number(/^(\d)/.exec(String(v.annee ?? ''))?.[1]);
        const casesNiveau = [rangNiveau, annee === 1 ? 4 : annee === 2 ? 5 : -1].filter((r) => r >= 0);
        const alterne = /alt/i.test(v.mode ?? '');

        return gabarit.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphe) => {
          const texte = [...paragraphe.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');

          // La ligne des niveaux : ses cases sont réparties sur plusieurs runs — on les compte d'un run à l'autre.
          if (texte.startsWith('Niveau : TS')) {
            let vues = 0;
            return paragraphe.replace(/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g, (tout, ouverture, contenu, fermeture) => {
              const debut = vues;
              vues += (contenu.match(/☐/g) ?? []).length;
              const locaux = casesNiveau.map((r) => r - debut);
              const coche = cocher(contenu, locaux);
              return coche === contenu ? tout : `${ouverture}${coche}${fermeture}`;
            });
          }

          return paragraphe.replace(/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g, (tout, ouverture, contenu, fermeture) => {
            const ligne = LIGNES_TRANSFERT.find(([debut]) => debut.test(contenu));
            if (!ligne) return tout;
            let rempli = remplirPointilles(contenu, ligne[1](v));
            // « Mode : ☐ Résidentielle ☐ Alterné » — sur la ligne de la filière. Sans mode connu : résidentiel, la règle de la carte.
            // ⚠️ Vierge (aucun stagiaire, 2026-10-18) : rien n'est coché — la règle vaut pour un stagiaire, pas pour un formulaire vide.
            if (contenu.startsWith('Filière de formation') && v.matricule) rempli = cocher(rempli, [alterne ? 1 : 0]);
            return rempli === contenu ? tout : `<w:t xml:space="preserve">${rempli}${fermeture}`;
          });
        });
      })
    )
    .join(sautDePage);
}

/**
 * ═══ LE PV DU CONSEIL DE DISCIPLINE (2026-10-11) ═══ Un canevas SANS valeur
 * d'exemple pour le stagiaire : ses lignes sont « Libellé ………… ». Chaque ligne
 * reconnue reçoit la valeur du stagiaire à la place de ses pointillés, et les
 * cases ☐ (motif, année, mode) sont cochées ; une valeur absente garde les
 * pointillés. Le paragraphe est reconnu par son TEXTE (runs réunis), puis seuls
 * ses runs concernés sont réécrits — la mise en forme du canevas reste.
 */
const RUN = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g;
const texteDu = (paragraphe) => [...paragraphe.matchAll(RUN)].map((m) => m[2]).join('');

/** Réécrit les runs d'un paragraphe : `transformer(texte, rang)` rend le nouveau texte (déjà échappé). */
function reecrireRuns(paragraphe, transformer) {
  let rang = -1;
  return paragraphe.replace(RUN, (tout, ouverture, contenu, fermeture) => {
    rang += 1;
    const nouveau = transformer(contenu, rang);
    return nouveau === contenu ? tout : `<w:t xml:space="preserve">${nouveau}${fermeture}`;
  });
}

/** Coche, dans tout le paragraphe, les cases ☐ de rangs `rangs` (comptés d'un run à l'autre). */
function cocherParagraphe(paragraphe, rangs) {
  let vues = 0;
  return reecrireRuns(paragraphe, (contenu) => {
    const debut = vues;
    vues += (contenu.match(/☐/g) ?? []).length;
    return cocher(contenu, rangs.map((r) => r - debut));
  });
}

/** Le premier groupe de pointillés du run qui en porte, rempli de `valeur` — vide : inchangé. */
const remplirPremiersPointilles = (paragraphe, valeur) => {
  let fait = false;
  return reecrireRuns(paragraphe, (contenu) => {
    if (fait || !/…/.test(contenu) || !String(valeur ?? '').trim()) return contenu;
    fait = true;
    return remplirPointilles(contenu, [valeur]);
  });
};

function corpsPvDiscipline(gabarit, feuilles, sautDePage) {
  const anneeCivile = new Date().getFullYear();
  return feuilles
    .flatMap((feuille) =>
      feuille.stagiaires.map((stagiaire) => {
        const v = { ...feuille, ...stagiaire, nomComplet: `${stagiaire.nom} ${stagiaire.prenom}`.trim() };
        const annee = Number(/^(\d)/.exec(String(v.annee ?? ''))?.[1]) || null;
        // Suivi d'une espace : le canevas colle « année » aux pointillés.
        const ordinal = annee === 1 ? '1ère ' : annee ? `${annee}ème ` : '';
        let apresRaison = false; // la ligne de pointillés qui suit « … en raison de »

        return gabarit.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphe) => {
          const texte = texteDu(paragraphe);

          if (texte.startsWith('CFP :')) {
            return reecrireRuns(paragraphe, (contenu) =>
              contenu === 'CF ' ? '' : contenu === 'MEDIOUNA  ' ? `${echapperXml(v.complexe)}  ` : contenu === 'CFMMS TIT MELLIL' ? echapperXml(v.efp) : contenu
            );
          }
          // La ville n'est dans aucune fiche : des pointillés, comme la date.
          if (texte.startsWith('Casablanca, le')) {
            return reecrireRuns(paragraphe, (contenu) => contenu.replace('Casablanca', '………………'));
          }
          if (texte.startsWith('TIT MELLIL/N°')) {
            return reecrireRuns(paragraphe, (contenu) =>
              contenu === 'TIT MELLIL/N° ' ? `${echapperXml(v.efp)}/N° ` : contenu.replace('/2026', `/${anneeCivile}`)
            );
          }
          if (texte.startsWith('cas du stagiaire')) {
            return reecrireRuns(paragraphe, (contenu, rang) =>
              rang === 2 ? remplirPointilles(contenu, [v.nomComplet]) : contenu.includes('CEF :') ? remplirPointilles(contenu, [v.matricule]) : contenu
            );
          }
          if (texte.startsWith('☐Absence')) {
            return cocherParagraphe(paragraphe, [v.conseilAbsence ? 0 : -1, v.conseilConduite ? 1 : -1]);
          }
          if (texte.startsWith('Filière :')) return remplirPremiersPointilles(paragraphe, v.filiereLibelle);
          if (texte.startsWith('Année de formation : ☐1')) return annee === 1 ? cocherParagraphe(paragraphe, [0]) : paragraphe;
          if (texte.trim().startsWith('☐2ème')) return annee === 2 ? cocherParagraphe(paragraphe, [0]) : paragraphe;
          if (texte.trim().startsWith('☐3ème')) return annee === 3 ? cocherParagraphe(paragraphe, [0]) : paragraphe;
          if (texte.startsWith('Niveau de formation')) {
            return remplirPremiersPointilles(paragraphe, LIBELLES_NIVEAUX[v.niveau] ?? v.niveau);
          }
          // Sans mode connu : résidentiel, la règle de la carte. Vierge (aucun stagiaire) : rien n'est coché.
          if (texte.startsWith('Mode de formation')) {
            return v.matricule ? cocherParagraphe(paragraphe, [/alt/i.test(v.mode ?? '') ? 1 : 0]) : paragraphe;
          }
          if (texte.startsWith('N° Téléphone')) return remplirPremiersPointilles(paragraphe, v.telephone);
          if (texte.startsWith("L'intéressé(e) est traduit(e)")) {
            apresRaison = true;
            return paragraphe;
          }
          // Les faits, sur la première ligne de pointillés qui suit « en raison de ».
          if (apresRaison && /^…+$/.test(texte.trim())) {
            apresRaison = false;
            return remplirPremiersPointilles(paragraphe, v.faits);
          }
          if (texte.startsWith("L'intéressé(e) est définitivement rayé(e)")) return remplirPremiersPointilles(paragraphe, ordinal);
          if (texte.startsWith('la filière')) {
            return reecrireRuns(paragraphe, (contenu) =>
              contenu.startsWith('…') ? remplirPointilles(contenu, [v.filiereLibelle]) : contenu.includes('groupe') ? remplirPointilles(contenu, [v.groupe]) : contenu
            );
          }
          // « Validation de la Direction Régionale Casa Settat » : la région de l'établissement.
          if (texte.startsWith('Validation de la Direction Régionale')) {
            return reecrireRuns(paragraphe, (contenu) => (contenu === 'Casa Settat' ? echapperXml(v.region || contenu) : contenu));
          }
          return paragraphe;
        });
      })
    )
    .join(sautDePage);
}

/**
 * La fiche de réclamation : une page par groupe, ou par stagiaire quand ils sont
 * `nommes`. Seule la ligne « Groupe : ……… Nom & Prénom : » est écrite — les
 * pointillés du groupe remplacés, le nom ajouté après son libellé.
 */
function corpsReclamation(gabarit, feuilles, sautDePage, { nommes = false } = {}) {
  const page = (feuille, stagiaire) => {
    const nom = stagiaire ? `${stagiaire.nom} ${stagiaire.prenom}`.trim() : '';
    /*
     * ═══ REMPLIE PAR LE FORMATEUR (2026-10-25, demande du porteur) ═══
     * `feuille.reclamation` n'existe que depuis « Mes documents » du formateur :
     * la séance choisie (date, heure, lieu), le formateur connecté, ses deux
     * saisies — et, par stagiaire, la partie SURVEILLANT tirée de son dossier
     * (`surveillant`). Sans elle — la direction, l'exemplaire vierge — seuls le
     * groupe et le nom sont écrits, comme avant.
     */
    const r = feuille.reclamation;
    return gabarit.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphe) => {
      const texte = texteDu(paragraphe);
      if (texte.startsWith('Groupe :')) {
        return reecrireRuns(paragraphe, (contenu) =>
          contenu.startsWith('Groupe :')
            ? `${remplirPointilles(contenu.replace(/Nom &amp; Prénom : $/, ''), [feuille.groupe]).replace(/^Groupe :(?!…)/, 'Groupe : ')}${'\u00a0'.repeat(8)}Nom &amp; Prénom : ${echapperXml(nom)}`
            : contenu
        );
      }
      if (!r) return paragraphe;
      if (texte.startsWith('Date &amp; Heure :')) return completerParagraphe(paragraphe, [r.dateHeure], r.lieu);
      if (texte.startsWith('Nom &amp; Prénom :')) return completerParagraphe(paragraphe, [r.formateur, r.matriculeFormateur]);
      if (texte.startsWith('Action Non disciplinaire :')) return completerParagraphe(paragraphe, [], r.actionNonDisciplinaire);
      if (texte.startsWith('Dégâts Immobilier :')) return completerParagraphe(paragraphe, [], r.degats);
      if (texte.startsWith('Absence :') && stagiaire?.surveillant) {
        // La valeur porte déjà « Jr » deux fois (non justifiées, justifiées) : celui du canevas s'efface.
        return completerParagraphe(paragraphe, [stagiaire.surveillant.joursAbsence], stagiaire.surveillant.autresActions, {
          uniteIncluse: 'Jr',
        });
      }
      return paragraphe;
    });
  };
  return feuilles
    .flatMap((feuille) => (nommes ? feuille.stagiaires.map((s) => page(feuille, s)) : [page(feuille, null)]))
    .join(sautDePage);
}

/**
 * Les pointillés d'un paragraphe reçoivent `valeurs` dans l'ordre, et `suite`
 * s'écrit après son dernier run (« Lieu : Salle 4 »).
 *
 * ⚠️ UNE SUITE DE POINTILLÉS EST UN SEUL CHAMP, MÊME COUPÉE EN PLUSIEURS RUNS :
 *    Word découpe « Nom & Prénom :………………Matricule » au gré de ses révisions.
 *    Compter les groupes run par run donnait au nom la première moitié des
 *    pointillés et le MATRICULE à la seconde — « BRAHIM LOURID9863Matricule : ……… ».
 *    Chaque « … » reçoit donc le rang de son groupe sur le texte ENTIER du
 *    paragraphe ; la valeur s'écrit à la place du premier, les autres s'effacent.
 *
 * Une valeur vide garde ses pointillés ; un retour à la ligne de `suite` devient
 * un saut de ligne Word. `uniteIncluse` : l'unité que le canevas écrit après les
 * pointillés (« ………Jr ») et que la valeur porte déjà — elle s'efface.
 * `avecPoints` : des points ASCII mêlés aux pointillés (« ……..…… », « ………. »)
 * en font partie — sans lui, ils coupaient un champ en deux.
 */
function completerParagraphe(paragraphe, valeurs = [], suite = '', { uniteIncluse = '', avecPoints = false } = {}) {
  const pointille = (caractere) => caractere === '…' || (avecPoints && caractere === '.');
  const runs = [...paragraphe.matchAll(RUN)].map((m) => m[2]);
  let groupe = -1;
  let dansPointilles = false;
  const rangs = runs.map((contenu) =>
    [...contenu].map((caractere) => {
      if (!pointille(caractere)) {
        dansPointilles = false;
        return -1;
      }
      if (!dansPointilles) groupe += 1;
      dansPointilles = true;
      return groupe;
    })
  );

  const ajout = String(suite ?? '').trim();
  const ecrits = new Set();
  let effacerUnite = false;
  return reecrireRuns(paragraphe, (contenu, rang) => {
    let texte = '';
    const caracteres = [...contenu];
    for (let index = 0; index < caracteres.length; index += 1) {
      const caractere = caracteres[index];
      const g = rangs[rang][index];
      const valeur = g >= 0 ? String(valeurs[g] ?? '').trim() : '';
      if (g < 0 && effacerUnite && uniteIncluse && caracteres.slice(index).join('').startsWith(uniteIncluse)) {
        index += [...uniteIncluse].length - 1;
        effacerUnite = false;
        continue;
      }
      if (g < 0) effacerUnite = false;
      if (!valeur) {
        texte += caractere;
      } else if (!ecrits.has(g)) {
        ecrits.add(g);
        texte += ` ${echapperXml(valeur)}`;
        effacerUnite = Boolean(uniteIncluse);
        if (!effacerUnite) texte += ' ';
      }
    }
    if (rang === runs.length - 1 && ajout) {
      texte += ` ${ajout
        .split(/\r?\n/)
        .map((ligne) => echapperXml(ligne))
        .join('</w:t><w:br/><w:t xml:space="preserve">')}`;
    }
    return texte;
  });
}

/** « 14/10/2026 » — la date de délivrance. */
function dateDuJour() {
  const maintenant = new Date();
  const jour = String(maintenant.getDate()).padStart(2, '0');
  const mois = String(maintenant.getMonth() + 1).padStart(2, '0');
  return `${jour}/${mois}/${maintenant.getFullYear()}`;
}

/**
 * Les champs de l'attestation de poursuite. ⚠️ « Type Formation » et « Mode »
 * se disent au FÉMININ (« la formation ») : « Résidentielle », « Alternée » ;
 * un groupe FQ est « Qualifiante », les autres « Diplômante ».
 * ⚠️ Une donnée absente garde des pointillés : la case se remplit à la main,
 * jamais avec la valeur d'exemple du canevas.
 */
function valeursAttestation(v) {
  const ouPointilles = (texte) => (String(texte ?? '').trim() ? texte : POINTILLES);
  const aujourdhui = dateDuJour();
  /* ⚠️ Vierge (aucun stagiaire, 2026-10-18) : ni type ni mode par défaut, ni date
     du jour — tout se remplit à la main. */
  if (!v.matricule) {
    return {
      ...valeursAttestationStagiaire(v, ouPointilles, aujourdhui),
      nomComplet: POINTILLES,
      matricule: POINTILLES,
      typeFormation: POINTILLES,
      modeFormation: POINTILLES,
      faitLe: POINTILLES,
    };
  }
  return valeursAttestationStagiaire(v, ouPointilles, aujourdhui);
}

function valeursAttestationStagiaire(v, ouPointilles, aujourdhui) {
  return {
    ...v,
    reference: `Réf : ${POINTILLES}/${aujourdhui.slice(-4)}`,
    naissance: ouPointilles([v.dateNaissance, v.lieuNaissance].filter(Boolean).join(' à ')),
    niveauLibelle: ouPointilles(LIBELLES_NIVEAUX[v.niveau] ?? v.niveau),
    specialite: ouPointilles([v.filiereLibelle, v.annee && `(${v.annee})`].filter(Boolean).join(' ')),
    anneeLibelle: ouPointilles(libelleAnnee(v.annee)),
    typeFormation: /alt/i.test(v.mode ?? '') ? 'Alternée' : 'Résidentielle',
    modeFormation: String(v.niveau).toUpperCase() === 'FQ' ? 'Qualifiante' : 'Diplômante',
    anneeFormation: `${v.anneeScolaire}/${v.anneeScolaire + 1}`,
    depuis: ouPointilles(v.dateInscription),
    faitA: POINTILLES,
    faitLe: aujourdhui,
  };
}

const tables = (xml) => [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)];
const lignes = (xml) => [...xml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((m) => m[0]);

/**
 * Le texte d'une case : son premier `<w:t>` remplacé, les suivants vidés — la
 * mise en forme du canevas est gardée. Une case sans aucun `<w:t>` reçoit un
 * run dans son premier paragraphe.
 */
function ecrireCase(xmlCase, texte) {
  const run = `<w:t xml:space="preserve">${echapperXml(texte)}</w:t>`;
  let premier = true;
  const remplie = xmlCase.replace(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g, () => {
    if (!premier) return '<w:t></w:t>';
    premier = false;
    return run;
  });
  if (!premier) return remplie;
  return xmlCase.replace(/<w:p\b([^>]*?)\/>|<\/w:p>/, (balise, attributs) =>
    balise.startsWith('</') ? `<w:r>${run}</w:r></w:p>` : `<w:p${attributs}><w:r>${run}</w:r></w:p>`
  );
}

/** Une ligne dont les cases d'indice donné reçoivent leur texte (`{ indice: texte }`), les autres inchangées. */
function ecrireLigne(xmlLigne, textes) {
  let index = -1;
  return xmlLigne.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, (xmlCase) => {
    index += 1;
    return index in textes ? ecrireCase(xmlCase, textes[index]) : xmlCase;
  });
}

function remplacerTable(xml, index, nouvelle) {
  const table = tables(xml)[index];
  return xml.slice(0, table.index) + nouvelle + xml.slice(table.index + table[0].length);
}

function construirePage(gabarit, modele, feuille) {
  const toutes = tables(gabarit).map((m) => m[0]);
  const tableListe = toutes[modele.tableListe];
  if (!tableListe) throw new Error('Canevas Word illisible : la liste des stagiaires est absente');

  // L'en-tête, s'il est un tableau à cases : chaque champ dans sa case.
  let page = gabarit;
  if (modele.tableEntete !== undefined) {
    const tableEntete = toutes[modele.tableEntete];
    if (!tableEntete) throw new Error('Canevas Word illisible : le tableau d’en-tête est absent');
    let nouvelleEntete = tableEntete;
    lignes(tableEntete).forEach((xmlLigne, numeroLigne) => {
      /* `enteteFacultative` : écrite seulement quand la feuille porte la valeur —
         sinon la case du canevas reste telle quelle, à remplir à la main. */
      const champs = [
        ...modele.entete,
        ...(modele.enteteFacultative ?? []).filter(([, , champ]) => valeurDe(feuille, champ)),
      ];
      const textes = Object.fromEntries(
        champs.filter(([l]) => l === numeroLigne).map(([, c, champ]) => [c, valeurDe(feuille, champ) ?? ''])
      );
      if (Object.keys(textes).length > 0) nouvelleEntete = nouvelleEntete.replace(xmlLigne, ecrireLigne(xmlLigne, textes));
    });
    page = remplacerTable(page, modele.tableEntete, nouvelleEntete);
  }

  // L'en-tête, si l'étiquette et sa valeur partagent une case (« EFP : CFP MGD
  // HASSANIA ») : la valeur d'exemple du canevas, remplacée là où elle est.
  page = remplacerTextes(page, modele.remplacements ?? {}, feuille);

  // La liste : l'en-tête, puis une ligne par stagiaire — les lignes du canevas disparaissent.
  const lignesListe = lignes(tableListe);
  const [enTeteListe, ligneModele] = lignesListe;
  if (!ligneModele) throw new Error('Canevas Word illisible : ligne de stagiaire attendue');
  const derniere = lignesListe.at(-1);
  const debut = tableListe.indexOf(enTeteListe);
  const fin = tableListe.lastIndexOf(derniere) + derniere.length;
  const remplies = feuille.stagiaires.map((s, index) =>
    ecrireLigne(ligneModele, { ...modele.ligne(s, index) })
  );
  const nouvelleListe = tableListe.slice(0, debut) + enTeteListe + remplies.join('') + tableListe.slice(fin);

  // ⚠️ LA LISTE EN DERNIER : ses lignes sont réécrites, les textes d'exemple ne doivent plus y être cherchés.
  const complete = remplacerTable(page, modele.tableListe, nouvelleListe);
  return modele.completerPage ? modele.completerPage(complete, feuille) : complete;
}

/** `feuille.examen.module` pour « examen.module » — un champ simple se lit tel quel. */
const valeurDe = (feuille, champ) => champ.split('.').reduce((objet, cle) => objet?.[cle], feuille);

/**
 * ═══ LA FEUILLE CC/EFM DEPUIS UNE SÉANCE (2026-10-26, demande du porteur) ═══
 * `feuille.examen` : l'épreuve cochée par le formateur et l'horaire de la séance.
 *   - les cases ☐ reconnues par leur libellé — CONTRÔLE CONTINU et son numéro (1 à 6)
 *     et sa nature (Écrit, Oral, TP), ou EXAMEN FIN DE MODULE et sa portée (Local,
 *     Régional) — sont cochées ☒ ;
 *   - « Du ……… Au ……… » reçoit le début et la fin de la séance ;
 *   - « Inscrits » reçoit l'effectif de la liste ; « Présents » reste à la main.
 * Sans `examen` — la direction, l'exemplaire vierge —, rien ne change.
 */
function completerPresenceCcEfm(page, feuille) {
  const e = feuille.examen;
  if (!e) return page;
  const cc = e.type === 'cc';
  const efm = e.type === 'efm';
  const coches = {
    'CONTROLE CONTINU': cc,
    'EXAMEN FIN DE MODULE': efm,
    ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [String(n), cc && e.numero === n])),
    Ecrit: cc && e.nature === 'ecrit',
    Oral: cc && e.nature === 'oral',
    TP: cc && e.nature === 'tp',
    Local: efm && e.portee === 'local',
    Régional: efm && e.portee === 'regional',
  };

  let inscritsEcrits = false;
  return page.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphe) => {
    const texte = texteDu(paragraphe).replace(/\s+/g, ' ').trim();
    if (texte.endsWith('☐') && coches[texte.replace(/\s*☐$/, '')]) return cocherParagraphe(paragraphe, [0]);
    if (texte.startsWith('Du ') && texte.includes('Au') && e.debut) {
      return completerParagraphe(paragraphe, [e.debut, e.fin], '', { avecPoints: true });
    }
    // Le premier « ……… » seul dans sa case est celui des inscrits ; le second, des présents.
    // ⚠️ Le canevas y mêle des points ASCII (« ………………. ») : ils en font partie.
    if (!inscritsEcrits && /^[….]+$/.test(texte)) {
      inscritsEcrits = true;
      return completerParagraphe(paragraphe, [String(feuille.stagiaires.length)], '', { avecPoints: true });
    }
    return paragraphe;
  });
}

/** Les `<w:t>` dont le texte est EXACTEMENT une clé de `remplacements`, réécrits avec le champ qu'elle désigne. */
function remplacerTextes(xml, remplacements, valeurs) {
  return xml.replace(/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g, (tout, ouverture, texte, fermeture) =>
    texte in remplacements
      ? `<w:t xml:space="preserve">${echapperXml(valeurs[remplacements[texte]] ?? '')}${fermeture}`
      : tout
  );
}

export async function construireDocxFeuillePresence(modele, { anneeScolaire, feuilles, nommes = false }) {
  const zip = await JSZip.loadAsync(await chargerCanevasTampon(modele.chemin));

  const xmlDocument = await zip.file('word/document.xml').async('string');
  const debutCorps = xmlDocument.indexOf('<w:body>') + '<w:body>'.length;
  const debutSectPr = xmlDocument.lastIndexOf('<w:sectPr');
  if (debutSectPr <= debutCorps) throw new Error('Canevas Word illisible : la mise en page (sectPr) est absente');

  // L'année des canevas, sous ses deux écritures (« 2026-2027 », « 2026/2027 »).
  const annee = (xml) =>
    xml
      .replaceAll('2026-2027', `${anneeScolaire}-${anneeScolaire + 1}`)
      .replaceAll('2026/2027', `${anneeScolaire}/${anneeScolaire + 1}`);

  // Dans le corps quand le titre n'est pas dans un en-tête de page (liste de vérification, retrait du bac).
  const gabarit = annee(xmlDocument.slice(debutCorps, debutSectPr));
  const corps = modele.construireCorps
    ? modele.construireCorps(gabarit, feuilles, SAUT_DE_PAGE, { nommes })
    : feuilles.map((feuille) => construirePage(gabarit, modele, feuille)).join(SAUT_DE_PAGE);
  zip.file('word/document.xml', xmlDocument.slice(0, debutCorps) + corps + xmlDocument.slice(debutSectPr));

  // L'en-tête et le pied de page : l'année, et ce qui y désigne l'établissement (une valeur par document).
  for (const nom of Object.keys(zip.files).filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n))) {
    const xml = annee(await zip.file(nom).async('string'));
    const valeurs = { ...feuilles[0], vide: '' };
    // `partielsDocument` : un texte remplacé au milieu d'une phrase du pied (« … à la DR Casa Settat … »).
    zip.file(nom, remplacerPartiels(remplacerTextes(xml, modele.remplacementsDocument ?? {}, valeurs), modele.partielsDocument ?? {}, valeurs));
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}

export async function construirePdfFeuillePresence(modele, donnees) {
  return convertirDocxEnPdf(await construireDocxFeuillePresence(modele, donnees));
}
