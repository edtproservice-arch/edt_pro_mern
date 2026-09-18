import {
  BadgeCheck,
  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  IdCard,
  Mail,
  Table2,
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
    resume: 'Placement en salle d’examen',
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
];

export default function CartesDocuments({ nombreStagiaires }) {
  const pret = nombreStagiaires > 0;

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Documents imprimables</h2>
        <span className="text-xs text-muted-foreground">
          {pret
            ? 'Disponibles en Phase 10 — la base est déjà prête.'
            : 'Importez d’abord votre base Konosys.'}
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {DOCUMENTS.map(({ cle, titre, resume, icone: Icone }) => (
          <div
            key={cle}
            className={cn(
              'flex flex-col gap-2 rounded-lg border p-4',
              // Sans base, les cartes s'effacent : elles disent ce qui viendra,
              // mais rien ne peut encore être produit.
              !pret && 'opacity-60'
            )}
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Icone className="size-4" />
            </span>

            <span className="min-w-0">
              <span className="block text-sm font-medium">{titre}</span>
              <span className="block text-xs text-muted-foreground">{resume}</span>
            </span>

            <Badge variant="outline" className="w-fit font-normal text-muted-foreground">
              Phase 10
            </Badge>
          </div>
        ))}
      </div>
    </section>
  );
}
