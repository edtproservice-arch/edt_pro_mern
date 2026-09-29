import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, MapPin } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Alerte from '@/components/common/Alerte';
import { recupererSession, seDeconnecter } from './api';
import { chargerMesEtablissements } from '@/features/configuration/api';
import { definirEtablissementActif } from '@/lib/etablissementActif';
import { routeApresConnexion } from './routage';

/**
 * « À quel établissement se connecter ? » — pour un compte mutualisé sur
 * plusieurs établissements (2026-09-24, demande du porteur : « pour les
 * formateurs mutualisés, affectés dans deux établissements, il faut choisir
 * après connexion, avec une option de switcher sans se déconnecter »).
 *
 * ═══ ⚠️ ELLE SERT AUSSI DE SWITCHER, PAS SEULEMENT AU PREMIER CHOIX ═══
 * « Changer d'établissement » (menu du compte) rouvre CETTE MÊME page plutôt
 * qu'un second écran : le geste — choisir dans la liste, entrer dans
 * l'application avec ce choix — est identique, que ce soit le premier ou le
 * dixième. Deux écrans pour la même question auraient fini par diverger.
 *
 * ⚠️ HORS DE `CoquilleApp` (comme `/essai` et `/configuration`) : elle est
 * atteinte AVANT que l'établissement ne soit résolu, donc avant que la barre
 * latérale ou la barre horizontale — qui en dépendent — ne puissent se monter.
 *
 * ⚠️ NE CHOISIT RIEN À LA PLACE DE LA PERSONNE, même pour un seul établissement
 * restant : `CoquilleApp` ne renvoie ici QUE s'il y a un choix réel à faire
 * (`etablissementIds.length > 1`) — cette page peut donc toujours partir du
 * principe qu'il y en a au moins deux à afficher, une fois la liste chargée.
 */
export default function PageChoisirEtablissement() {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [enCours, setEnCours] = useState(null);

  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  const utilisateur = session.data?.utilisateur;

  const liste = useQuery({
    queryKey: ['etablissements', 'mes'],
    queryFn: chargerMesEtablissements,
    enabled: Boolean(utilisateur),
    retry: false,
  });

  if (session.isLoading) return null;
  if (!utilisateur) return <Navigate to="/connexion" replace />;

  const etablissements = liste.data?.etablissements ?? [];

  // Filet de sécurité : un seul établissement (ou la liste pas encore chargée)
  // n'a rien à faire choisir — direction la destination normale.
  if (!liste.isLoading && !liste.isError && etablissements.length < 2) {
    return <Navigate to={routeApresConnexion(utilisateur)} replace />;
  }

  function choisir(id) {
    setEnCours(id);
    definirEtablissementActif(id);
    /*
     * ⚠️ TOUT DÉPEND DE L'ÉTABLISSEMENT ACTIF : formateurs, groupes, emploi du
     * temps, absences — rien de ce qui est en cache pour l'ancien ne reste
     * valable pour le nouveau. Même règle que le changement d'année scolaire.
     */
    cache.clear();
    navigate(routeApresConnexion(utilisateur), { replace: true });
  }

  async function deconnexion() {
    await seDeconnecter();
    navigate('/connexion');
  }

  return (
    /*
     * ⚠️ `min-h-dvh`, PAS `min-h-screen` (2026-09-24, demande du porteur : « rendre
     * responsive ») : sur mobile, `100vh` compte la hauteur de la barre d'adresse
     * du navigateur même quand elle est repliée — la page dépassait alors l'écran
     * réellement visible, d'où l'espace vide constaté en haut. `100dvh` mesure la
     * hauteur RÉELLEMENT disponible.
     *
     * ⚠️ `overflow-x-hidden` : garde-fou — voir la note sur `min-w-0` plus bas.
     */
    <main className="flex min-h-dvh items-center justify-center overflow-x-hidden bg-background px-4 py-8 sm:py-12">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold sm:text-2xl">Choisissez un établissement</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bonjour {utilisateur.nomComplet}, votre compte est rattaché à plusieurs établissements.
          </p>
        </div>

        {liste.isError && (
          <Alerte type="erreur" titre="Liste indisponible">
            {liste.error.message}
          </Alerte>
        )}

        {liste.isLoading ? (
          <p className="text-center text-sm text-muted-foreground">Chargement…</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {etablissements.map((etablissement) => (
              <Card
                key={etablissement.id}
                role="button"
                tabIndex={0}
                aria-disabled={enCours !== null}
                onClick={() => enCours === null && choisir(etablissement.id)}
                onKeyDown={(evenement) => {
                  if (enCours !== null) return;
                  if (evenement.key === 'Enter' || evenement.key === ' ') {
                    evenement.preventDefault();
                    choisir(etablissement.id);
                  }
                }}
                /*
                 * ⚠️ `min-w-0` ICI, PAS SEULEMENT SUR SES ENFANTS : `Card` est une
                 * cellule de grille, dont la largeur MINIMALE par défaut respecte le
                 * contenu le plus long sans point de coupure (le nom officiel de
                 * l'établissement) — elle pousse alors la grille, et la page entière,
                 * plus large que l'écran. `min-w-0` autorise la cellule à rétrécir
                 * jusqu'à la largeur disponible, ce qui laisse enfin le `truncate` des
                 * enfants faire son travail.
                 */
                className="min-w-0 cursor-pointer transition-colors hover:border-primary hover:bg-accent/50"
              >
                <CardHeader className="flex-row items-start gap-3 space-y-0 p-4 sm:p-6">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground">
                    <Building2 className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="truncate text-base">
                      {etablissement.nomAbrege || etablissement.nom}
                    </CardTitle>
                    {etablissement.nomAbrege && etablissement.nom !== etablissement.nomAbrege && (
                      <CardDescription className="truncate">{etablissement.nom}</CardDescription>
                    )}
                  </div>
                </CardHeader>
                {(etablissement.complexe || etablissement.region) && (
                  <CardContent className="px-4 pb-4 pt-0 sm:px-6 sm:pb-6">
                    <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {[etablissement.complexe, etablissement.region].filter(Boolean).join(' · ')}
                      </span>
                    </p>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}

        <div className="text-center">
          <Button variant="ghost" size="sm" onClick={deconnexion}>
            Se déconnecter
          </Button>
        </div>
      </div>
    </main>
  );
}
