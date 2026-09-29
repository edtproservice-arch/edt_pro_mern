import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import { enregistrerNomAbrege } from '@/features/configuration/api';
import EtapeNomAbrege from '@/features/configuration/etapes/EtapeNomAbrege';

/**
 * Modifier le nom abrégé de l'établissement depuis le profil.
 * (demande du porteur, 2026-09-21 : « en profil, que le nom abrégé soit modifiable ».)
 *
 * ⚠️ C'EST LE MÊME COMPOSANT QUE L'ASSISTANT ET LA LISTE DES ÉTAPES (`EtapeNomAbrege`) : le nom
 * officiel rappelé, le champ, ses bornes (2 à 30 caractères) et ses avertissements. Une seconde
 * saisie recopiée ici finirait par accepter ce que les autres refusent.
 *
 * ⚠️ LE NOM ABRÉGÉ PARAÎT DANS LE LIBELLÉ DES ESPACES PRÊTÉS (« Salle 4 (ISTA NTIC) ») : le
 * serveur réécrit les séances des établissements qui les utilisent (voir `renommerLibelles`).
 * Ici, on n'a qu'à enregistrer — la modification est explicite, pas automatique : elle change
 * des documents imprimés, et se confirme d'un clic.
 */
const MINIMUM = 2;
const MAXIMUM = 30;

export default function DialogueNomAbrege({ nomActuel }) {
  const [ouvert, setOuvert] = useState(false);
  const [valeur, setValeur] = useState('');
  const cache = useQueryClient();

  const mutation = useMutation({
    // ⚠️ Une fonction explicite : TanStack Query passe un second argument à `mutationFn`.
    mutationFn: () => enregistrerNomAbrege(valeur.trim()),
    onSuccess: () => {
      cache.invalidateQueries({ queryKey: ['etablissement-courant'] });
      cache.invalidateQueries({ queryKey: ['configuration-progression'] });
      setOuvert(false);
      toast.success('Nom abrégé mis à jour');
    },
    onError: (erreur) => toast.error('Modification impossible', { description: erreur.message }),
  });

  const propre = valeur.trim();
  const valide = propre.length >= MINIMUM && propre.length <= MAXIMUM;
  const change = propre !== String(nomActuel ?? '').trim();

  return (
    <Dialog
      open={ouvert}
      onOpenChange={(etat) => {
        // Ouvert, le champ repart de la valeur enregistrée : `EtapeNomAbrege` la reprend au montage.
        if (etat) setValeur(nomActuel ?? '');
        setOuvert(etat);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {nomActuel ? 'Modifier le nom abrégé' : 'Ajouter un nom abrégé'}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nom abrégé</DialogTitle>
          <DialogDescription>
            Il figure sur les documents imprimés et dans le nom des espaces que vous partagez avec
            d’autres établissements.
          </DialogDescription>
        </DialogHeader>

        <EtapeNomAbrege valeur={valeur} onChange={setValeur} />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOuvert(false)}>
            Annuler
          </Button>
          <Button
            type="button"
            disabled={!valide || !change || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
