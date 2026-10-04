import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motDePasseValide } from 'shared/schemas';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ReglesMotDePasse from '@/components/common/ReglesMotDePasse';
import { reinitialiserMotDePasseCompte } from '../api';

/**
 * « Réinitialiser le mot de passe » d'un compte, tous rôles confondus.
 *
 * ⚠️ LE MOT DE PASSE SE TAPE ICI (2026-09-27, demande du porteur) : cette
 * boîte remplace l'ancien clic unique qui tirait un mot de passe provisoire au
 * hasard. Même geste que sur « Sessions ». Partagée par le tableau des
 * directeurs et celui d'activité — une même action, un seul dessin.
 *
 * `onReussite(reponse)` reçoit la réponse du serveur, qui ne porte le mot de
 * passe que pour les adresses fictives « @placeholder.ofppt.ma ».
 */
export default function DialogueMotDePasse({ compte, onFermer, onReussite }) {
  const [motDePasse, setMotDePasse] = useState('');

  const mutation = useMutation({
    mutationFn: () => reinitialiserMotDePasseCompte(compte.id, motDePasse),
    onSuccess: (reponse) => {
      setMotDePasse('');
      onReussite?.(reponse);
      onFermer();
    },
  });

  const fermer = () => {
    setMotDePasse('');
    mutation.reset();
    onFermer();
  };

  return (
    <Dialog open={Boolean(compte)} onOpenChange={(ouvert) => !ouvert && fermer()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Réinitialiser le mot de passe</DialogTitle>
          <DialogDescription>
            {compte?.nomComplet} ({compte?.email})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="admin-nouveau-mot-de-passe">Nouveau mot de passe</Label>
          <Input
            id="admin-nouveau-mot-de-passe"
            type="text"
            value={motDePasse}
            onChange={(evenement) => setMotDePasse(evenement.target.value)}
            placeholder="8 caractères minimum"
            autoComplete="off"
            autoFocus
          />
          <ReglesMotDePasse valeur={motDePasse} />
          {mutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {mutation.error.message}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={fermer}>
            Annuler
          </Button>
          <Button
            disabled={mutation.isPending || !motDePasseValide(motDePasse)}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Réinitialisation…' : 'Réinitialiser'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
