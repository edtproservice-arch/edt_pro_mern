import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { ROLES } from 'shared/constants';
import { recupererSession } from '@/features/auth/api';
import AccueilApp from './AccueilApp';

/**
 * `/app` (l'index) — et c'est le SEUL endroit qui ne peut pas utiliser
 * `GardeRole` tel quel : son repli est `/app`, ce qui boucle sur lui-même
 * pour un rôle qui n'y a pas sa place.
 *
 * ⚠️ `AccueilApp` MONTRE L'ÉTABLISSEMENT ENTIER — formateurs, groupes,
 * séances saisies. Un formateur ou un stagiaire qui y atterrirait verrait des
 * tuiles qui ne le concernent pas, menant à des écrans que son rôle n'ouvre
 * pas. On l'envoie directement là où son rôle commence.
 */
export default function AccueilRouteur() {
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });

  if (session.isLoading) return null;

  const role = session.data?.utilisateur?.role;
  if (role === ROLES.FORMATEUR || role === ROLES.STAGIAIRE) {
    return <Navigate to="/app/mon-emploi" replace />;
  }
  // Le gestionnaire n'a ni Emploi ni Accueil d'établissement : son écran de
  // travail est « Édition », le premier des deux qui lui restent ouverts.
  if (role === ROLES.GESTIONNAIRE) return <Navigate to="/app/edition" replace />;
  // L'administrateur en collaboration : la première page collaborative (2026-09-14).
  if (role === ROLES.ADMIN) return <Navigate to="/app/emploi" replace />;

  return <AccueilApp />;
}
