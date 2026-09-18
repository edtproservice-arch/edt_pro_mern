import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { recupererSession } from '@/features/auth/api';

/**
 * Garde de route par RÔLE.
 * (2026-09-03, demande du porteur : formateur, stagiaire et gestionnaire
 * n'ouvrent chacun qu'une partie de l'application.)
 *
 * ═══ ⚠️ ELLE NE REMPLACE PAS LA SÉCURITÉ SERVEUR, ELLE ÉVITE L'ÉCRAN CASSÉ ═══
 * Le serveur refuse déjà chaque route hors du rôle (`requireRole` — voir
 * `seances.routes.js`, `avancement.routes.js`, `consultation.routes.js`) :
 * c'est LUI la vraie frontière. Sans cette garde côté écran, un formateur
 * tapant `/app/emploi` verrait quand même `PageEmploi` se monter et échouer
 * requête après requête, avec des alertes qui ne disent pas pourquoi. Ici, on
 * le renvoie tout de suite vers un endroit qui le concerne.
 *
 * ⚠️ LE MÊME `['session']` QUE LA COQUILLE : aucune requête de plus, le cache
 * de TanStack Query la sert déjà.
 */
export default function GardeRole({ roles, children }) {
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });

  // Le temps que la session réponde, la coquille affiche déjà ses propres
  // squelettes de chargement : rien à rendre ici ne ferait qu'un clignotement.
  if (session.isLoading) return null;

  const role = session.data?.utilisateur?.role;
  if (!role || !roles.includes(role)) return <Navigate to="/app" replace />;

  return children;
}
