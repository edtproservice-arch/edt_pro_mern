import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { quitterCollaboration } from '@/features/auth/api';

/**
 * Bandeau permanent de l'administrateur qui COLLABORE avec un établissement
 * (2026-09-14).
 *
 * ⚠️ POUR LA MÊME RAISON QUE LE BANDEAU D'USURPATION : les écrans sont ceux de
 * l'établissement, et écrire dans l'emploi du temps de quelqu'un d'autre sans
 * le voir écrit en permanence est la façon la plus simple de le faire par
 * erreur. Il dit aussi comment en sortir — sans lui, l'administration serait
 * hors d'atteinte.
 *
 * ⚠️ BLEU, PAS ORANGE : l'orange dit « vous agissez à la place de quelqu'un ».
 * Ici l'admin agit en son nom — la situation est différente, elle se lit
 * différemment.
 */
export default function BandeauCollaboration({ collaboration }) {
  const navigate = useNavigate();
  const cache = useQueryClient();

  const quitter = useMutation({
    mutationFn: quitterCollaboration,
    onSuccess: () => {
      cache.clear(); // les données de l'établissement ne restent pas en cache
      navigate('/admin');
    },
  });

  if (!collaboration) return null;

  return (
    // `shrink-0` : premier enfant d'une colonne bornée à l'écran, il ne doit pas être comprimé.
    <div className="sticky top-0 z-50 shrink-0 border-b border-primary/20 bg-primary/5">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6 lg:px-8">
        <p className="flex items-center gap-2 text-sm">
          <Users className="h-4 w-4 shrink-0 text-primary" />
          <span>
            Collaboration — vous travaillez avec <strong>{collaboration.nom}</strong> en tant
            qu’administrateur. Publier, importer et partager restent au directeur.
          </span>
        </p>
        <Button size="sm" variant="outline" onClick={() => quitter.mutate()} disabled={quitter.isPending}>
          {quitter.isPending ? 'Retour…' : 'Quitter la collaboration'}
        </Button>
      </div>
    </div>
  );
}
