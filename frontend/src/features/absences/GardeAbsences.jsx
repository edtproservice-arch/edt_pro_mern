import { useQuery } from '@tanstack/react-query';
import { ROLES } from 'shared/constants';
import { recupererSession } from '@/features/auth/api';
import GardePage from '@/features/partages/GardePage';

/**
 * La garde de la page « Absences » (F9, 2026-09-14).
 *
 * ⚠️ LE GESTIONNAIRE ENTRE PAR SON RÔLE, les autres par leur droit sur la page :
 * il y saisit les absences des STAGIAIRES (décision du porteur), sans droit sur
 * le registre des formateurs — la page ne lui montre alors que l'onglet
 * « Stagiaires ». Le serveur fait la même coupe, route par route.
 */
export default function GardeAbsences({ children }) {
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  if (session.isLoading) return null;
  if (session.data?.utilisateur?.role === ROLES.GESTIONNAIRE) return children;
  return (
    <GardePage page="absences" requis="consulter">
      {children}
    </GardePage>
  );
}
