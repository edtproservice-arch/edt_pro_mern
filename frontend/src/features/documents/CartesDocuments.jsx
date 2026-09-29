import { useState } from 'react';
import {
  ArrowRightLeft,
  BadgeCheck,
  Briefcase,
  ChevronDown,
  GraduationCap,
  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  FileSignature,
  FileText,
  FileWarning,
  Gavel,
  IdCard,
  Mail,
  Table2,
  Ticket,
  UserCheck,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

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
    cle: 'presence',
    titre: 'Feuille d’émargement',
    resume: 'Présence ordinaire',
    icone: ClipboardCheck,
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
  },
  {
    cle: 'billet-absence',
    titre: 'Billet d’absence',
    resume: 'Justification de l’absence',
    icone: FileText,
  },
  {
    cle: 'rapport-absences',
    titre: 'Rapport d’absences',
    resume: 'Bilan sur une période',
    icone: FileText,
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
    cle: 'affectation',
    titre: 'Affectation du formateur',
    resume: 'Groupes et modules attribués',
    icone: UserCheck,
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
    titre: 'Listes et affichage',
    cles: ['liste', 'numeros', 'badges-table', 'badges-simples'],
    icone: Users,
    teinte: 'bg-accent-purple/25 text-accent-purple-deep',
  },
  {
    titre: 'Présence et absences',
    cles: ['presence', 'presence-eff', 'feuille-absence', 'billet-absence', 'rapport-absences'],
    icone: ClipboardCheck,
    teinte: 'bg-accent-teal/20 text-accent-teal',
  },
  {
    titre: 'Examen et diplômes',
    cles: ['convocation', 'checklist', 'attestation-poursuite', 'retrait-definitif', 'retrait-provisoire'],
    icone: GraduationCap,
    teinte: 'bg-accent-orange/20 text-accent-orange-deep',
  },
  {
    titre: 'Administration',
    cles: ['verification', 'carte', 'convention', 'transfert', 'affectation'],
    icone: Briefcase,
    teinte: 'bg-accent-green/20 text-accent-green-deep',
  },
  {
    titre: 'Discipline',
    cles: ['reclamation', 'pv-discipline'],
    icone: Gavel,
    teinte: 'bg-accent-sky/25 text-accent-sky-deep',
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
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-lg',
                categorieOuverte.teinte
              )}
            >
              <categorieOuverte.icone className="size-4" />
            </span>
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
            {categorieOuverte.documents.map(({ cle, titre, resume, icone: Icone }) => (
              <div
                key={cle}
                className={cn(
                  'relative flex aspect-[210/297] w-36 flex-col gap-1.5 overflow-hidden rounded-md border bg-background p-3 shadow-sm transition-transform duration-200 hover:-translate-y-0.5',
                  // Sans base, les cartes s'effacent : elles disent ce qui viendra,
                  // mais rien ne peut encore être produit.
                  !pret && 'opacity-60'
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
                  <span className="mt-0.5 block text-[0.65rem] leading-tight text-muted-foreground">
                    {resume}
                  </span>
                </span>

                <span className="mt-1 flex flex-col gap-1.5">
                  <span className="h-1 w-full rounded-full bg-muted" />
                  <span className="h-1 w-full rounded-full bg-muted" />
                  <span className="h-1 w-4/5 rounded-full bg-muted" />
                  <span className="h-1 w-full rounded-full bg-muted" />
                  <span className="h-1 w-3/5 rounded-full bg-muted" />
                </span>

                <Badge variant="outline" className="mt-auto w-fit text-[0.65rem] font-normal text-muted-foreground">
                  Phase 10
                </Badge>
              </div>
            ))}
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
              className="flex overflow-hidden rounded-xl border text-left transition-colors duration-200 animate-in fade-in-0 zoom-in-95 hover:border-border-strong motion-reduce:animate-none"
            >
              <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-4 py-3">
                <categorie.icone className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">{categorie.titre}</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {categorie.documents.length} documents
                  <ChevronDown className="ml-auto size-4 shrink-0" />
                </span>
              </span>

              <span
                className={cn(
                  'relative flex w-[55%] min-w-0 items-center justify-center px-3 py-4',
                  categorie.teinte
                )}
              >
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
