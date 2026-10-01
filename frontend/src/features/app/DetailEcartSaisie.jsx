import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { chargerDetailEcartSaisie, envoyerEcartSaisie } from '@/features/avancement/api';
import { nombre } from '@/lib/nombres';
import CarteModuleEcart, { dateCourte } from './CarteModuleEcart';

/**
 * ═══ LE DÉTAIL D'UNE CARTE « ÉCART DE SAISIE » ═══ (2026-10-01, demande du
 * porteur : « lorsque je clique sur la card, afficher le détail des séances
 * non saisies »).
 *
 * ⚠️ E-NOTE NE DIT PAS QUELLE SÉANCE A ÉTÉ SAISIE, seulement des heures par
 * groupe et module : le panneau montre donc, couple par couple, l'écart et les
 * séances de la grille qui le composent. Les couples en manque viennent en
 * tête ; ceux qui sont à jour sont repliés en bas.
 */
export default function DetailEcartSaisie({ carte, onFermer }) {
  const requete = useQuery({
    queryKey: ['avancement', 'ecarts-saisie', 'detail', carte?.cle, carte?.semaine],
    queryFn: () => chargerDetailEcartSaisie(carte.cle, carte.semaine),
    enabled: Boolean(carte),
    retry: false,
  });

  /* ═══ ENVOYER L'ÉTAT D'ÉCART AU FORMATEUR (2026-10-01, demande du porteur :
     « un bouton envoyer par messagerie EDT Pro l'état d'écart au formateur
     concerné »). */
  const envoi = useMutation({
    mutationFn: () => envoyerEcartSaisie(carte.cle, carte.semaine),
    onSuccess: (resultat) =>
      toast.success('Message envoyé', {
        description: `${resultat.nom} a reçu l’état de son écart de saisie en S${carte.semaine}.`,
      }),
    onError: (erreur) => toast.error('Envoi impossible', { description: erreur.message }),
  });
  /* Une autre carte ouverte repart d'un bouton neuf. */
  const { reset } = envoi;
  useEffect(() => reset(), [carte?.cle, carte?.semaine, reset]);

  const lignes = requete.data?.lignes ?? [];
  const enManque = lignes.filter((ligne) => ligne.ecart < 0);
  const aJour = lignes.filter((ligne) => ligne.ecart >= 0);

  return (
    <Sheet open={Boolean(carte)} onOpenChange={(ouvert) => !ouvert && onFermer()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b p-4">
          <SheetTitle className="flex items-center gap-2">
            {carte?.nom}
            {carte && (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-destructive">
                {nombre(carte.ecart)} h
              </span>
            )}
          </SheetTitle>
          <SheetDescription>
            S{carte?.semaine}
            {requete.data &&
              ` · séances du ${requete.data.debut ? dateCourte(requete.data.debut) : 'début d’année'} au ${dateCourte(requete.data.fin)}`}
            {carte && ` · E-note ${nombre(carte.enote)} h · EDT ${nombre(carte.edt)} h`}
          </SheetDescription>
          {/* ⚠️ LE MESSAGE EST COMPOSÉ PAR LE SERVEUR, depuis le même calcul que ce
              panneau : le formateur lit ce que le directeur voit ici. */}
          <Button
            type="button"
            size="sm"
            className="mt-2 w-fit gap-1.5"
            disabled={!carte || envoi.isPending || enManque.length === 0}
            onClick={() => envoi.mutate()}
          >
            {envoi.isSuccess ? <Check className="size-3.5" /> : <Send className="size-3.5" />}
            {envoi.isPending
              ? 'Envoi…'
              : envoi.isSuccess
                ? 'Envoyé — renvoyer'
                : 'Envoyer au formateur par messagerie'}
          </Button>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {requete.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Chargement…</p>
          ) : requete.isError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Le détail n’a pas pu être chargé.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                E-note ne dit pas quelle séance a été saisie, seulement des heures par groupe et
                module : pour chaque module en manque, voici les séances de la grille à vérifier.
              </p>

              {enManque.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Aucun module en manque de saisie.
                </p>
              ) : (
                enManque.map((ligne) => <CarteModuleEcart key={`${ligne.groupe}||${ligne.module}`} ligne={ligne} />)
              )}

              {aJour.length > 0 && (
                <details className="rounded-lg border">
                  <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
                    {aJour.length} module(s) à jour ou saisis en plus
                  </summary>
                  <div className="space-y-2 border-t p-2">
                    {aJour.map((ligne) => (
                      <CarteModuleEcart key={`${ligne.groupe}||${ligne.module}`} ligne={ligne} />
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

