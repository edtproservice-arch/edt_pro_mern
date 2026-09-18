import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { revenirAdmin } from '@/features/auth/api';

/**
 * Bandeau permanent d'une session déléguée.
 *
 * ⚠️ Non masquable, et volontairement voyant. Agir sans savoir qu'on agit à la
 * place de quelqu'un d'autre est la façon la plus simple de modifier par erreur
 * les données d'un établissement réel — pendant une session de support, les
 * écrans sont identiques à ceux du directeur.
 */
export default function BandeauUsurpation({ impersonateur, utilisateur }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const retour = useMutation({
    mutationFn: revenirAdmin,
    onSuccess: () => {
      queryClient.clear(); // les données de la cible ne doivent pas rester en cache
      navigate('/admin');
    },
  });

  if (!impersonateur) return null;

  return (
    /*
     * ⚠️ `shrink-0` : il est le premier enfant d'une colonne flex bornée à la
     * hauteur de l'écran (`SidebarInset h-svh`). Sans lui, il serait le premier
     * à être comprimé quand la place manque — et un avertissement écrasé à
     * quelques pixels ne prévient plus personne.
     */
    <div className="sticky top-0 z-50 shrink-0 border-b border-accent-orange/40 bg-accent-orange/10">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6 lg:px-8">
        <p className="flex items-center gap-2 text-sm">
          <UserCog className="h-4 w-4 shrink-0 text-accent-orange" />
          <span>
            Session déléguée — vous agissez au nom de{' '}
            <strong>{utilisateur?.nomComplet}</strong>, connecté en tant que{' '}
            {impersonateur.nomComplet}.
          </span>
        </p>

        <Button
          size="sm"
          variant="outline"
          onClick={() => retour.mutate()}
          disabled={retour.isPending}
        >
          {retour.isPending ? 'Retour…' : 'Revenir à mon compte'}
        </Button>
      </div>
    </div>
  );
}
