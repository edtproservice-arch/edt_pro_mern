import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Alerte from '@/components/common/Alerte';
import { demanderEssai, recupererSession, seDeconnecter } from './api';

/**
 * Compte en attente d'approbation. ← modale « trial » de login.html:168-184
 *
 * Un directeur non approuvé obtient bien une session, mais son statut reste
 * `pending` : il n'accède à rien d'autre que cet écran, d'où il peut demander
 * une période d'essai.
 */
export default function EssaiPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['session'],
    queryFn: recupererSession,
    retry: false,
  });

  const demande = useMutation({
    mutationFn: demanderEssai,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session'] }),
  });

  if (isLoading) return null;

  const utilisateur = data?.utilisateur;
  const dejaDemande = demande.isSuccess || demande.error?.code === 'ESSAI_DEJA_DEMANDE';

  async function deconnexion() {
    await seDeconnecter();
    navigate('/connexion');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Compte en attente</CardTitle>
          <CardDescription>
            Bonjour {utilisateur?.nomComplet}, votre compte n&apos;a pas encore été approuvé par un
            administrateur.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {dejaDemande ? (
            <Alerte type="succes" titre="Demande enregistrée">
              Vous recevrez un e-mail dès qu&apos;un administrateur l&apos;aura traitée.
            </Alerte>
          ) : (
            <>
              {demande.error && (
                <Alerte type="erreur" titre="Demande impossible">
                  {demande.error.message}
                </Alerte>
              )}
              <Button
                className="w-full"
                onClick={() => demande.mutate()}
                disabled={demande.isPending}
              >
                {demande.isPending ? 'Envoi…' : "Demander une période d'essai"}
              </Button>
            </>
          )}

          <p className="text-sm text-muted-foreground">
            Vous pouvez aussi nous écrire à{' '}
            <a href="mailto:edtproservice@gmail.com" className="text-primary hover:underline">
              edtproservice@gmail.com
            </a>
            .
          </p>

          <Button variant="outline" className="w-full" onClick={deconnexion}>
            Se déconnecter
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
