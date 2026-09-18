import { useCallback, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { renvoyerCode } from '../api';

/** Durée de vie d'un code, alignée sur DUREE_CODE_MS du service (15 minutes). */
const VALIDITE_MS = 15 * 60 * 1000;

/** Délai avant de pouvoir redemander un code. Le serveur limite en plus à 5/15 min. */
const ATTENTE_MS = 60 * 1000;

/**
 * Compte à rebours de validité + bouton de renvoi.
 *
 * Les échéances sont stockées en HORODATAGES, pas en compteurs décrémentés :
 * les navigateurs ralentissent `setInterval` dans un onglet en arrière-plan, et
 * un compteur dériverait — l'utilisateur verrait « 8 minutes restantes » sur un
 * code déjà expiré.
 */
export default function RenvoiCode({ email, type = 'email', onRenvoi }) {
  const [expireA, setExpireA] = useState(() => Date.now() + VALIDITE_MS);
  const [reactivableA, setReactivableA] = useState(() => Date.now() + ATTENTE_MS);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const [confirmation, setConfirmation] = useState(null);

  useEffect(() => {
    const minuteur = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(minuteur);
  }, []);

  const mutation = useMutation({
    mutationFn: () => renvoyerCode({ email, type }),
    onSuccess: () => {
      const desormais = Date.now();
      setExpireA(desormais + VALIDITE_MS);
      setReactivableA(desormais + ATTENTE_MS);
      setConfirmation("Un nouveau code vient d'être envoyé. Le précédent ne fonctionne plus.");
      onRenvoi?.();
    },
  });

  const resteValidite = Math.max(0, expireA - maintenant);
  const resteAttente = Math.max(0, reactivableA - maintenant);
  const expire = resteValidite === 0;

  const formater = useCallback((ms) => {
    const total = Math.ceil(ms / 1000);
    const minutes = Math.floor(total / 60);
    const secondes = total % 60;
    return `${minutes}:${String(secondes).padStart(2, '0')}`;
  }, []);

  return (
    <div className="space-y-2 text-center">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {expire ? (
          <span className="text-destructive">
            Ce code a expiré. Demandez-en un nouveau pour continuer.
          </span>
        ) : (
          <>
            Code valable encore{' '}
            <span className="font-medium tabular-nums text-foreground">
              {formater(resteValidite)}
            </span>
          </>
        )}
      </p>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || resteAttente > 0}
      >
        <RotateCw className={mutation.isPending ? 'animate-spin' : undefined} />
        {mutation.isPending
          ? 'Envoi…'
          : resteAttente > 0
            ? `Renvoyer dans ${Math.ceil(resteAttente / 1000)} s`
            : 'Renvoyer le code'}
      </Button>

      {mutation.isError && (
        <p className="text-sm text-destructive" role="alert">
          {mutation.error.message}
        </p>
      )}

      {confirmation && !mutation.isError && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {confirmation}
        </p>
      )}
    </div>
  );
}
