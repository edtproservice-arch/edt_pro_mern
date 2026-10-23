import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowRightLeft,
  BadgeCheck,
  Briefcase,
  ChevronDown,
  GraduationCap,
  ClipboardCheck,
  ClipboardList,
  Copy,
  File,
  FileCheck2,
  FileSignature,
  FileText,
  FileWarning,
  Gavel,
  IdCard,
  Mail,
  Search,
  Shuffle,
  Stethoscope,
  Ticket,
  UserCheck,
  Users, Loader2 } from 'lucide-react';
import { anneeDuNomGroupe } from 'shared/domain';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  exporterCartes,
  exporterFeuilleAbsence,
  exporterFeuillePresence,
  telechargerBilletsVierges,
  telechargerDocumentVierge,
  telechargerFormulaireExamen,
} from '@/features/absences/stagiaires/api';
import { chargerEtablissementCourant } from '@/features/configuration/api';
import DialogueChoixGroupes from './DialogueChoixGroupes';
import { empreinte, useEtatPartage } from '@/features/guidage/useEtatPartage';

/**
 * Documents imprimables, en cartes.
 * ← les huit `.stat-card` de canvas.html:700-760
 *
 * ═══ POURQUOI ELLES SONT LÀ AVANT D'ÊTRE ACTIVES ═══
 * Un menu qui ne montre rien de ce qu'il fera n'aide personne à s'organiser :
 * le directeur doit savoir que sa base Konosys sert à ces huit documents, et
 * lesquels. Chaque carte annonce donc ce qu'elle produira et la phase où elle
 * arrive, plutôt que d'être absente ou grisée sans motif — c'est le choix déjà
 * fait pour `ModuleAVenir` dans le menu principal.
 *
 * ⚠️ Le rendu PDF n'est pas tranché (Phase 10 du plan) : client avec jsPDF
 * empaqueté, ou serveur. Les documents officiels — badges, convocations,
 * émargement — plaident pour le serveur : rendu reproductible et polices
 * maîtrisées. Rien n'est décidé ici.
 */
const DOCUMENTS = [
  {
    cle: 'liste',
    titre: 'Liste des stagiaires',
    resume: 'Pour affichage, par groupe',
    icone: Users,
    // Canevas transmis (2026-10-02) : les groupes se choisissent d'abord.
    choixGroupes: {
      description: 'Une page par groupe, avec son niveau et son effectif.',
      formats: ['docx', 'pdf'],
      telecharger: exporterFeuillePresence('liste'),
      vierge: telechargerDocumentVierge('liste'),
    },
  },
  {
    cle: 'presence-eff',
    titre: 'Feuille de présence EFF',
    resume: 'Examen de fin de formation',
    icone: ClipboardList,
    // Canevas transmis (2026-10-02) : les groupes se choisissent d'abord.
    choixGroupes: {
      description: 'Une page par groupe ; l’épreuve, la date et les heures se remplissent à la main.',
      formats: ['docx', 'pdf'],
      telecharger: exporterFeuillePresence('eff'),
      vierge: telechargerDocumentVierge('eff'),
    },
  },
  {
    cle: 'presence-cc-efm',
    titre: 'Feuille de présence CC/EFM',
    resume: 'Contrôle continu et EFM',
    icone: ClipboardList,
    // Canevas transmis (2026-10-02) : les groupes se choisissent d'abord.
    choixGroupes: {
      description:
        'Une page par groupe ; le module, la date, l’horaire et le type d’épreuve se remplissent à la main.',
      formats: ['docx', 'pdf'],
      telecharger: exporterFeuillePresence('cc-efm'),
      vierge: telechargerDocumentVierge('cc-efm'),
    },
  },
  {
    cle: 'verification',
    titre: 'Liste de vérification',
    resume: 'Contrôle des inscriptions',
    icone: FileCheck2,
    // Canevas transmis (2026-10-02) : les groupes se choisissent d'abord.
    choixGroupes: {
      description: 'Une page par groupe : CIN, noms en arabe et date de naissance de chaque stagiaire.',
      formats: ['docx', 'pdf'],
      telecharger: exporterFeuillePresence('verification'),
      vierge: telechargerDocumentVierge('verification'),
    },
  },
  {
    cle: 'checklist',
    titre: 'Check-list des diplômes',
    resume: 'Pièces à réunir',
    icone: BadgeCheck,
    // Canevas transmis (2026-10-02) : les groupes se choisissent d'abord.
    choixGroupes: {
      description: 'Une page par stagiaire ; la vérification et les visas se remplissent à la main.',
      formats: ['docx', 'pdf'],
      telecharger: exporterFeuillePresence('checklist'),
      vierge: telechargerDocumentVierge('checklist'),
      parStagiaire: true,
    },
  },
  {
    cle: 'convocation',
    titre: 'Convocation à l’EFF',
    resume: '2e et 3e année',
    icone: Mail,
    // Canevas transmis (2026-10-11) : seuls les groupes de 2e et 3e année sont proposés.
    choixGroupes: {
      description:
        'Une convocation par stagiaire, pour les groupes de 2e et 3e année. La date, l’horaire et le type d’épreuve laissés vides restent à remplir à la main.',
      formats: ['docx', 'pdf'],
      telecharger: exporterFeuillePresence('convocation-eff'),
      vierge: telechargerDocumentVierge('convocation-eff'),
      parStagiaire: true,
      groupesAdmis: (groupe) => anneeDuNomGroupe(groupe) >= 2,
      champs: [
        { nom: 'date', libelle: 'Date de l’épreuve', type: 'date' },
        { nom: 'epreuve', libelle: 'Type d’épreuve', defaut: 'Epreuve de synthèse' },
        { nom: 'debut', libelle: 'De', type: 'time', defaut: '08:30' },
        { nom: 'fin', libelle: 'À', type: 'time', defaut: '12:30' },
      ],
    },
  },
  {
    cle: 'carte',
    titre: 'Carte de stagiaire',
    resume: 'Badge avec photo et QR',
    icone: IdCard,
    // Composée ici, sans canevas (2026-10-11) : dix cartes par page A4, à découper.
    choixGroupes: {
      // ⚠️ L'ADRESSE OÙ MÈNERONT LES QR, AFFICHÉE (2026-10-11) : un QR qui ouvre la mauvaise
      // application se voit ICI, avant l'impression — pas au premier scan.
      description: `Dix cartes par page, à découper (format carte bancaire). La photo se colle dans son cadre. Le QR connecte directement à la session du stagiaire : remettez la carte à son titulaire seulement. Les QR mèneront à ${window.location.origin}.`,
      formats: ['docx', 'pdf'],
      telecharger: exporterCartes,
      parStagiaire: true,
      champs: [
        {
          nom: 'renouveler',
          type: 'checkbox',
          libelle: 'Renouveler les QR codes',
          aide: 'Les cartes déjà imprimées de ces stagiaires ne permettront plus de se connecter (carte perdue ou volée).',
        },
      ],
    },
  },
  {
    cle: 'badges-table',
    titre: 'Badges de numéros de table',
    resume: 'Avec les informations du stagiaire',
    icone: Ticket,
    // Canevas transmis (2026-10-02) : les groupes se choisissent d'abord.
    choixGroupes: {
      description: 'Un badge par stagiaire — groupe, matricule, nom et prénom — numéroté comme la liste du groupe.',
      formats: ['docx', 'pdf'],
      telecharger: exporterFeuillePresence('badges-infos'),
      vierge: telechargerDocumentVierge('badges-infos'),
      // Filtrables aussi (2026-10-17) : chacun garde le numéro de sa place dans la liste du groupe.
      parStagiaire: true,
    },
  },
  {
    cle: 'badges-simples',
    titre: 'Badges de numéros de table',
    resume: 'Sans informations',
    icone: Ticket,
    // Canevas transmis (2026-10-02) : les groupes se choisissent d'abord.
    choixGroupes: {
      description: 'Un badge par stagiaire, numéroté comme la liste du groupe ; un groupe par page.',
      formats: ['docx', 'pdf'],
      telecharger: exporterFeuillePresence('badges-sans'),
      vierge: telechargerDocumentVierge('badges-sans'),
      // Filtrables aussi (2026-10-17) : chacun garde le numéro de sa place dans la liste du groupe.
      parStagiaire: true,
    },
  },
  {
    cle: 'feuille-absence',
    titre: 'Feuille d’absence hebdomadaire',
    resume: 'Par groupe, semaine par semaine',
    icone: ClipboardList,
    // Le canevas de « Faire l'appel » : groupes et semaine se choisissent d'abord (2026-10-01).
    choixGroupes: {
      description: 'Une page par groupe, pour la semaine choisie.',
      avecSemaine: true,
      formats: ['docx', 'pdf', 'xlsx'],
      telecharger: exporterFeuilleAbsence,
    },
  },
  {
    cle: 'billet-absence',
    titre: 'Billet d’absence',
    resume: 'Quinze billets vierges par page',
    icone: FileText,
    // Le canevas du registre des absences, sans stagiaire (2026-10-01).
    telecharger: telechargerBilletsVierges,
  },
  {
    cle: 'attestation-poursuite',
    titre: 'Attestation de poursuite de formation',
    resume: 'Pour le stagiaire',
    icone: FileCheck2,
    // Canevas transmis (2026-10-10) : les groupes se choisissent d'abord.
    choixGroupes: {
      description:
        'Une attestation par stagiaire, datée du jour ; le numéro de référence et la ville se remplissent à la main.',
      formats: ['docx', 'pdf'],
      telecharger: exporterFeuillePresence('attestation-poursuite'),
      vierge: telechargerDocumentVierge('attestation-poursuite'),
      parStagiaire: true,
    },
  },
  {
    cle: 'retrait-definitif',
    titre: 'Retrait définitif du Bac',
    resume: 'Décharge du diplôme',
    icone: BadgeCheck,
    // Canevas transmis (2026-10-02) : les groupes se choisissent d'abord.
    choixGroupes: {
      description:
        'Une page par stagiaire ; le baccalauréat (type, année, spécialité, série) et le motif se remplissent à la main.',
      formats: ['docx', 'pdf'],
      telecharger: exporterFeuillePresence('retrait-definitif'),
      vierge: telechargerDocumentVierge('retrait-definitif'),
      parStagiaire: true,
    },
  },
  {
    cle: 'retrait-provisoire',
    titre: 'Retrait provisoire du Bac',
    resume: 'Décharge temporaire',
    icone: BadgeCheck,
    // Canevas transmis (2026-10-02) : les groupes se choisissent d'abord.
    choixGroupes: {
      description:
        'Une page par stagiaire ; le baccalauréat, le motif et les dates de retrait et de remise se remplissent à la main.',
      formats: ['docx', 'pdf'],
      telecharger: exporterFeuillePresence('retrait-provisoire'),
      vierge: telechargerDocumentVierge('retrait-provisoire'),
      parStagiaire: true,
    },
  },
  {
    cle: 'convention',
    titre: 'Convention de stage',
    resume: 'Entre l’établissement et l’entreprise',
    icone: FileSignature,
    // Canevas transmis (2026-10-10) : les groupes se choisissent d'abord.
    choixGroupes: {
      description:
        'Une convention par stagiaire, avec la période de stage de son groupe ; l’entreprise, son représentant, le lieu et la date se remplissent à la main. Seuls les groupes qui ont une période de stage sont proposés.',
      formats: ['docx', 'pdf'],
      telecharger: exporterFeuillePresence('convention'),
      vierge: telechargerDocumentVierge('convention'),
      parStagiaire: true,
      // Seuls les groupes AYANT une période de stage (2026-10-11, demande du porteur).
      exigeStage: true,
      videGroupes: 'Aucun groupe n’a de période de stage : déclarez-les dans Paramètres → Stages.',
    },
  },
  {
    cle: 'transfert',
    titre: 'Formulaire de transfert',
    resume: 'Changement d’établissement',
    icone: ArrowRightLeft,
    // Canevas transmis (2026-10-11) : les groupes se choisissent d'abord.
    choixGroupes: {
      description:
        'Un formulaire par stagiaire, la partie du demandeur pré-remplie (identité, niveau scolaire, filière, niveau, année et mode cochés) ; l’établissement demandé, les motifs et les visas se remplissent à la main.',
      formats: ['docx', 'pdf'],
      telecharger: exporterFeuillePresence('transfert'),
      vierge: telechargerDocumentVierge('transfert'),
      parStagiaire: true,
    },
  },
  {
    cle: 'fils-agent',
    titre: 'Fiche du candidat fils d’agent OFPPT',
    resume: 'À joindre au dossier d’inscription',
    icone: UserCheck,
    // (2026-10-17) Une fiche VIERGE, téléchargée directement — ni groupe ni stagiaire à choisir.
    telecharger: telechargerDocumentVierge('fils-agent'),
  },
  {
    cle: 'reorientation',
    titre: 'PV de réorientation',
    resume: 'Changement de filière',
    icone: Shuffle,
    // Canevas transmis (2026-10-17) : groupes puis stagiaires, ou le PV vierge.
    choixGroupes: {
      description:
        'Un PV par stagiaire, pré-rempli (rentrée, complexe, EFP, nom, prénom, CEF, CIN, date de naissance, filière d’origine). La date, le type de réorientation, la filière d’accueil, la moyenne, les motifs et l’avis du CGCP se remplissent à la main.',
      formats: ['docx', 'pdf'],
      telecharger: exporterFeuillePresence('reorientation'),
      vierge: telechargerDocumentVierge('reorientation'),
      parStagiaire: true,
    },
  },
  {
    cle: 'soins',
    titre: 'Bon de soins',
    resume: 'Pour le service des Urgences',
    icone: Stethoscope,
    // Canevas transmis (2026-10-18) : un bon par stagiaire et par page.
    choixGroupes: {
      description:
        'Un bon par stagiaire, son nom et son groupe écrits, daté du jour. L’hôpital, la ville et le jour de la visite se remplissent à la main.',
      formats: ['docx', 'pdf'],
      telecharger: exporterFeuillePresence('soins'),
      vierge: telechargerDocumentVierge('soins'),
      parStagiaire: true,
    },
  },
  {
    cle: 'duplicata',
    titre: 'Demande de duplicata du diplôme',
    resume: 'À remplir par le lauréat',
    icone: Copy,
    // (2026-10-17) Groupes puis stagiaires choisis : une demande pré-remplie par stagiaire.
    choixGroupes: {
      description:
        'Une demande par stagiaire, pré-remplie (nom, prénom, naissance, n° d’inscription, CIN, niveau, filière, établissement). La promotion, les raisons de la demande, le lieu, la date et la signature se remplissent à la main.',
      formats: ['docx', 'pdf'],
      telecharger: exporterFeuillePresence('duplicata'),
      vierge: telechargerDocumentVierge('duplicata'),
      parStagiaire: true,
    },
  },
  {
    cle: 'reclamation',
    titre: 'Fiche de réclamation',
    resume: 'Incident signalé par un formateur',
    icone: FileWarning,
    // Canevas transmis (2026-10-11) : une fiche par groupe ; par stagiaire depuis « Notes de discipline ».
    choixGroupes: {
      description:
        'Une fiche par groupe, l’établissement et le groupe pré-remplis : le formateur, le surveillant et le conseil la remplissent à la main. Choisissez des stagiaires pour une fiche chacun, son nom écrit.',
      formats: ['docx', 'pdf'],
      telecharger: exporterFeuillePresence('reclamation'),
      vierge: telechargerDocumentVierge('reclamation'),
      parStagiaire: true,
    },
  },
  {
    cle: 'pv-discipline',
    titre: 'PV du conseil de discipline',
    resume: 'Procès-verbal de séance',
    icone: Gavel,
    // Canevas transmis (2026-10-11) : seuls les stagiaires qui relèvent du conseil.
    choixGroupes: {
      description:
        'Un PV par stagiaire qui relève du conseil de discipline (sanction de blâme ou d’exclusion, d’après sa note de discipline) : identité, filière, année, mode, téléphone et faits pré-remplis. Les motifs exposés, la décision et les signatures se remplissent à la main.',
      formats: ['docx', 'pdf'],
      telecharger: exporterFeuillePresence('pv-discipline'),
      vierge: telechargerDocumentVierge('pv-discipline'),
      parStagiaire: true,
    },
  },
  /*
   * ═══ FORMULAIRES D'EXAMEN VIERGES (2026-10-11, treize canevas transmis, « avec
   * le logo ») ═══ Remplis à la main par la commission le jour de l'épreuve :
   * Word ou PDF, logo OFPPT en tête — voir `exportFormulairesExamen.service.js`.
   */
  {
    cle: 'presence-surveillants',
    titre: 'Feuille de présence des surveillants',
    resume: 'Par session d’examen',
    icone: Users,
    telecharger: telechargerFormulaireExamen('presence-surveillants'),
  },
  {
    cle: 'pv-ouverture-enveloppes',
    titre: 'PV d’ouverture des enveloppes',
    resume: 'Épreuves, stagiaires, surveillants',
    icone: FileSignature,
    telecharger: telechargerFormulaireExamen('pv-ouverture-enveloppes'),
  },
  {
    cle: 'enveloppe-a',
    titre: 'Enveloppe A',
    resume: 'Copies et feuille de présence',
    icone: Mail,
    telecharger: telechargerFormulaireExamen('enveloppe-a'),
  },
  {
    cle: 'enveloppe-b',
    titre: 'Enveloppe B',
    resume: 'Souches des copies',
    icone: Mail,
    telecharger: telechargerFormulaireExamen('enveloppe-b'),
  },
  {
    cle: 'enveloppe-c',
    titre: 'Enveloppe C',
    resume: 'Enveloppes A et B réunies',
    icone: Mail,
    telecharger: telechargerFormulaireExamen('enveloppe-c'),
  },
  {
    cle: 'preparation-pratiques',
    titre: 'Fiche de préparation des examens pratiques',
    resume: 'Par le formateur préparateur',
    icone: ClipboardCheck,
    telecharger: telechargerFormulaireExamen('preparation-pratiques'),
  },
  {
    cle: 'deroulement-pratiques',
    titre: 'Fiche de déroulement des examens pratiques',
    resume: 'Par le formateur évaluateur',
    icone: ClipboardCheck,
    telecharger: telechargerFormulaireExamen('deroulement-pratiques'),
  },
  {
    cle: 'accuse-depot-retrait',
    titre: 'Accusé de dépôt et de retrait des paquets',
    resume: 'Copies envoyées à la correction',
    icone: FileCheck2,
    telecharger: telechargerFormulaireExamen('accuse-depot-retrait'),
  },
  {
    cle: 'accuse-copies-corriger',
    titre: 'Accusé de réception des copies à corriger',
    resume: 'Remise au correcteur',
    icone: FileCheck2,
    telecharger: telechargerFormulaireExamen('accuse-copies-corriger'),
  },
  {
    cle: 'pv-report-notes',
    titre: 'PV de report des notes',
    resume: 'Notes par code de copie',
    icone: ClipboardList,
    telecharger: telechargerFormulaireExamen('pv-report-notes'),
  },
  {
    cle: 'pv-fraude-deroulement',
    titre: 'PV de fraude — déroulement',
    resume: 'Constat pendant l’épreuve',
    icone: FileWarning,
    telecharger: telechargerFormulaireExamen('pv-fraude-deroulement'),
  },
  {
    cle: 'pv-fraude-correction',
    titre: 'PV de fraude — correction',
    resume: 'Constat à la correction',
    icone: FileWarning,
    telecharger: telechargerFormulaireExamen('pv-fraude-correction'),
  },
  {
    cle: 'cr-conseil-discipline',
    titre: 'Compte rendu du conseil de discipline',
    resume: 'Fraude aux examens',
    icone: Gavel,
    telecharger: telechargerFormulaireExamen('cr-conseil-discipline'),
  },
];

/*
 * ⚠️ GROUPÉS PAR USAGE (2026-09-28, demande du porteur : « grouper les
 * documents en catégories »). Le regroupement est ici, pas dans chaque
 * document : un document ajouté choisit sa catégorie en une ligne.
 */
/** Combien de documents une tuile REPLIÉE nomme ; les autres se comptent. */
const APERCU_MAX = 3;

const CATEGORIES = [
  {
    titre: 'Examen',
    cles: [
      'convocation',
      'presence-eff',
      'presence-cc-efm',
      'liste',
      'badges-table',
      'badges-simples',
      'presence-surveillants',
      'pv-ouverture-enveloppes',
      'enveloppe-a',
      'enveloppe-b',
      'enveloppe-c',
      'preparation-pratiques',
      'deroulement-pratiques',
      'accuse-depot-retrait',
      'accuse-copies-corriger',
      'pv-report-notes',
      'pv-fraude-deroulement',
      'pv-fraude-correction',
      'cr-conseil-discipline',
    ],
    icone: ClipboardList,
  },
  {
    titre: 'Absences',
    cles: ['feuille-absence', 'billet-absence'],
    icone: ClipboardCheck,
  },
  {
    titre: 'Diplômes',
    cles: ['checklist', 'verification', 'retrait-definitif', 'retrait-provisoire', 'duplicata'],
    icone: GraduationCap,
  },
  {
    titre: 'Administration',
    cles: ['carte', 'convention', 'transfert', 'reorientation', 'attestation-poursuite', 'soins', 'fils-agent'],
    icone: Briefcase,
  },
  {
    titre: 'Discipline',
    cles: ['reclamation', 'pv-discipline'],
    icone: Gavel,
  },
].map((categorie) => ({
  ...categorie,
  documents: categorie.cles.map((cle) => DOCUMENTS.find((d) => d.cle === cle)),
}));

/** Sans accents ni majuscules : « reclamation » trouve « Fiche de réclamation ». */
const normaliser = (texte) =>
  String(texte ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/**
 * ═══ LA RECHERCHE DE DOCUMENTS (2026-10-19, demande du porteur : « une barre
 * de recherche pour les documents ») ═══ Sur le titre, le résumé et la
 * catégorie de chaque document ; chaque mot tapé doit s'y trouver. Le document
 * garde sa catégorie, rappelée sous la carte des résultats.
 */
function rechercherDocuments(recherche) {
  const mots = normaliser(recherche).split(/\s+/).filter(Boolean);
  if (mots.length === 0) return null;
  return CATEGORIES.flatMap((categorie) =>
    categorie.documents
      .filter((document) => {
        const texte = normaliser(`${document.titre} ${document.resume ?? ''} ${categorie.titre}`);
        return mots.every((mot) => texte.includes(mot));
      })
      .map((document) => ({ document, categorie: categorie.titre }))
  );
}

/** La feuille d'un document : avec sa fenêtre, téléchargée directement, ou à venir. */
function TuileDocument({ document, pret }) {
  if (document.choixGroupes) return <DocumentAvecDialogue document={document} attenue={!pret} />;
  if (document.telecharger) return <DocumentTelechargeable document={document} />;
  return <FeuilleDocument document={document} attenue={!pret} />;
}

export default function CartesDocuments({ nombreStagiaires }) {
  const pret = nombreStagiaires > 0;
  const [recherche, setRecherche] = useState('');
  const resultats = rechercherDocuments(recherche);
  // La catégorie dépliée — `null` : toutes repliées, en petites tuiles.
  const [ouverte, setOuverte] = useState(null);
  // La catégorie dépliée, partagée pendant le guidage (2026-10-04).
  useEtatPartage('documents.categorie', ouverte, (valeur) => setOuverte(typeof valeur === 'string' ? valeur : null));
  const categorieOuverte = CATEGORIES.find((c) => c.titre === ouverte) ?? null;
  const repliees = CATEGORIES.filter((c) => c !== categorieOuverte);

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-sm font-medium">Documents imprimables</h2>
          {/* Sans base seulement : « Disponibles en Phase 10 » est retiré (2026-10-19, demande du porteur). */}
          {!pret && <span className="text-xs text-muted-foreground">Importez d’abord votre base Konosys.</span>}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={recherche}
            onChange={(evenement) => setRecherche(evenement.target.value)}
            placeholder="Rechercher un document…"
            aria-label="Rechercher un document"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </header>

      {/* Pendant une recherche, les catégories cèdent la place à ses résultats. */}
      {resultats && (
        <div className="overflow-hidden rounded-xl border">
          <p className="flex items-center gap-3 border-b px-4 py-2.5">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium">Résultats</span>
            <span className="text-xs text-muted-foreground">
              {resultats.length} document{resultats.length > 1 ? 's' : ''}
            </span>
          </p>
          {resultats.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Aucun document ne correspond à « {recherche.trim()} ».</p>
          ) : (
            <div className="flex flex-wrap gap-4 p-4">
              {resultats.map(({ document, categorie }) => (
                <div key={document.cle} className="flex flex-col items-center gap-1.5">
                  <TuileDocument document={document} pret={pret} />
                  <span className="text-[0.65rem] text-muted-foreground">{categorie}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/*
        ⚠️ TOUTES PETITES AU DÉPART, LA CLIQUÉE GRANDIT (2026-09-28, demande du
        porteur, avec deux maquettes de tuiles en référence) : au repos, quatre
        tuiles en grille ; au clic, la catégorie choisie s'étale en grande
        carte — bandeau de titre et petites cartes de documents — et les trois
        autres restent en tuiles dessous. Un clic sur le bandeau replie.
      */}
      {!resultats && categorieOuverte && (
        <div
          // ⚠️ `key` : changer de catégorie REMONTE la carte, donc rejoue
          // l'entrée. `motion-reduce` respecte le réglage système « moins
          // d'animations ».
          key={categorieOuverte.titre}
          className="overflow-hidden rounded-xl border duration-300 animate-in fade-in-0 zoom-in-95 slide-in-from-top-3 motion-reduce:animate-none"
        >
          <button
            type="button"
            aria-expanded="true"
            onClick={() => setOuverte(null)}
            className="flex w-full items-center gap-3 border-b px-4 py-2.5 text-left hover:bg-muted/40"
          >
            <categorieOuverte.icone className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium">{categorieOuverte.titre}</span>
            <span className="text-xs text-muted-foreground">
              {categorieOuverte.documents.length} documents
            </span>
            <ChevronDown className="ml-auto size-4 rotate-180 text-muted-foreground" />
          </button>

          {/*
            ⚠️ DE VRAIES FEUILLES (2026-09-28, demande du porteur : « les cartes
            sous forme de documents réels ») : format portrait A4 (210 × 297),
            coin supérieur droit corné, titre en tête de page, traits de texte
            en pied. Largeur fixe — un A4 étiré sur un quart de l'écran
            ressemblerait à une bannière, pas à une feuille.
          */}
          <div className="flex flex-wrap gap-4 p-4">
            {categorieOuverte.documents.map((document) => (
              <TuileDocument key={document.cle} document={document} pret={pret} />
            ))}
          </div>
        </div>
      )}

      <div
        className={cn(
          'grid gap-3',
          resultats && 'hidden',
          categorieOuverte ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'
        )}
      >
        {repliees.map((categorie) => {
          const apercu = categorie.documents.slice(0, APERCU_MAX);
          const reste = categorie.documents.length - apercu.length;
          return (
            /*
              ⚠️ UN RECTANGLE À L'HORIZONTALE, ET UN APERÇU COURT (2026-09-28,
              demande du porteur : « horizontalement, format rectangle, sans
              afficher tous les documents en état petit ») : la zone teintée à
              gauche montre `APERCU_MAX` documents et « + N » pour le reste ; le
              titre et le compte sont à droite. La liste entière est dans la
              grande carte, au clic.
            */
            <button
              key={categorie.titre}
              type="button"
              aria-expanded="false"
              onClick={() => setOuverte(categorie.titre)}
              className="relative flex overflow-hidden rounded-xl border text-left transition-colors duration-200 animate-in fade-in-0 zoom-in-95 hover:border-border-strong motion-reduce:animate-none"
            >
              <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-4 py-3">
                <categorie.icone className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">{categorie.titre}</span>
                <span className="text-xs text-muted-foreground">
                  {categorie.documents.length} documents
                </span>
              </span>

              {/* Dans le coin (2026-10-01, demande du porteur) : au bout de la
                  ligne du compte, la flèche tombait entre le titre et les
                  feuilles. */}
              <ChevronDown className="absolute right-3 top-3 size-4 text-muted-foreground" />

              {/* Sans teinte de fond (2026-10-01, demande du porteur), ni ici ni
                  sur l'icône de la carte dépliée. */}
              <span className="relative flex w-[55%] min-w-0 items-center justify-center px-3 py-4">
                {/*
                  ⚠️ DES FEUILLES, PAS DES LIGNES DE LISTE (2026-09-28, demande du
                  porteur, avec une illustration de feuilles superposées en
                  référence) : chaque document est une petite feuille — icône en
                  tête, traits de texte gris — posée en éventail sur la
                  précédente. La liste entière est dans la grande carte.

                  ⚠️ LE TITRE SEUL, SANS LE RÉSUMÉ (2026-09-29, demande du
                  porteur : « afficher le nom du document comme les grandes,
                  seulement le titre ») : la feuille s'élargit un peu pour le
                  porter, coupé à trois lignes — le nom complet reste au survol.
                */}
                {apercu.map(({ cle, titre, icone: Icone }, rang) => (
                  <span
                    key={cle}
                    title={titre}
                    style={{ transform: `rotate(${(rang - (apercu.length - 1) / 2) * 7}deg)` }}
                    className="-ml-5 flex h-24 w-[4.5rem] shrink-0 flex-col gap-1 rounded-md border bg-background p-1.5 first:ml-0"
                  >
                    <Icone className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="line-clamp-3 text-[0.55rem] font-semibold leading-tight text-foreground">
                      {titre}
                    </span>
                    <span className="mt-auto h-1 w-full shrink-0 rounded-full bg-muted" />
                    <span className="h-1 w-3/5 shrink-0 rounded-full bg-muted" />
                  </span>
                ))}
                {reste > 0 && (
                  <span className="absolute bottom-1.5 right-2 rounded-full bg-background px-1.5 text-[0.65rem] font-medium text-foreground">
                    + {reste}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Une petite feuille A4 : coin corné, icône, titre, traits de texte, et en pied
 * `pied` — « Phase 10 » tant que le document n'est pas produit.
 */
export function FeuilleDocument({ document: { titre, resume, icone: Icone }, attenue = false, pied = 'Phase 10', className }) {
  return (
    <span
      className={cn(
        'relative flex aspect-[210/297] w-36 flex-col gap-1.5 overflow-hidden rounded-md border bg-background p-3 text-left shadow-sm transition-transform duration-200 hover:-translate-y-0.5',
        // Sans base, les cartes s'effacent : elles disent ce qui viendra,
        // mais rien ne peut encore être produit.
        attenue && 'opacity-60',
        className
      )}
    >
      {/* Le coin corné : un triangle de fond qui coupe l'angle, un rabat gris dessus. */}
      <span
        aria-hidden="true"
        className="absolute right-0 top-0 size-6 bg-muted/40 [clip-path:polygon(0_0,100%_0,100%_100%)]"
      />
      <span
        aria-hidden="true"
        className="absolute right-0 top-0 size-6 border-b border-l bg-muted [clip-path:polygon(0_0,100%_100%,0_100%)]"
      />

      <span className="flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icone className="size-4" />
      </span>

      <span className="min-w-0">
        <span className="block text-[0.7rem] font-semibold leading-tight">{titre}</span>
        <span className="mt-0.5 block text-[0.65rem] leading-tight text-muted-foreground">{resume}</span>
      </span>

      <span className="mt-1 flex flex-col gap-1.5">
        <span className="h-1 w-full rounded-full bg-muted" />
        <span className="h-1 w-full rounded-full bg-muted" />
        <span className="h-1 w-4/5 rounded-full bg-muted" />
        <span className="h-1 w-full rounded-full bg-muted" />
        <span className="h-1 w-3/5 rounded-full bg-muted" />
      </span>

      <Badge variant="outline" className="mt-auto w-fit text-[0.65rem] font-normal text-muted-foreground">
        {pied}
      </Badge>
    </span>
  );
}

/**
 * Un document DÉJÀ PRODUIT : la feuille se clique et propose Word ou PDF.
 * ⚠️ PAS ATTÉNUÉ SANS BASE KONOSYS : un billet vierge ne lit aucun stagiaire.
 */
export function DocumentTelechargeable({ document }) {
  const telechargement = useMutation({
    mutationFn: document.telecharger,
    onError: (erreur) => toast.error('Téléchargement impossible', { description: erreur.message }),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={telechargement.isPending}
          aria-label={`Télécharger : ${document.titre}`}
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FeuilleDocument
            document={document}
            pied={
              telechargement.isPending ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" />
                  Préparation…
                </span>
              ) : (
                'Word · PDF'
              )
            }
            className="cursor-pointer hover:border-border-strong"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem onSelect={() => telechargement.mutate('docx')}>
          <FileText className="size-3.5 text-blue-600" />
          Télécharger en Word
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => telechargement.mutate('pdf')}>
          <File className="size-3.5 text-red-600" />
          Télécharger en PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Un document qui demande un CHOIX avant d'être produit (groupes, semaine…) :
 * la feuille ouvre son dialogue, qui télécharge.
 * ⚠️ ATTÉNUÉ SANS BASE KONOSYS, comme les autres : la feuille porte les noms
 * des stagiaires importés, et sortirait vide.
 */
const LIBELLES_FORMAT = { docx: 'Word', pdf: 'PDF', xlsx: 'Excel' };

export function DocumentAvecDialogue({ document, attenue }) {
  const [ouvert, setOuvert] = useState(false);
  // La fenêtre de CE document, partagée pendant le guidage (2026-10-04) — enveloppée :
  // un état partagé est un objet, une liste ou une chaîne, jamais un booléen nu.
  useEtatPartage(`documents.fenetre.${empreinte(document.titre)}`, { ouvert }, (valeur) =>
    setOuvert(Boolean(valeur?.ouvert))
  );
  const { exigeStage = false, ...choixGroupes } = document.choixGroupes;

  /*
   * ⚠️ LA CONVENTION DE STAGE NE PROPOSE QUE LES GROUPES QUI ONT UNE PÉRIODE DE
   * STAGE (2026-10-11, demande du porteur) : une convention sans dates ne
   * servirait à rien. Les périodes sont celles de Paramètres → Stages, lues à
   * l'ouverture de la fenêtre — la même requête que le bloc « À venir » de l'accueil.
   */
  const etablissement = useQuery({
    queryKey: ['etablissement-courant'],
    queryFn: chargerEtablissementCourant,
    enabled: exigeStage && ouvert,
    retry: false,
  });
  const avecStage = new Set((etablissement.data?.etablissement?.stages ?? []).map((stage) => stage.groupe));
  const groupesAdmis = exigeStage ? (groupe) => avecStage.has(groupe) : choixGroupes.groupesAdmis;

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        aria-label={`Télécharger : ${document.titre}`}
        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FeuilleDocument
          document={document}
          attenue={attenue}
          pied={choixGroupes.formats.map((f) => LIBELLES_FORMAT[f]).join(' · ')}
          className="cursor-pointer hover:border-border-strong"
        />
      </button>
      <DialogueChoixGroupes
        ouvert={ouvert}
        onFermer={() => setOuvert(false)}
        titre={document.titre}
        {...choixGroupes}
        groupesAdmis={groupesAdmis}
      />
    </>
  );
}
