import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { connexionSchema } from 'shared/schemas';

import AuthLayout from './components/AuthLayout';
import ChampMotDePasse from './components/ChampMotDePasse';
import PanneauAide from './components/PanneauAide';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Alerte from '@/components/common/Alerte';
import { seConnecter } from './api';
import { routeApresConnexion } from './routage';

/** ← public/login.html */
export default function LoginPage() {
  const navigate = useNavigate();
  const [parametres] = useSearchParams();
  const [erreurServeur, setErreurServeur] = useState(null);

  // Retour depuis la vérification de l'adresse e-mail. Une vérification
  // d'APPAREIL, elle, ouvre directement la session et ne repasse pas par ici.
  const emailVerifie = parametres.get('verifie') === '1';
  const motDePasseChange = parametres.get('reinitialise') === '1';
  const raisonInactivite = parametres.get('raison') === 'inactivite';
  const raisonExpiration = parametres.get('raison') === 'expiration';

  const form = useForm({
    resolver: zodResolver(connexionSchema),
    defaultValues: { identifiant: parametres.get('email') ?? '', motDePasse: '' },
  });

  async function onSubmit(valeurs) {
    setErreurServeur(null);
    try {
      const reponse = await seConnecter(valeurs);

      // Appareil inconnu : un code vient d'être envoyé, aucune session ouverte.
      if (reponse.action === 'verification_appareil') {
        navigate(
          `/verification?type=appareil&email=${encodeURIComponent(reponse.email ?? valeurs.identifiant)}`
        );
        return;
      }
      navigate(routeApresConnexion(reponse.utilisateur));
    } catch (error) {
      setErreurServeur(error.message);
    }
  }

  return (
    <>
      <AuthLayout
        titre="Se connecter"
        sousTitre="Bienvenue. Saisissez vos identifiants pour accéder à votre espace."
        pied={
          <>
            <p>
              Pas encore de compte&nbsp;?{' '}
              <Link to="/inscription" className="font-medium text-primary hover:underline">
                Inscrivez-vous
              </Link>
            </p>
            <p className="mt-1">Inscription réservée aux directeurs d&apos;EFP.</p>
          </>
        }
      >
        {raisonInactivite && (
          <Alerte type="avertissement" titre="Session expirée" className="mb-4">
            Votre session a expiré après 5 minutes d&apos;inactivité. Veuillez vous reconnecter.
          </Alerte>
        )}

        {raisonExpiration && (
          <Alerte type="avertissement" titre="Session expirée" className="mb-4">
            Votre session a expiré. Veuillez vous reconnecter.
          </Alerte>
        )}

        {emailVerifie && (
          <Alerte type="succes" titre="Adresse vérifiée" className="mb-4">
            Vous pouvez maintenant vous connecter.
          </Alerte>
        )}

        {motDePasseChange && (
          <Alerte type="succes" titre="Mot de passe modifié" className="mb-4">
            Connectez-vous avec votre nouveau mot de passe.
          </Alerte>
        )}

        {erreurServeur && (
          <Alerte type="erreur" titre="Connexion impossible" className="mb-4">
            {erreurServeur}
          </Alerte>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="identifiant"
              render={({ field }) => (
                <FormItem>
                  {/* Le serveur accepte l'e-mail OU l'identifiant — matricule
                      d'un formateur, CEF d'un stagiaire (← `login.php:73`). */}
                  <FormLabel>Email ou identifiant</FormLabel>
                  <FormControl>
                    <Input autoComplete="username" placeholder="vous@exemple.ma" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="motDePasse"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mot de passe</FormLabel>
                  <FormControl>
                    <ChampMotDePasse autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                  <div className="text-right">
                    <Link
                      to="/mot-de-passe-oublie"
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      Mot de passe oublié&nbsp;?
                    </Link>
                  </div>
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Connexion…' : 'Se connecter'}
            </Button>
          </form>
        </Form>
      </AuthLayout>

      <PanneauAide />
    </>
  );
}
