import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, Send } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { chargerEcartsSaisie, envoyerEcartSaisieATous } from '@/features/avancement/api';
import { nombre } from '@/lib/nombres';
import { cn } from '@/lib/utils';
import DetailEcartSaisie from './DetailEcartSaisie';

/** Largeur d'une colonne de la frise (`w-72`), pour le défilement. */
const LARGEUR_COLONNE = 288;

/**
 * ═══ L'ÉCART DE SAISIE e-note / eDTpro ═══ (2026-10-01, demande du porteur :
 * « en accueil, un tableau qui montre l'écart entre EDT pro et e-note pour
 * chaque semaine »).
 *
 * ⚠️ EN FRISE, PLUS EN TABLEAU (2026-10-01, demande du porteur : « transformé
 * en cette forme en mettant seulement les formateurs avec écart négatif dans
 * chaque semaine, avec l'écart devant chaque nom ») — la même forme que
 * « Modules en voie d'achèvement » : une colonne par DÉPÔT e-note (un par
 * semaine, règle de l'import), une carte par formateur en MANQUE de saisie,
 * le plus gros manque en tête.
 *
 * E-note : ce que le formateur a saisi depuis le dépôt précédent ; EDT : ce que
 * la grille lui donnait sur la même période ; écart = E-note − EDT.
 */
/**
 * La requête de la frise, partagée avec la tuile de l'accueil : la même clé,
 * donc un seul chargement pour les deux.
 */
export function useEcartsSaisie() {
  return useQuery({
    queryKey: ['avancement', 'ecarts-saisie'],
    queryFn: chargerEcartsSaisie,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

/** Les formateurs en manque de saisie au DERNIER dépôt — le chiffre de la tuile. */
export function enManqueAuDernierDepot(donnees) {
  const dernier = (donnees?.periodes?.length ?? 0) - 1;
  if (dernier < 0) return null;
  return (donnees.formateurs ?? []).filter((formateur) => formateur.cellules[dernier]?.ecart < 0).length;
}

export default function EcartsSaisie() {
  const requete = useEcartsSaisie();

  const [recherche, setRecherche] = useState('');
  /* La carte cliquée — `{cle, nom, semaine, enote, edt, ecart}` — ouvre son détail. */
  const [carteOuverte, setCarteOuverte] = useState(null);
  const periodes = requete.data?.periodes ?? [];

  /* Pour chaque dépôt, les formateurs en manque — le plus gros écart d'abord. */
  const parPeriode = useMemo(() => {
    const filtre = recherche.trim().toLowerCase();
    const formateurs = (requete.data?.formateurs ?? []).filter(
      (formateur) => !filtre || formateur.nom.toLowerCase().includes(filtre)
    );
    return periodes.map((_, index) =>
      formateurs
        .map((formateur) => ({ cle: formateur.cle, nom: formateur.nom, ...formateur.cellules[index] }))
        .filter((ligne) => ligne.ecart < 0)
        .sort((a, b) => a.ecart - b.ecart || a.nom.localeCompare(b.nom, 'fr'))
    );
  }, [requete.data, periodes, recherche]);

  const derniers = enManqueAuDernierDepot(requete.data) ?? 0;
  const manqueParPeriode = useMemo(
    () =>
      periodes.map(
        (_, index) =>
          (requete.data?.formateurs ?? []).filter((formateur) => formateur.cellules[index]?.ecart < 0).length
      ),
    [requete.data, periodes]
  );

  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium">Écart de saisie e-note / eDTpro</h2>
        {!requete.isLoading && periodes.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {derniers} formateur(s) en manque de saisie au dernier dépôt
          </p>
        )}
      </div>

      {requete.isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Chargement…</p>
      ) : requete.isError ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Les écarts de saisie n’ont pas pu être chargés.
        </p>
      ) : periodes.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Aucune base e-note importée cette année : l’écart se calcule d’un dépôt à l’autre.
        </p>
      ) : (
        <Frise
          semaines={requete.data?.semaines ?? []}
          periodes={periodes}
          parPeriode={parPeriode}
          manqueParPeriode={manqueParPeriode}
          recherche={recherche}
          onRecherche={setRecherche}
          onOuvrir={setCarteOuverte}
        />
      )}

      <DetailEcartSaisie carte={carteOuverte} onFermer={() => setCarteOuverte(null)} />
    </section>
  );
}

function Frise({ semaines, periodes, parPeriode, manqueParPeriode, recherche, onRecherche, onOuvrir }) {
  const defilement = useRef(null);

  /* ⚠️ OUVERTE SUR LE DERNIER DÉPÔT, à droite : c'est la semaine qu'on vient vérifier. */
  const allerAuDernier = (comportement = 'smooth') =>
    defilement.current?.scrollTo({ left: defilement.current.scrollWidth, behavior: comportement });
  useEffect(() => {
    allerAuDernier('auto');
    // ⚠️ UNE SEULE FOIS, À L'OUVERTURE : une recherche ne doit pas ramener la vue à droite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const defiler = (sens) =>
    defilement.current?.scrollBy({ left: sens * LARGEUR_COLONNE * 3, behavior: 'smooth' });

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={recherche}
            onChange={(e) => onRecherche(e.target.value)}
            placeholder="Formateur…"
            className="h-7 w-44 pl-7 text-xs"
          />
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => allerAuDernier()}
          >
            Dernier dépôt
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="Dépôts précédents"
            onClick={() => defiler(-1)}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="Dépôts suivants"
            onClick={() => defiler(1)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>

      <div ref={defilement} className="max-h-[36rem] overflow-auto rounded-lg border bg-card">
        <div className="flex min-w-max">
          {semaines.map((semaine, index) => {
            const periode = semaine.periode === null ? null : periodes[semaine.periode];
            const formateurs = semaine.periode === null ? [] : (parPeriode[semaine.periode] ?? []);
            const dernier = index === semaines.length - 1;
            return (
              <div
                key={semaine.numero}
                className={cn(
                  'w-72 shrink-0 border-r last:border-r-0',
                  dernier ? 'bg-primary/5' : index % 2 === 1 && 'bg-muted/30'
                )}
              >
                <div
                  className={cn(
                    'sticky top-0 z-10 flex h-11 items-center justify-between gap-2 border-b bg-background/95 px-3 backdrop-blur-sm',
                    dernier && 'border-b-primary/40'
                  )}
                  title={periode ? `${periode.fichier} — déposé le ${date(periode.importeLe)}` : undefined}
                >
                  <span className="min-w-0">
                    <span
                      className={cn(
                        'flex items-center gap-1.5 text-xs font-semibold',
                        dernier && 'text-primary'
                      )}
                    >
                      {dernier && <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />}
                      S{semaine.numero}
                      {dernier && <span className="font-normal text-muted-foreground">· dernier dépôt</span>}
                    </span>
                    <span className="block truncate text-[0.65rem] text-muted-foreground">
                      {date(semaine.debut)} – {date(semaine.fin)}
                      {periode && periode.depuisSemaine < semaine.numero &&
                        ` · saisie depuis S${periode.depuisSemaine}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {formateurs.length > 0 && (
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-[0.65rem] font-semibold tabular-nums text-destructive">
                        {formateurs.length}
                      </span>
                    )}
                    {/* ⚠️ LE TOTAL NON FILTRÉ : l'envoi part à TOUS les formateurs en
                        manque de la semaine, recherche ou non. */}
                    {semaine.periode !== null && (manqueParPeriode[semaine.periode] ?? 0) > 0 && (
                      <EnvoyerATous semaine={semaine.numero} nombre={manqueParPeriode[semaine.periode]} />
                    )}
                  </span>
                </div>

                <div className="space-y-2 p-2">
                  {!periode ? (
                    <p className="px-1 py-6 text-center text-[0.7rem] text-muted-foreground">
                      Pas de base e-note déposée cette semaine
                      <span className="block">— l’écart est compté au dépôt suivant</span>
                    </p>
                  ) : formateurs.length === 0 ? (
                    <p className="px-1 py-6 text-center text-[0.7rem] text-muted-foreground">
                      Aucun manque de saisie
                    </p>
                  ) : (
                    formateurs.map((formateur) => (
                      <CarteFormateur
                        key={formateur.cle}
                        formateur={formateur}
                        onOuvrir={() => onOuvrir({ ...formateur, semaine: semaine.numero })}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        E-note : heures saisies depuis le dépôt précédent · EDT : heures des séances réalisées
        (terminées) sur la même période, absences et surveillances d’EFM exclues, rattrapages
        compris · Écart = E-note − EDT.
      </p>
    </div>
  );
}

/** Une carte : l'écart en tête, puis le nom et le détail E-note / EDT. */
function CarteFormateur({ formateur, onOuvrir }) {
  return (
    <button
      type="button"
      onClick={onOuvrir}
      className="flex w-full items-center gap-2.5 rounded-lg border bg-background px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted/40"
      title="Voir les séances à vérifier"
    >
      <span className="flex h-6 min-w-12 shrink-0 items-center justify-center rounded-full bg-destructive/10 px-1.5 text-[0.7rem] font-semibold tabular-nums text-destructive">
        {nombre(formateur.ecart)} h
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium leading-snug">{formateur.nom}</span>
        <span className="block text-[0.65rem] tabular-nums text-muted-foreground">
          E-note {nombre(formateur.enote)} h · EDT {nombre(formateur.edt)} h
        </span>
      </span>
    </button>
  );
}

/**
 * « Envoyer à tous les formateurs en manque » d'une semaine (2026-10-01,
 * demande du porteur). ⚠️ CONFIRMÉ D'ABORD : un clic part dans seize boîtes,
 * et un message envoyé ne se reprend pas.
 */
function EnvoyerATous({ semaine, nombre: combien }) {
  const envoi = useMutation({
    mutationFn: () => envoyerEcartSaisieATous(semaine),
    onSuccess: ({ envoyes, echecs }) => {
      if (echecs.length === 0) {
        toast.success(`${envoyes.length} message(s) envoyé(s)`, {
          description: `Tous les formateurs en manque en S${semaine} ont reçu leur état d’écart.`,
        });
        return;
      }
      toast.warning(`${envoyes.length} envoyé(s), ${echecs.length} non remis`, {
        description: echecs.map((echec) => `${echec.nom} : ${echec.motif}`).join('\n'),
        duration: 12000,
      });
    },
    onError: (erreur) => toast.error('Envoi impossible', { description: erreur.message }),
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          disabled={envoi.isPending}
          title={`Envoyer à tous les formateurs en manque de S${semaine}`}
          aria-label={`Envoyer à tous les formateurs en manque de S${semaine}`}
        >
          <Send className="size-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Envoyer à tous les formateurs en manque de S{semaine} ?</AlertDialogTitle>
          <AlertDialogDescription>
            {combien} formateur(s) recevront par la messagerie EDT Pro l’état de leur écart de saisie
            e-note, avec les modules et les séances à vérifier. Ceux qui n’ont pas de compte actif
            seront signalés.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={() => envoi.mutate()}>Envoyer à {combien}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** « 2026-09-14 » → « 14/09 ». */
function date(jour) {
  const [, mois, j] = String(jour).split('-');
  return `${j}/${mois}`;
}
