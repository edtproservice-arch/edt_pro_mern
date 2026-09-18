import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { modificationProfilSchema } from 'shared/schemas';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { modifierProfil } from '@/features/auth/api';

export default function DialogueEditerProfil({ utilisateur, libelle = 'Modifier le profil' }) {
  const [ouvert, setOuvert] = useState(false);
  const [valeurs, setValeurs] = useState({
    nomComplet: utilisateur?.nomComplet ?? '',
    email: utilisateur?.email ?? '',
  });
  const [erreurs, setErreurs] = useState({});
  const queryClient = useQueryClient();

  const ouvrirDialog = (etat) => {
    if (etat) {
      setValeurs({
        nomComplet: utilisateur?.nomComplet ?? '',
        email: utilisateur?.email ?? '',
      });
      setErreurs({});
      setOuvert(true);
    } else {
      setOuvert(false);
    }
  };

  const mutation = useMutation({
    mutationFn: () => modifierProfil(valeurs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session'] });
      setOuvert(false);
      toast.success('Profil mis à jour');
    },
    onError: (erreur) => toast.error('Modification impossible', { description: erreur.message }),
  });

  const soumettre = (evenement) => {
    evenement.preventDefault();

    const controle = modificationProfilSchema.safeParse(valeurs);
    if (!controle.success) {
      setErreurs(
        Object.fromEntries(
          controle.error.issues.map((probleme) => [probleme.path[0], probleme.message])
        )
      );
      return;
    }

    setErreurs({});
    mutation.mutate();
  };

  return (
    <Dialog open={ouvert} onOpenChange={ouvrirDialog}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {libelle}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Modifier mon profil</DialogTitle>
          <DialogDescription>
            Mettez à jour votre nom complet et votre adresse e-mail de connexion.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={soumettre} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="nomComplet">Nom complet</Label>
            <Input
              id="nomComplet"
              value={valeurs.nomComplet}
              onChange={(e) =>
                setValeurs((precedentes) => ({ ...precedentes, nomComplet: e.target.value }))
              }
              aria-invalid={Boolean(erreurs.nomComplet)}
            />
            {erreurs.nomComplet && (
              <p className="text-xs text-destructive">{erreurs.nomComplet}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Adresse e-mail</Label>
            <Input
              id="email"
              type="email"
              value={valeurs.email}
              onChange={(e) =>
                setValeurs((precedentes) => ({ ...precedentes, email: e.target.value }))
              }
              aria-invalid={Boolean(erreurs.email)}
            />
            {erreurs.email && <p className="text-xs text-destructive">{erreurs.email}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOuvert(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
