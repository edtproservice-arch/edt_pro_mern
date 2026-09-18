import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { verificationCodeSchema } from 'shared/schemas';

import AuthLayout from './components/AuthLayout';
import ChampCode from './components/ChampCode';
import RenvoiCode from './components/RenvoiCode';
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
import { verifierCode } from './api';
import { routeApresConnexion } from './routage';

/**
 * Saisie du code à 6 chiffres. ← public/verify.html
 *
 * Deux usages, distingués par `?type=` :
 *   email    → vérification de l'adresse après inscription
 *   appareil → autorisation d'une connexion depuis un appareil inconnu
 */
export default function VerificationPage() {
  const navigate = useNavigate();
  const [parametres] = useSearchParams();
  const [erreurServeur, setErreurServeur] = useState(null);

  const email = parametres.get('email') ?? '';
  const type = parametres.get('type') === 'appareil' ? 'appareil' : 'email';

  const form = useForm({
    resolver: zodResolver(verificationCodeSchema.pick({ email: true, code: true })),
    defaultValues: { email, code: '' },
  });

  async function onSubmit(valeurs) {
    setErreurServeur(null);
    try {
      const reponse = await verifierCode({ email: valeurs.email, code: valeurs.code, type });
      // Une vérification d'appareil ouvre directement la session ; une
      // vérification d'e-mail renvoie vers la connexion.
      navigate(
        reponse.action === 'connecte'
          ? routeApresConnexion(reponse.utilisateur)
          : '/connexion?verifie=1'
      );
    } catch (error) {
      setErreurServeur(error.message);
    }
  }

  return (
    <AuthLayout
      titre="Code de vérification"
      sousTitre={
        type === 'appareil'
          ? `Connexion depuis un appareil inconnu. Un code à 6 chiffres a été envoyé à ${email}.`
          : `Un code à 6 chiffres a été envoyé à ${email}. Il expire dans 15 minutes.`
      }
      pied={
        <Link to="/connexion" className="font-medium text-primary hover:underline">
          Retour à la connexion
        </Link>
      }
    >
      {erreurServeur && (
        <Alerte type="erreur" titre="Vérification impossible" className="mb-4">
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
                  {/* Soumission automatique dès le 6e chiffre : le code n'a
                      qu'un seul usage possible, un bouton en plus n'apporte rien. */}
                  <ChampCode
                    {...field}
                    onComplete={() => form.handleSubmit(onSubmit)()}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Vérification…' : 'Valider'}
          </Button>

          <RenvoiCode
            email={form.watch('email')}
            type={type}
            onRenvoi={() => form.setValue('code', '')}
          />
        </form>
      </Form>
    </AuthLayout>
  );
}
