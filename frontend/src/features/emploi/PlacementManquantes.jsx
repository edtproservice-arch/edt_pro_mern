import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRight, Loader2, WandSparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Alerte from '@/components/common/Alerte';
import { cn } from '@/lib/utils';
import { placerManquantes } from '@/features/chronogramme/api';
import { adresseCase } from '@/features/chronogramme/useCaseCiblee';

import { NIVEAUX_PLACEMENT, libelleNiveau, libelleRaison } from './completudeApparence';

/**
 * Placer les séances « À placer » de la fenêtre de conformité (2026-09-27,
 * demande du porteur — rien de tel dans l'ancien EDT Pro).
 *
 * Trois niveaux, dans l'ordre : un créneau libre (un créneau « à éviter » du
 * formateur en dernier recours), puis un créneau où formateur et groupe sont
 * libres mais SANS salle, sinon la séance reste à placer — et l'écran propose
 * alors de revoir le chronogramme, puisque la semaine ne peut pas l'accueillir.
 *
 * ⚠️ APERÇU D'ABORD, ÉCRITURE ENSUITE. Poser sur un créneau qu'un formateur a
 *    demandé à éviter, ou sans salle, se décide en le voyant — pas en le
 *    découvrant dans la grille.
 */
export default function PlacementManquantes({ semaine, numero, aPlacer }) {
  const cache = useQueryClient();
  const [bilan, setBilan] = useState(null);

  const simuler = useMutation({
    mutationFn: () => placerManquantes(semaine, { simulation: true }),
    onSuccess: setBilan,
    onError: (erreur) => toast.error('Placement impossible', { description: erreur.message }),
  });

  const ecrire = useMutation({
    mutationFn: () => placerManquantes(semaine, { simulation: false }),
    onSuccess: async (resultat) => {
      setBilan(resultat);
      toast.success(`${resultat.total.placees} séance(s) placée(s)`, {
        description:
          resultat.total.sansSalle > 0
            ? `${resultat.total.sansSalle} sans salle — à compléter dans la grille.`
            : undefined,
      });
      // La grille, le bilan de la semaine et le calendrier des taux changent.
      await cache.invalidateQueries();
    },
    onError: (erreur) => toast.error('Placement impossible', { description: erreur.message }),
  });

  if (aPlacer === 0 && !bilan) return null;

  const enCours = simuler.isPending || ecrire.isPending;
  const aConfirmer = bilan?.simulation && bilan.placees.length > 0;

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Placement automatique
      </p>

      {!bilan && (
        /*
          ⚠️ EMPILÉS, PAS CÔTE À CÔTE (2026-09-28, demande du porteur) : dans le
          panneau de droite, le bouton serrait le texte dans une colonne étroite
          et le coupait tous les trois mots. Le texte prend toute la largeur,
          le bouton vient dessous.
        */
        <div className="flex flex-col items-end gap-3 rounded-lg border px-3 py-2.5">
          <p className="w-full text-sm text-muted-foreground">
            Chercher une place pour les séances à placer : créneau libre d’abord, puis créneau
            « à éviter » du formateur, puis créneau sans salle. Rien de ce qui est posé ne bouge.
          </p>
          <Button size="sm" onClick={() => simuler.mutate()} disabled={enCours}>
            {simuler.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <WandSparkles className="h-4 w-4" />
            )}
            Placer automatiquement
          </Button>
        </div>
      )}

      {bilan && bilan.placees.length > 0 && (
        <div>
          <p className="mb-2 text-sm">
            {bilan.simulation ? 'Seraient placées' : 'Placées'} :{' '}
            <strong>{bilan.total.placees} séance(s)</strong>
            {bilan.total.aEviter > 0 && <> · {bilan.total.aEviter} sur un créneau à éviter</>}
            {bilan.total.sansSalle > 0 && <> · {bilan.total.sansSalle} sans salle</>}
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {bilan.placees.map((p) => (
                  <tr key={`${p.groupe}|${p.module}|${p.jour}|${p.seance}`}>
                    <td className="px-3 py-2 font-medium">{p.groupe}</td>
                    <td className="px-3 py-2 font-mono text-xs">{p.module}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {p.jour} · {p.seance}
                    </td>
                    <td className="px-3 py-2">{p.salle || '—'}</td>
                    <td className="px-3 py-2">
                      <Badge
                        variant="secondary"
                        className={cn('font-normal', NIVEAUX_PLACEMENT[p.niveau]?.classe)}
                      >
                        {libelleNiveau(p.niveau)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {aConfirmer && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setBilan(null)} disabled={enCours}>
            Annuler
          </Button>
          <Button size="sm" onClick={() => ecrire.mutate()} disabled={enCours}>
            {ecrire.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmer le placement
          </Button>
        </div>
      )}

      {bilan && bilan.nonPlacees.length > 0 && (
        /*
         * ⚠️ LA CORRECTION EST DANS LE CHRONOGRAMME, PAS DANS LA GRILLE : la
         *    semaine n'a pas la place de ce qu'il lui demande. Le dire, et y
         *    mener d'un clic, évite de chercher dans la grille un créneau qui
         *    n'existe pas.
         */
        <Alerte
          type="avertissement"
          titre={`${bilan.total.nonPlacees} séance(s) sans place possible cette semaine`}
        >
          <ul className="mt-1 space-y-2">
            {bilan.nonPlacees.map((n) => (
              <li
                key={`${n.groupe}|${n.module}|${n.type}|${n.raison}`}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="min-w-0">
                  <strong>{n.groupe}</strong> ·{' '}
                  <span className="font-mono text-xs">{n.module}</span>
                  {n.formateur && <span className="text-muted-foreground"> ({n.formateur})</span>}
                  {n.nombre > 1 && <> × {n.nombre}</>} — {n.message ?? libelleRaison(n.raison)}
                </span>
                {/*
                  ⚠️ UN LIEN PAR SÉANCE, VERS SA CASE (2026-09-27, demande du
                  porteur) : la page entière laissait chercher le groupe, le
                  module et la semaine parmi 45 colonnes. Une séance mutualisée
                  mène au chronogramme de son PREMIER groupe — il est tenu par
                  groupe, et ses jumeaux se mettent à jour avec lui.
                */}
                <Button asChild variant="outline" size="sm" className="shrink-0">
                  <Link
                    to={adresseCase({
                      groupe: n.groupes?.[0] ?? n.groupe,
                      module: n.module,
                      semaine: numero,
                    })}
                  >
                    Modifier le chronogramme
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
          <span className="mt-2 block text-muted-foreground">
            Le chronogramme prévoit plus que cette semaine ne peut accueillir : reportez ces heures
            sur une autre semaine.
          </span>
        </Alerte>
      )}

      {bilan && !bilan.simulation && bilan.nonPlacees.length === 0 && (
        <Alerte type="succes">Toutes les séances à placer ont trouvé une place.</Alerte>
      )}
      {bilan?.simulation && bilan.placees.length === 0 && bilan.nonPlacees.length === 0 && (
        <Alerte type="info">Aucune séance à placer.</Alerte>
      )}
    </div>
  );
}
