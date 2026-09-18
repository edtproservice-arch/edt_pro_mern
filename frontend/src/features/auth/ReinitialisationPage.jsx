import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { reinitialisationSchema } from 'shared/schemas';

import AuthLayout from './components/AuthLayout';
import ChampCode from './components/ChampCode';
import ChampMotDePasse from './components/ChampMotDePasse';
import RenvoiCode from './components/RenvoiCode';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Alerte from '@/components/common/Alerte';
import { reinitialiserMotDePasse } from './api';

/** ← public/reset_password.html */
export default function ReinitialisationPage() {
  const navigate = useNavigate();
  const [parametres] = useSearchParams();
  const [erreurServeur, setErreurServeur] = useState(null);

  const form = useForm({
    resolver: zodResolver(reinitialisationSchema),
    defaultValues: {
      email: parametres.get('email') ?? '',
      code: '',
      motDePasse: '',
      confirmation: '',
    },
  });

  async function onSubmit(valeurs) {
    setErreurServeur(null);
    try {
      await reinitialiserMotDePasse(valeurs);
      navigate('/connexion?reinitialise=1');
    } catch (error) {
      setErreurServeur(error.message);
    }
  }

  return (
    <AuthLayout
      titre="Nouveau mot de passe"
      sousTitre="Saisissez le code reçu par e-mail, puis choisissez un nouveau mot de passe."
      pied={
        <Link to="/connexion" className="font-medium text-primary hover:underline">
          Retour à la connexion
        </Link>
      }
    >
      {erreurServeur && (
        <Alerte type="erreur" titre="Réinitialisation impossible" className="mb-4">
          {erreurServeur}
        </Alerte>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Adresse e-mail</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Code à 6 chiffres</FormLabel>
                <FormControl>
                  <ChampCode {...field} />
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
                <FormLabel>Nouveau mot de passe</FormLabel>
                <FormControl>
                  <ChampMotDePasse autoComplete="new-password" {...field} />
                </FormControl>
                <FormDescription>
                  8 caractères, une majuscule, une minuscule, un chiffre
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="confirmation"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirmer</FormLabel>
                <FormControl>
                  <ChampMotDePasse autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Alerte type="info">
            Toutes vos sessions ouvertes seront fermées après ce changement.
          </Alerte>

          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Enregistrement…' : 'Changer mon mot de passe'}
          </Button>

          <RenvoiCode
            email={form.watch('email')}
            type="motDePasse"
            onRenvoi={() => form.setValue('code', '')}
          />
        </form>
      </Form>
    </AuthLayout>
  );
}
