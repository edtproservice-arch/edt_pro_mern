import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { inscriptionSchema } from 'shared/schemas';

import AuthLayout from './components/AuthLayout';
import ChampMotDePasse from './components/ChampMotDePasse';
import PanneauAide from './components/PanneauAide';
import SelecteurEtablissement from './components/SelecteurEtablissement';
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
import { sInscrire } from './api';

/** ← public/register.html */
export default function RegisterPage() {
  const navigate = useNavigate();
  const [erreurServeur, setErreurServeur] = useState(null);

  const form = useForm({
    resolver: zodResolver(inscriptionSchema),
    defaultValues: {
      nomComplet: '',
      region: '',
      complexe: '',
      nomEtablissement: '',
      email: '',
      telephone: '',
      motDePasse: '',
      confirmation: '',
    },
  });

  async function onSubmit(valeurs) {
    setErreurServeur(null);
    try {
      await sInscrire(valeurs);
      navigate(`/verification?email=${encodeURIComponent(valeurs.email)}`);
    } catch (error) {
      setErreurServeur(error.message);
    }
  }

  return (
    <>
      <AuthLayout
        largeur="max-w-xl"
        titre="Créer un compte"
        sousTitre="Inscription réservée aux directeurs d'établissement de formation professionnelle."
        pied={
          <p>
            Vous avez déjà un compte&nbsp;?{' '}
            <Link to="/connexion" className="font-medium text-primary hover:underline">
              Connectez-vous
            </Link>
          </p>
        }
      >
        {erreurServeur && (
          <Alerte type="erreur" titre="Inscription impossible" className="mb-4">
            {erreurServeur}
          </Alerte>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="nomComplet"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nom complet</FormLabel>
                  <FormControl>
                    <Input autoComplete="name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <SelecteurEtablissement control={form.control} setValue={form.setValue} />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
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

              <FormField
                control={form.control}
                name="telephone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Téléphone</FormLabel>
                    <FormControl>
                      <Input type="tel" autoComplete="tel" placeholder="0612345678" {...field} />
                    </FormControl>
                    <FormDescription>Facultatif</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="motDePasse"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mot de passe</FormLabel>
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
                    <FormLabel>Confirmer le mot de passe</FormLabel>
                    <FormControl>
                      <ChampMotDePasse autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Création du compte…' : 'Créer mon compte'}
            </Button>
          </form>
        </Form>
      </AuthLayout>

      <PanneauAide />
    </>
  );
}
