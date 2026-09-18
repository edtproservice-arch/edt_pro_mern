import { useQuery } from '@tanstack/react-query';
import { History, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { chargerChronologie } from './api';

/**
 * La CHRONOLOGIE — rembobiner l'écran à une date passée.
 * ← le `#timeline-scrubber` d'avancement.html, une barre fixée en bas de page
 *
 * ═══ ⚠️ ELLE EST PLUS JUSTE QUE DANS L'EXISTANT ═══
 * Le PHP ne rembobinait que d'un INSTANTANÉ à l'autre — les dates d'import
 * e-note et de SAUVEGARDE des grilles — parce que le blob hebdomadaire ne datait
 * pas ses séances : l'état retrouvé dépendait de quand quelqu'un avait cliqué
 * « enregistrer ». `Seance.date` porte le jour réel de la séance, et l'état à
 * n'importe quelle date se recalcule exactement.
 *
 * ═══ ⚠️ LES DEUX FACES N'ONT PAS LA MÊME FRISE ═══
 * E-note avance par IMPORTS : entre deux fichiers, rien ne change, et les points
 * sont ceux des dépôts. La grille avance par SEMAINES : chaque semaine saisie
 * déplace le réalisé. Une frise commune proposerait des dates où l'une des deux
 * faces ne bouge jamais.
 */
export default function SheetChronologie({ face, date, onChanger, ouvert, onOuvrir }) {
  const points = useQuery({
    queryKey: ['avancement', 'chronologie'],
    queryFn: chargerChronologie,
    retry: false,
  });

  const frise = points.data?.[face] ?? [];
  const choisi = frise.find((point) => point.date === date) ?? null;

  return (
    /*
     * ═══ ⚠️⚠️ PANNEAU NON MODAL — LE FOND RESTE VIVANT ═══ (demande du porteur,
     * 2026-08-31 : « le background n'être pas bloqué pour que je puisse voir les
     * modifications sur le graphe instantanément ».)
     *
     * C'est la logique de l'ancien `#timeline-scrubber`, une barre FIXÉE en bas
     * de page et jamais une boîte de dialogue. Un panneau modal ferait exactement
     * l'inverse de ce qu'on lui demande : on choisit une semaine pour VOIR le
     * graphe bouger, et le voile de Radix l'assombrit tout en interceptant les
     * clics. Il faut les DEUX réglages — `modal={false}` retire le piège de
     * focus et le verrou de défilement, `overlay={false}` retire le voile.
     */
    <Sheet modal={false} open={ouvert} onOpenChange={onOuvrir}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <History className="size-3.5" />
          Chronologie
          {/* ⚠️ LE BOUTON PORTE LA DATE OBSERVÉE : replié, le panneau ne dirait
              plus qu'on regarde le passé, et on lirait un écran rembobiné en le
              croyant courant. */}
          {date && (
            <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[0.6rem] tabular-nums">
              {choisi?.libelle ?? date}
            </Badge>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent
        side="bottom"
        overlay={false}
        /*
         * ⚠️ IL NE SE REFERME PAS AU CLIC EXTÉRIEUR. Non modal, Radix traite le
         * moindre clic hors du panneau comme un congé — or le geste attendu ici
         * est justement d'aller lire le graphe, de survoler une barre, de
         * comparer, puis de revenir choisir une autre semaine. Il se ferme par
         * la croix ou par Échap, comme la barre de l'existant se repliait.
         */
        onInteractOutside={(evenement) => evenement.preventDefault()}
        /*
         * ⚠️ PLUS BAS QUE 45 vh : sans voile, c'est la hauteur qui décide de ce
         * qu'on voit encore du graphe.
         *
         * ⚠️ ET AUCUNE CLASSE D'OMBRE ICI : `sheetVariants` pose déjà
         * `shadow-lg`, et c'est lui qui détache le panneau de la page en
         * l'absence de voile (mesuré : `0 10px 15px -3px rgba(0,0,0,.1)`).
         * `shadow-notion-2`, que j'avais d'abord écrit, N'EXISTE PAS dans
         * `tailwind.config.js` — les ombres Notion y sont mappées sur
         * `shadow-sm` / `shadow-lg`. Même piège que `--warning` et
         * `accent-pink-deep` : une classe inconnue ne rend rien, en silence.
         */
        className="max-h-[40vh]"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            Chronologie
            {/* ← le badge « ● Données actuelles » de l'existant. */}
            <span
              className={cn(
                'text-xs font-normal',
                date ? 'text-accent-orange' : 'text-success'
              )}
            >
              ● {date ? `État au ${choisi?.libelle ?? date}` : 'Données actuelles'}
            </span>
          </SheetTitle>
          <SheetDescription>
            {/*
              ⚠️ LES DEUX FACES PARLENT LA MÊME LANGUE — la semaine — depuis que
              l'e-note n'admet qu'une base par semaine (règle du 2026-09-01).
              Une frise en dates de dépôt d'un côté et en semaines de l'autre
              obligeait à traduire mentalement pour comparer les deux.
            */}
            {face === 'enote'
              ? 'Un point par semaine : une seule base e-note est admise par semaine, et l’état est celui de la fin de cette semaine.'
              : 'Chaque point est une semaine saisie dans la grille — l’état est celui de la fin de cette semaine.'}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4">
          {points.isLoading && (
            <p className="py-6 text-center text-xs text-muted-foreground">Chargement de la frise…</p>
          )}

          {!points.isLoading && frise.length === 0 && (
            /*
              ⚠️ LE CAS VIDE ENVOIE AU BON ENDROIT : une frise sans point ne veut
              pas dire « panne » mais « rien n'a encore été saisi de ce côté ».
            */
            <p className="py-6 text-center text-xs text-muted-foreground">
              {face === 'enote'
                ? 'Aucun fichier e-note importé pour cette année — il n’y a pas d’historique à parcourir.'
                : 'Aucune semaine saisie dans la grille pour l’instant.'}
            </p>
          )}

          {frise.length > 0 && (
            /*
              ⚠️ LA FRISE DÉFILE, la page non : une année peut porter trente-neuf
              points, et les serrer sur la largeur de l'écran les rendrait
              impossibles à viser.
            */
            <div className="overflow-x-auto pb-2">
              <div className="relative flex min-w-max items-start gap-1 px-2 pt-4">
                {/* Le trait, derrière les points. */}
                <span className="absolute inset-x-2 top-[1.4rem] h-px bg-border" aria-hidden="true" />

                {frise.map((point) => {
                  const actif = point.date === date;

                  return (
                    <button
                      key={point.date}
                      type="button"
                      onClick={() => onChanger(actif ? null : point.date)}
                      title={point.detail}
                      className="relative flex w-16 shrink-0 flex-col items-center gap-1 text-[0.65rem]"
                    >
                      <span
                        className={cn(
                          'size-3 rounded-full border-2 border-background transition-colors',
                          actif ? 'bg-accent-orange ring-2 ring-accent-orange/40' : 'bg-muted-foreground/40'
                        )}
                      />
                      <span
                        className={cn(
                          'tabular-nums',
                          actif ? 'font-medium text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {point.libelle}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/*
          ⚠️ LE RETOUR AU PRÉSENT EST EXPLICITE, et n'apparaît QUE si l'on s'en est
          écarté : sans lui, rien ne ramènerait à l'état courant sans viser le
          dernier point — et on repartirait en croyant lire le présent.
        */}
        {date && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2 h-8 gap-1.5 text-xs"
            onClick={() => onChanger(null)}
          >
            <RotateCcw className="size-3.5" />
            Revenir aux données actuelles
          </Button>
        )}
      </SheetContent>
    </Sheet>
  );
}
