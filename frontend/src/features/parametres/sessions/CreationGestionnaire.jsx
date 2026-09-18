import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { creationCompteSchema, motDePasseValide } from 'shared/schemas';
import { ROLES } from 'shared/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Alerte from '@/components/common/Alerte';
import ReglesMotDePasse from '@/components/common/ReglesMotDePasse';
import { creerCompte } from '../comptesApi';

/**
 * Création d'un gestionnaire, un à la fois.
 * ← la branche « CAS GESTIONNAIRE » de create_user_account.php:41-57
 *
 * ═══ POURQUOI PAS DE LISTE À COCHER ICI ═══
 * Un gestionnaire ne figure dans aucune base : ni e-note, ni Konosys. Il n'y a
 * donc rien à lister, et rien à créer en masse — un établissement en compte un
 * ou deux. L'existant le faisait déjà ainsi, dans le même formulaire à champs
 * masqués ; ici c'est un écran distinct, parce que c'est une autre opération.
 */
export default function CreationGestionnaire() {
  const cache = useQueryClient();
  const [nomComplet, setNomComplet] = useState('');
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [soucis, setSoucis] = useState(null);

  const creation = useMutation({
    mutationFn: (charge) => creerCompte(charge),
    onSuccess: (resultat) => {
      cache.invalidateQueries({ queryKey: ['comptes'] });
      setNomComplet('');
      setEmail('');
      setMotDePasse('');
      setSoucis(null);
      toast.success('Compte gestionnaire créé', { description: resultat.compte?.identifiant });
    },
    onError: (erreur) => toast.error('Création impossible', { description: erreur.message }),
  });

  // Les trois champs sont requis, et le mot de passe doit satisfaire la MÊME
  // règle que le schéma — pas seulement une longueur.
  const pret =
    nomComplet.trim().length >= 3 && email.trim() !== '' && motDePasseValide(motDePasse);

  const envoyer = (evenement) => {
    evenement.preventDefault();

    /*
     * Validé avec `creationCompteSchema`, LE MÊME schéma que la route Express
     * (§5bis règle 1) : les messages vus ici sont ceux que le serveur
     * appliquerait, il ne peut pas y avoir deux règles qui divergent.
     *
     * ⚠️ L'identifiant d'un gestionnaire EST son adresse — il n'a pas de
     * matricule. C'est le choix de l'existant (`login = email`), conservé.
     */
    const resultat = creationCompteSchema.safeParse({
      nomComplet: nomComplet.trim(),
      identifiant: email.trim().toLowerCase(),
      email: email.trim().toLowerCase(),
      role: ROLES.GESTIONNAIRE,
      motDePasse,
    });

    if (!resultat.success) {
      setSoucis(resultat.error.issues.map((souci) => souci.message));
      return;
    }

    creation.mutate(resultat.data);
  };

  return (
    <form onSubmit={envoyer} className="space-y-4">
      <Alerte type="info" titre="Créez un compte gestionnaire">
        Il ne figure dans aucune base : ses informations se saisissent ici. Son adresse e-mail lui
        sert aussi d&apos;identifiant de connexion.
      </Alerte>

      {soucis && (
        <Alerte type="erreur" titre="Vérifiez la saisie">
          <ul className="space-y-0.5">
            {soucis.map((souci) => (
              <li key={souci}>{souci}</li>
            ))}
          </ul>
        </Alerte>
      )}

      <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="gestionnaire-nom">Nom complet</Label>
          <Input
            id="gestionnaire-nom"
            value={nomComplet}
            onChange={(evenement) => setNomComplet(evenement.target.value)}
            placeholder="Nom et prénom"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="gestionnaire-email">Adresse e-mail</Label>
          <Input
            id="gestionnaire-email"
            type="email"
            value={email}
            onChange={(evenement) => setEmail(evenement.target.value)}
            placeholder="prenom.nom@ofppt.ma"
            autoComplete="off"
          />
        </div>

        {/*
          Même disposition que la création en lot : le bouton partage la RANGÉE
          du mot de passe, et les textes d'aide passent dessous. C'est la fin
          d'un même geste — remplir, puis créer — et les deux onglets ne doivent
          pas se présenter différemment pour la même opération.
        */}
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="gestionnaire-mot-de-passe">Mot de passe initial</Label>

          <div className="flex flex-wrap items-center gap-3">
            <Input
              id="gestionnaire-mot-de-passe"
              type="text"
              value={motDePasse}
              onChange={(evenement) => setMotDePasse(evenement.target.value)}
              placeholder="8 caractères minimum"
              autoComplete="off"
              className="min-w-[14rem] flex-1"
            />

            <Button type="submit" disabled={creation.isPending || !pret}>
              <UserPlus className="h-4 w-4" />
              {creation.isPending ? 'Création…' : 'Créer le compte'}
            </Button>
          </div>

          <ReglesMotDePasse valeur={motDePasse} />
          <p className="text-xs text-muted-foreground">
            Il pourra le changer depuis « Mon profil ».
          </p>
        </div>
      </div>
    </form>
  );
}
