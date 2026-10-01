import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowRightLeft,
  BadgeCheck,
  Briefcase,
  ChevronDown,
  GraduationCap,
  ClipboardCheck,
  ClipboardList,
  File,
  FileCheck2,
  FileSignature,
  FileText,
  FileWarning,
  Gavel,
  IdCard,
  Mail,
  Table2,
  Ticket,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { telechargerBilletsVierges } from '@/features/absences/stagiaires/api';
import DialogueFeuilleAbsence from './DialogueFeuilleAbsence';

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
  },
  {
    cle: 'numeros',
    titre: 'Numéros de table',
    resume: 'Placement en espace d’examen',
    icone: Table2,
  },
  {
    cle: 'presence-eff',
    titre: 'Feuille de présence EFF',
    resume: 'Examen de fin de formation',
    icone: ClipboardList,
  },
  {
    cle: 'presence-cc-efm',
    titre: 'Feuille de présence CC/EFM',
    resume: 'Contrôle continu et EFM',
    icone: ClipboardList,
  },
  {
    cle: 'verification',
    titre: 'Liste de vérification',
    resume: 'Contrôle des inscriptions',
    icone: FileCheck2,
  },
  {
    cle: 'checklist',
    titre: 'Check-list des diplômes',
    resume: 'Pièces à réunir',
    icone: BadgeCheck,
  },
  {
    cle: 'convocation',
    titre: 'Convocation à l’EFF',
    resume: 'Examen de fin de formation',
    icone: Mail,
  },
  {
    cle: 'carte',
    titre: 'Carte de stagiaire',
    resume: 'Badge avec photo et QR',
    icone: IdCard,
  },
  {
    cle: 'badges-table',
    titre: 'Badges de numéros de table',
    resume: 'Avec les informations du stagiaire',
    icone: Ticket,
  },
  {
    cle: 'badges-simples',
    titre: 'Badges de numéros',
    resume: 'Sans informations',
    icone: Ticket,
  },
  {
    cle: 'feuille-absence',
    titre: 'Feuille d’absence hebdomadaire',
    resume: 'Par groupe, semaine par semaine',
    icone: ClipboardList,
    // Le canevas de « Faire l'appel » : groupes et semaine se choisissent d'abord (2026-10-01).
    Dialogue: DialogueFeuilleAbsence,
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
  },
  {
    cle: 'retrait-definitif',
    titre: 'Retrait définitif du Bac',
    resume: 'Décharge du diplôme',
    icone: BadgeCheck,
  },
  {
    cle: 'retrait-provisoire',
    titre: 'Retrait provisoire du Bac',
    resume: 'Décharge temporaire',
    icone: BadgeCheck,
  },
  {
    cle: 'convention',
    titre: 'Convention de stage',
    resume: 'Entre l’établissement et l’entreprise',
    icone: FileSignature,
  },
  {
    cle: 'transfert',
    titre: 'Formulaire de transfert',
    resume: 'Changement d’établissement',
    icone: ArrowRightLeft,
  },
  {
    cle: 'reclamation',
    titre: 'Fiche de réclamation',
    resume: 'Discipline, récupération automatique',
    icone: FileWarning,
  },
  {
    cle: 'pv-discipline',
    titre: 'PV du conseil de discipline',
    resume: 'Procès-verbal de séance',
    icone: Gavel,
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
    cles: ['convocation', 'presence-eff', 'presence-cc-efm','liste', 'numeros', 'badges-table', 'badges-simples'],
    icone: ClipboardList,
  },
  {
    titre: 'Absences',
    cles: ['feuille-absence', 'billet-absence'],
    icone: ClipboardCheck,
  },
  {
    titre: 'Diplômes',
    cles: ['checklist', 'verification', 'retrait-definitif', 'retrait-provisoire'],
    icone: GraduationCap,
  },
  {
    titre: 'Administration',
    cles: ['carte', 'convention', 'transfert', 'attestation-poursuite'],
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


export default function CartesDocuments({ nombreStagiaires }) {
  const pret = nombreStagiaires > 0;
  // La catégorie dépliée — `null` : toutes repliées, en petites tuiles.
  const [ouverte, setOuverte] = useState(null);
  const categorieOuverte = CATEGORIES.find((c) => c.titre === ouverte) ?? null;
  const repliees = CATEGORIES.filter((c) => c !== categorieOuverte);

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Documents imprimables</h2>
        <span className="text-xs text-muted-foreground">
          {pret
            ? 'Disponibles en Phase 10 — la base est déjà prête.'
            : 'Importez d’abord votre base Konosys.'}
        </span>
      </header>

      {/*
        ⚠️ TOUTES PETITES AU DÉPART, LA CLIQUÉE GRANDIT (2026-09-28, demande du
        porteur, avec deux maquettes de tuiles en référence) : au repos, quatre
        tuiles en grille ; au clic, la catégorie choisie s'étale en grande
        carte — bandeau de titre et petites cartes de documents — et les trois
        autres restent en tuiles dessous. Un clic sur le bandeau replie.
      */}
      {categorieOuverte && (
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
            {categorieOuverte.documents.map((document) =>
              document.Dialogue ? (
                <DocumentAvecDialogue key={document.cle} document={document} attenue={!pret} />
              ) : document.telecharger ? (
                <DocumentTelechargeable key={document.cle} document={document} />
              ) : (
                <FeuilleDocument key={document.cle} document={document} attenue={!pret} />
              )
            )}
          </div>
        </div>
      )}

      <div
        className={cn(
          'grid gap-3',
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
function FeuilleDocument({ document: { titre, resume, icone: Icone }, attenue = false, pied = 'Phase 10', className }) {
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
function DocumentTelechargeable({ document }) {
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
            pied={telechargement.isPending ? 'Préparation…' : 'Word · PDF'}
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
function DocumentAvecDialogue({ document, attenue }) {
  const [ouvert, setOuvert] = useState(false);
  const { Dialogue } = document;

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
          pied="Word · PDF · Excel"
          className="cursor-pointer hover:border-border-strong"
        />
      </button>
      <Dialogue ouvert={ouvert} onFermer={() => setOuvert(false)} />
    </>
  );
}
