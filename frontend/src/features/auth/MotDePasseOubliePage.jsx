import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { demandeResetSchema } from 'shared/schemas';

import AuthLayout from './components/AuthLayout';
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
import { demanderReinitialisation } from './api';

/** ← public/forgot_password.html */
export default function MotDePasseOubliePage() {
  const navigate = useNavigate();
  const [erreurServeur, setErreurServeur] = useState(null);

  const form = useForm({
    resolver: zodResolver(demandeResetSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(valeurs) {
    setErreurServeur(null);
    try {
      await demanderReinitialisation(valeurs.email);
      // On envoie vers la saisie du code sans confirmer que le compte existe :
      // la réponse du serveur est volontairement identique dans les deux cas.
      navigate(`/reinitialisation?email=${encodeURIComponent(valeurs.email)}`);
    } catch (error) {
      setErreurServeur(error.message);
    }
  }

  return (
    <AuthLayout
      titre="Mot de passe oublié"
      sousTitre="Saisissez votre adresse : si un compte y est associé, un code de vérification vous sera envoyé."
      pied={
        <Link to="/connexion" className="font-medium text-primary hover:underline">
          Retour à la connexion
        </Link>
      }
    >
      {erreurServeur && (
        <Alerte type="erreur" titre="Demande impossible" className="mb-4">
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
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="vous@exemple.ma"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Envoi…' : 'Envoyer le code'}
          </Button>
        </form>
      </Form>
    </AuthLayout>
  );
}
