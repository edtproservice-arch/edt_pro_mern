import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { recupererSession } from '@/features/auth/api';
import { Etat, LiensRapides, Salutation } from './AccueilApp';
import StatistiquesAbsencesDiscipline from './StatistiquesAbsencesDiscipline';
import AVenirPeriodes from './AVenirPeriodes';

/**
 * ═══ L'ACCUEIL DU GESTIONNAIRE ═══ (2026-09-29, demande du porteur : « une
 * page d'accueil pour gestionnaire comme celui dans le directeur, mais avec
 * des statistiques sur l'absence et la discipline des stagiaires et d'autres
 * informations qui le concernent »).
 *
 * ⚠️ PAS `AccueilApp` : celui du directeur montre l'ÉTABLISSEMENT ENTIER —
 * avancement, chronogrammes, service des formateurs — ce que le gestionnaire
 * ne gère pas (cf. `URLS_GESTIONNAIRE`, `navigation.js`). Le sien reprend
 * seulement le CADRE (salutation, liens rapides, récents) et remplace le
 * tableau de bord par ce qui relève de son rôle.
 *
 * ⚠️ LES STATISTIQUES SONT PARTAGÉES avec l'accueil du directeur
 * (`StatistiquesAbsencesDiscipline`, 2026-09-29, demande du porteur : « je
 * veux que ces stats s'affichent aussi en accueil directeur ») : écrites une
 * fois, posées aux deux endroits.
 */
export default function AccueilGestionnaire() {
  const navigate = useNavigate();
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });

  if (session.isLoading) return <Etat>Chargement de la session…</Etat>;
  if (session.isError) {
    return (
      <Etat>
        Session expirée.{' '}
        <button
          type="button"
          className="px-1 text-primary underline-offset-4 hover:underline"
          onClick={() => navigate('/connexion')}
        >
          Se reconnecter
        </button>
      </Etat>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-10 py-4">
      <Salutation nom={session.data.utilisateur.nomComplet} />
      <StatistiquesAbsencesDiscipline />
      {/* Sous ses statistiques (2026-10-10, demande du porteur), comme « À venir »
          sous les tuiles du directeur. ⚠️ Sans lien : Stages et Formations ne
          sont pas des pages du gestionnaire. */}
      <AVenirPeriodes liens={false} />
      <LiensRapides />
    </div>
  );
}
