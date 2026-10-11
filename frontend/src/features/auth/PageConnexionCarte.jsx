import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Alerte from '@/components/common/Alerte';
import { Button } from '@/components/ui/button';
import AuthLayout from './components/AuthLayout';
import { seConnecterParCarte } from './api';
import { routeApresConnexion } from './routage';

/**
 * ═══ CONNEXION PAR LA CARTE DE STAGIAIRE (2026-10-11) ═══ La page qu'ouvre le
 * QR de la carte : `/carte/<jeton>`. Elle envoie le jeton au serveur, qui ouvre
 * la session du stagiaire, puis mène à son accueil — sans identifiant ni mot de
 * passe. Voir `backend/src/modules/auth/jetonCarte.js`.
 *
 * ⚠️ UNE SEULE TENTATIVE PAR AFFICHAGE (`dejaEnvoye`) : en développement, React
 * monte deux fois les effets ; deux appels ouvriraient deux sessions.
 */
export default function PageConnexionCarte() {
  const { jeton } = useParams();
  const navigate = useNavigate();
  const [erreur, setErreur] = useState(null);
  const dejaEnvoye = useRef(false);

  useEffect(() => {
    if (dejaEnvoye.current) return;
    dejaEnvoye.current = true;
    seConnecterParCarte(jeton)
      .then((reponse) => navigate(routeApresConnexion(reponse.utilisateur), { replace: true }))
      .catch((probleme) => setErreur(probleme.message));
  }, [jeton, navigate]);

  return (
    <AuthLayout titre="Carte de stagiaire" sousTitre="Connexion par le QR code de votre carte">
      {erreur ? (
        <div className="space-y-4">
          <Alerte type="erreur" titre="Connexion impossible">
            {erreur}
          </Alerte>
          <Button asChild className="w-full">
            <Link to="/connexion">Se connecter avec un identifiant</Link>
          </Button>
        </div>
      ) : (
        <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Connexion en cours…
        </p>
      )}
    </AuthLayout>
  );
}
