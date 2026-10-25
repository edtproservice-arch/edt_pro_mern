import { useQuery } from '@tanstack/react-query';
import { ROLES } from 'shared/constants';
import { recupererSession } from '@/features/auth/api';
import PageDocumentsStagiaire from './PageDocumentsStagiaire';
import Alerte from '@/components/common/Alerte';
import CadreReglage from '@/features/parametres/CadreReglage';
import { chargerDocumentsConsultation } from './api';
import DocumentPresenceCcEfm from './DocumentPresenceCcEfm';
import DocumentReclamation from './DocumentReclamation';

/**
 * ═══ LES DOCUMENTS DU FORMATEUR (2026-10-23, demande du porteur) ═══
 * Les documents qui le concernent, pour SES cours. Depuis le 2026-10-26, chacun
 * part d'une de SES séances, choisie dans son emploi du temps (`ChoixSeance`) :
 * la feuille de présence CC/EFM (« je sélectionne la séance et je coche ») et la
 * fiche de réclamation. Le serveur vérifie que la séance est bien la sienne.
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

  return (
    <CadreReglage
      titre="Mes documents"
      chargement={requete.isLoading}
      erreur={requete.isError ? requete.error.message : null}
    >
      {requete.data && groupes.length === 0 && (
        <Alerte type="info" titre="Aucun groupe">
          Vous n’êtes affecté à aucun groupe cette année scolaire : seuls les exemplaires vierges sont disponibles.
        </Alerte>
      )}
      {/* Des feuilles de largeur fixe, côte à côte — comme la page Documents du directeur (2026-10-26). */}
      <div className="flex flex-wrap gap-4">
        <DocumentPresenceCcEfm />
        <DocumentReclamation />
      </div>
    </CadreReglage>
  );
}
