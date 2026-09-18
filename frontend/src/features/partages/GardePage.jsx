import { Navigate } from 'react-router-dom';
import { droitSuffit } from 'shared/domain';
import { usePartagesAvecMoi } from './usePartagesAvecMoi';

/**
 * Garde de route par DROIT SUR UNE PAGE — le pendant écran de
 * `exigerDroitPage` (Phase 5bis, invitations).
 *
 * ⚠️ ELLE NE REMPLACE PAS LE SERVEUR, QUI REFUSE DÉJÀ : elle évite l'écran qui
 * se monte pour échouer requête après requête. La RÈGLE est la même des deux
 * côtés — `droitSuffit` du domaine.
 *
 * ⚠️ UN DROIT INSUFFISANT N'EST PAS UNE ABSENCE DE DROIT. Un invité « peut
 * consulter » qui ouvre l'écran de saisie est envoyé vers la LECTURE (`repli`)
 * plutôt qu'à l'accueil : il a bien accès à la page, sous une autre forme.
 */
export default function GardePage({ page, requis, repli = '/app', children }) {
  const { charge, droitSur } = usePartagesAvecMoi();

  if (!charge) return null;

  const droit = droitSur(page);
  if (droitSuffit(droit, requis)) return children;
  if (droit && repli) return <Navigate to={repli} replace />;
  return <Navigate to="/app" replace />;
}
