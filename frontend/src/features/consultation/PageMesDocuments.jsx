import { useQuery } from '@tanstack/react-query';
import { ROLES } from 'shared/constants';
import { recupererSession } from '@/features/auth/api';
import PageDocumentsStagiaire from './PageDocumentsStagiaire';
import { ClipboardList } from 'lucide-react';
import Alerte from '@/components/common/Alerte';
import CadreReglage from '@/features/parametres/CadreReglage';
import { DocumentAvecDialogue } from '@/features/documents/CartesDocuments';
import { telechargerDocumentVierge } from '@/features/absences/stagiaires/api';
import { chargerDocumentsConsultation, exporterPresenceCcEfmConsultation } from './api';
import DocumentReclamation from './DocumentReclamation';

/**
 * ═══ LES DOCUMENTS DU FORMATEUR (2026-10-23, demande du porteur) ═══
 * Les documents qui le concernent, à télécharger pour SES groupes — d'abord la
 * feuille de présence CC/EFM. La même tuile et la même fenêtre que la page
 * Documents du directeur, mais la liste des groupes vient du serveur, réduite aux
 * siens ; le serveur refuse tout autre groupe.
 */
/** Une URL, deux pages : le stagiaire a la sienne (2026-10-23) — voir `PageDocumentsStagiaire`. */
export default function PageMesDocuments() {
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  if (session.isLoading) return null;
  return session.data?.utilisateur?.role === ROLES.STAGIAIRE ? <PageDocumentsStagiaire /> : <PageDocumentsFormateur />;
}

function PageDocumentsFormateur() {
  const requete = useQuery({
    queryKey: ['consultation', 'documents'],
    queryFn: chargerDocumentsConsultation,
    retry: false,
  });
  const groupes = requete.data?.groupes ?? [];

  const documents = [
    {
      cle: 'presence-cc-efm',
      titre: 'Feuille de présence CC/EFM',
      resume: 'Contrôle continu et EFM',
      icone: ClipboardList,
      choixGroupes: {
        description:
          'Une page par groupe ; le module, la date, l’horaire et le type d’épreuve se remplissent à la main.',
        formats: ['docx', 'pdf'],
        telecharger: exporterPresenceCcEfmConsultation,
        vierge: telechargerDocumentVierge('cc-efm'),
        groupesFournis: groupes,
      },
    },
  ];

  return (
    <CadreReglage
      titre="Mes documents"
      chargement={requete.isLoading}
      erreur={requete.isError ? requete.error.message : null}
    >
      {groupes.length === 0 && (
        <Alerte type="info" titre="Aucun groupe">
          Vous n’êtes affecté à aucun groupe cette année scolaire : seuls les exemplaires vierges sont disponibles.
        </Alerte>
      )}
      {/* Des feuilles de largeur fixe, côte à côte — comme la page Documents du directeur (2026-10-26). */}
      <div className="flex flex-wrap gap-4">
        {documents.map((document) => (
          <DocumentAvecDialogue key={document.cle} document={document} />
        ))}
        {/* Remplie depuis une de SES séances (2026-10-25) — sa propre fenêtre. */}
        <DocumentReclamation />
      </div>
    </CadreReglage>
  );
}
