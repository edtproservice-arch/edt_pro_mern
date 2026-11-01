import { useMutation } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { seDeconnecter } from '@/features/auth/api';

/**
 * ═══ « VOUS ÊTES DANS LA DÉMO » (2026-11-01) ═══
 * Bandeau permanent d'une session ouverte par « Essayer comme… » sur la page d'accueil
 * (`backend/src/modules/demo`) : données fictives, copie effacée après 24 h. Deux sorties :
 * inscrire son établissement, ou quitter la démo (retour à la page d'accueil).
 *
 * ⚠️ VISIBLE ET NON MASQUABLE, comme le bandeau de session déléguée : on doit savoir qu'on
 *    manipule des données fictives — et qu'elles disparaîtront.
 * ⚠️ SAUF DANS LA FENÊTRE DE LA PAGE D'ACCUEIL (iframe, demande du porteur : « gagner l'espace ») :
 *    la page autour dit déjà que c'est une démo. En plein écran, il revient.
 */
const dansLaFenetreDAccueil = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true; // un parent d'une autre origine : on est bien dans un cadre
  }
};

export default function BandeauDemo({ utilisateur }) {
  // On quitte la session de démo, puis on va où le visiteur l'a demandé.
  const quitter = useMutation({
    mutationFn: () => seDeconnecter().catch(() => {}),
    // `top` : dans la fenêtre de la page d'accueil (iframe), on quitte la page entière, pas le cadre.
    onSettled: (_resultat, _erreur, destination) => window.top.location.assign(destination),
  });

  if (!utilisateur?.demo || dansLaFenetreDAccueil()) return null;

  return (
    <div className="sticky top-0 z-50 shrink-0 border-b border-[#0071DB]/30 bg-[#0071DB]/10 print:hidden">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6 lg:px-8">
        <p className="flex items-center gap-2 text-sm">
          <FlaskConical className="h-4 w-4 shrink-0 text-[#0071DB]" />
          <span>
            <strong>Démo</strong> — établissement fictif : tout fonctionne, rien n’en sort, et cette copie est
            effacée dans les 24 heures.
          </span>
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => quitter.mutate('/')} disabled={quitter.isPending}>
            Quitter la démo
          </Button>
          <Button size="sm" onClick={() => quitter.mutate('/inscription')} disabled={quitter.isPending}>
            Inscrire mon établissement
          </Button>
        </div>
      </div>
    </div>
  );
}
