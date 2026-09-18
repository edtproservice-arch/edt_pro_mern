import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { changementMotDePasseSchema } from 'shared/schemas';
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
import { changerMotDePasse } from '@/features/auth/api';

const VIDE = { actuel: '', nouveau: '', confirmation: '' };

/**
 * Changement de mot de passe, dans une boîte.
 * ← le panneau « mot de passe » de profile.html
 *
 * ═══ POURQUOI UNE BOÎTE ET NON UN FORMULAIRE OUVERT ═══
 * Trois champs de mot de passe déployés en permanence occupent le tiers de
 * l'écran pour une action qu'on fait deux fois par an, et poussent les
 * appareils — qu'on vient consulter bien plus souvent — hors de vue.
 *
 * Le formulaire valide avec `changementMotDePasseSchema`, LE MÊME schéma que la
 * route Express : les deux côtés ne peuvent pas diverger (§5bis règle 1).
 */
export default function DialogueMotDePasse() {
  const [ouvert, setOuvert] = useState(false);
  const [valeurs, setValeurs] = useState(VIDE);
  const [erreurs, setErreurs] = useState({});

  const fermer = () => {
    setOuvert(false);
    // Les champs ne survivent pas à la fermeture : laisser un mot de passe
    // saisi dans un formulaire caché n'a aucune raison d'être.
    setValeurs(VIDE);
    setErreurs({});
  };

  const changement = useMutation({
    mutationFn: () => changerMotDePasse({ actuel: valeurs.actuel, nouveau: valeurs.nouveau }),
    onSuccess: (resultat) => {
      fermer();
      toast.success('Mot de passe modifié', {
        description:
          resultat.appareilsRevoques > 0
            ? `${resultat.appareilsRevoques} autre(s) appareil(s) ont été déconnectés.`
            : 'Aucun autre appareil n’était connecté.',
      });
    },
    onError: (erreur) => toast.error('Changement impossible', { description: erreur.message }),
  });

  const soumettre = (evenement) => {
    evenement.preventDefault();

    const controle = changementMotDePasseSchema.safeParse(valeurs);
    if (!controle.success) {
      // Un message PAR CHAMP : une liste globale oblige à deviner lequel des
      // trois champs, qui se ressemblent tous, est en cause.
      setErreurs(
        Object.fromEntries(
          controle.error.issues.map((probleme) => [probleme.path[0], probleme.message])
        )
      );
      return;
    }

    setErreurs({});
    changement.mutate();
  };

  const modifier = (champ) => (evenement) =>
    setValeurs((precedentes) => ({ ...precedentes, [champ]: evenement.target.value }));

  return (
    <Dialog open={ouvert} onOpenChange={(etat) => (etat ? setOuvert(true) : fermer())}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Modifier le mot de passe
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Modifier le mot de passe</DialogTitle>
          <DialogDescription>
            Vos <strong>autres</strong> appareils seront déconnectés. Celui-ci reste ouvert.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={soumettre} className="space-y-4">
          <Champ
            id="actuel"
            libelle="Mot de passe actuel"
            valeur={valeurs.actuel}
            onChange={modifier('actuel')}
            erreur={erreurs.actuel}
            autoComplete="current-password"
          />
          <Champ
            id="nouveau"
            libelle="Nouveau mot de passe"
            valeur={valeurs.nouveau}
            onChange={modifier('nouveau')}
            erreur={erreurs.nouveau}
            aide="8 caractères minimum, une majuscule, une minuscule et un chiffre."
            autoComplete="new-password"
          />
          <Champ
            id="confirmation"
            libelle="Confirmez le nouveau"
            valeur={valeurs.confirmation}
            onChange={modifier('confirmation')}
            erreur={erreurs.confirmation}
            autoComplete="new-password"
          />

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={fermer}>
              Annuler
            </Button>
            <Button type="submit" disabled={changement.isPending}>
              {changement.isPending ? 'Modification…' : 'Modifier'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Champ({ id, libelle, valeur, onChange, erreur, aide, autoComplete }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{libelle}</Label>
      <Input
        id={id}
        type="password"
        value={valeur}
        onChange={onChange}
        autoComplete={autoComplete}
        aria-invalid={Boolean(erreur)}
        aria-describedby={erreur ? `${id}-erreur` : undefined}
      />
      {erreur ? (
        <p id={`${id}-erreur`} className="text-xs text-destructive">
          {erreur}
        </p>
      ) : (
        aide && <p className="text-xs text-muted-foreground">{aide}</p>
      )}
    </div>
  );
}
