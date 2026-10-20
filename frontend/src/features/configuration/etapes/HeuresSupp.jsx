import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarRange, ChevronLeft, ChevronRight, Clock, Network, Search } from 'lucide-react';
import { seuilHebdomadaire } from 'shared/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import IndicateurChargement from '@/components/ui/indicateur-chargement';
import Alerte from '@/components/common/Alerte';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { api } from '@/lib/apiClient';
import { cn } from '@/lib/utils';

/**
 * Heures supplémentaires des formateurs (demande du porteur, 2026-10-17).
 *
 * Le calcul est fait par le serveur (`GET /base/formateurs/heures-supp`) à partir des séances
 * terminées ; la règle vit dans `shared/domain/formateurs/heuresSupplementaires.js`.
 *
 * ═══ L'ÉCRAN REPREND L'ÉTAT MENSUEL EXCEL (2026-10-17, demande du porteur) ═══
 * Un onglet « Synthèse annuelle », puis un onglet par mois : les mêmes tableaux et les mêmes
 * colonnes que le classeur (`exportHeuresSupp.service.js`), dans le style des autres tableaux de
 * l'application.
 */

const MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
const libelleMois = (cle) => `${MOIS[Number(cle.slice(5, 7)) - 1]} ${cle.slice(0, 4)}`;
const dateFr = (jour) => `${jour.slice(8, 10)}/${jour.slice(5, 7)}/${jour.slice(0, 4)}`;
const samedi = (lundi) => {
  const date = new Date(`${lundi}T12:00:00`);
  date.setDate(date.getDate() + 5);
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
};

/*
 * Les formats du classeur : `decimales` (0,00) pour les heures de la grille, `heures` (« 0 » pour un
 * zéro) pour les cumuls, plafonds, quotas et totaux, case vide pour un TH.SUP nul.
 */
const decimales = (valeur) => (Math.round((Number(valeur) || 0) * 100) / 100).toFixed(2).replace('.', ',');
const heures = (valeur) => (valeur ? decimales(valeur) : '0');
const heuresOuVide = (valeur) => (valeur ? decimales(valeur) : '');
const entier = (valeur) => (valeur ? String(Math.round(valeur * 100) / 100).replace('.', ',') : '0');

/*
 * ═══ LE STYLE DES AUTRES TABLEAUX DE L'APPLICATION (2026-10-17, demande du porteur) ═══
 * Les composants `ui/table` (shadcn) : en-tête gris froid `bg-tableau-tete`, lignes séparées
 * d'un trait, survol. Le contenu reste celui de l'état Excel ; seule la charte change.
 *
 * Les retours à la ligne des en-têtes sont posés à la main (<br />) : sans `nowrap`, le navigateur
 * les recoupe à sa guise et élargit les colonnes.
 */
// Bordures sur toutes les cellules (2026-10-17, demande du porteur) : un quadrillage, comme le classeur.
const tete = 'h-auto whitespace-nowrap border bg-tableau-tete px-2 py-2 text-center text-xs leading-tight';
const cellule = 'whitespace-nowrap border px-2 py-1.5 text-center tabular-nums';
// Un trait vertical discret sépare les semaines (et les mois) : sans lui, TH.R et TH.SUP de deux
// semaines voisines se confondent.
// Dans le quadrillage, le trait entre deux semaines est un peu plus marqué que les autres.
const separation = 'border-l border-l-foreground/20';
// Mle et Nom restent visibles quand on fait défiler les semaines. Le tableau occupe toute la
// largeur, mais le nom garde celle du plus long nom : `w-px` + `nowrap` ramène une colonne à son
// contenu, et la place restante va aux colonnes d'heures.
const fixeMle = 'sticky left-0 z-10 w-16 min-w-16 max-w-16';
const fixeNom = 'sticky left-16 z-10 w-px';
// TH.SUP resserré : ses valeurs sont courtes (« 4,00 »), l'en-tête ne doit pas l'élargir.
const serre = 'w-px px-1.5';
/*
 * Les fonds de couleur (2026-10-17, demande du porteur) : ceux du classeur, en teintes douces
 * pour rester dans la charte de l'application — et lisibles en mode sombre.
 *   - bleu : l'en-tête d'une semaine (ou d'un mois) — le bleu des VACANCES du chronogramme
 *     (2026-10-17, demande du porteur) ;
 *   - ambre : une semaine avec un jour férié — l'ambre des fériés du chronogramme ;
 *   - vert : une heure supplémentaire ;
 *   - jaune : ce qui est payé.
 */
const fondGroupe = 'bg-primary/10 text-foreground';
const fondFerie = 'bg-warning/25 text-foreground';
// Les badges du chronogramme : « VAC », « 1 JF ».
const badgeVacances = 'bg-primary/20 text-primary';
const badgeFerie = 'bg-warning/40 text-foreground';

const feriesDe = (s) => (s.fermes ?? []).filter((f) => f.type === 'ferie');
const vacancesDe = (s) => (s.fermes ?? []).filter((f) => f.type === 'vacances');
const fondSemaine = (s) => (feriesDe(s).length > 0 ? fondFerie : fondGroupe);
const valeurHs = 'bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400';
const valeurPaye = 'bg-amber-50 font-semibold text-foreground dark:bg-amber-950/30';
const tetePaye = 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200';
/*
 * Formateur MUTUALISÉ (2026-10-18, demande du porteur) : sa ligne se distingue en violet — ses
 * masses et ses heures sont cumulées sur TOUS ses établissements, et le badge en donne le détail.
 */
const fondMutualise = 'bg-violet-50 dark:bg-violet-950/30';
const badgeMutualise =
  'inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 text-[0.65rem] font-semibold leading-5 text-violet-700 dark:bg-violet-900/60 dark:text-violet-200';
// Une valeur qui additionne plusieurs établissements : soulignée en pointillé, détail au survol.
const cumule = 'cursor-help underline decoration-violet-400 decoration-dotted underline-offset-2';

export function BoutonHeuresSupp({ onClick }) {
  return (
    <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onClick}>
      <Clock className="size-3.5" />
      Heures supplémentaires
    </Button>
  );
}

export function FenetreHeuresSupp({ onFermer }) {
  const requete = useQuery({
    queryKey: ['heures-supp'],
    queryFn: () => api.get('/api/v2/base/formateurs/heures-supp'),
    retry: false,
    staleTime: 60_000,
  });
  const [recherche, setRecherche] = useState('');
  const [vue, setVue] = useState('annuelle');
  const [moisChoisi, setMoisChoisi] = useState(null);

  /*
   * L'état mensuel de l'administration, une feuille par mois — pour tous les formateurs,
   * quelle que soit la recherche : il sert à la paie.
   */
  const exportation = useMutation({
    mutationFn: () =>
      api.telecharger('/api/v2/base/formateurs/heures-supp/etat-mensuel', {}, {
        nomParDefaut: 'etat-mensuel-heures-supp.xlsx',
      }),
    onError: (erreur) => toast.error('Export impossible', { description: erreur.message }),
  });

  const donnees = requete.data;
  const calendrier = useMemo(() => donnees?.semaines ?? [], [donnees]);

  // Trié par matricule, comme le classeur.
  const tous = useMemo(
    () =>
      [...(donnees?.formateurs ?? [])].sort((a, b) =>
        String(a.matricule).localeCompare(String(b.matricule), 'fr', { numeric: true })
      ),
    [donnees]
  );
  const formateurs = useMemo(() => {
    const filtre = recherche.trim().toUpperCase();
    return tous.filter(
      (f) => !filtre || f.nom.toUpperCase().includes(filtre) || String(f.matricule).includes(filtre)
    );
  }, [tous, recherche]);

  // Les mois où quelqu'un a des heures réalisées — les feuilles du classeur.
  const moisTravailles = useMemo(
    () =>
      [...new Set(calendrier.map((s) => s.mois))].filter((mois) =>
        tous.some((f) => f.mois.some((m) => m.mois === mois && m.heures > 0))
      ),
    [calendrier, tous]
  );

  const moisAffiche = moisTravailles.includes(moisChoisi) ? moisChoisi : moisTravailles.at(-1);

  const sansStatutaire = tous.filter((f) => f.sansStatutaire && f.totaux.heures > 0).length;

  return (
    <Dialog open onOpenChange={(etat) => !etat && onFermer()}>
      <DialogContent className="max-h-[92vh] w-[96vw] max-w-[96vw] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Heures supplémentaires</DialogTitle>
          {/* Masquée (2026-10-17, demande du porteur) : gardée pour les lecteurs d'écran. */}
          <DialogDescription className="sr-only">
            Heures supplémentaires de chaque formateur : synthèse annuelle et état de chaque mois.
          </DialogDescription>
        </DialogHeader>

        {requete.isPending && (
          <div className="flex justify-center p-8">
            <IndicateurChargement />
          </div>
        )}

        {requete.isError && (
          <Alerte type="avertissement" titre="Le calcul n’a pas pu être fait">
            {requete.error.message}
          </Alerte>
        )}

        {requete.isSuccess && (
          <div className="min-w-0 space-y-3">
            {sansStatutaire > 0 && (
              <Alerte type="info" titre={`${sansStatutaire} formateur(s) sans masse statutaire`}>
                Sans masse statutaire, le quota ne peut pas être calculé : aucune heure
                supplémentaire ne leur est comptée.
              </Alerte>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={recherche}
                  onChange={(e) => setRecherche(e.target.value)}
                  placeholder="Nom ou matricule…"
                  aria-label="Rechercher un formateur"
                  className="h-8 pl-8"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={exportation.isPending}
                onClick={() => exportation.mutate()}
                title="Le même contenu en Excel : synthèse annuelle et une feuille par mois"
              >
                <CalendarRange className="size-3.5" />
                {exportation.isPending ? 'Export en cours…' : 'État mensuel'}
              </Button>
            </div>

            {moisTravailles.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Aucune séance terminée pour l’instant cette année.
              </p>
            ) : (
              /*
               * ═══ DEUX ONGLETS ET UN SÉLECTEUR DE MOIS (2026-10-17, demande du porteur) ═══
               * Un onglet par mois en aurait aligné dix en fin d'année : la barre débordait. On
               * choisit la vue (année / mois), puis le mois — par la liste ou les flèches.
               */
              <Tabs value={vue} onValueChange={setVue} className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <TabsList>
                    <TabsTrigger value="annuelle">Synthèse annuelle</TabsTrigger>
                    <TabsTrigger value="mois">Par mois</TabsTrigger>
                  </TabsList>
                  {vue === 'mois' && (
                    <ChoixMois
                      liste={moisTravailles}
                      valeur={moisAffiche}
                      onChange={setMoisChoisi}
                    />
                  )}
                </div>

                <TabsContent value="annuelle" className="min-w-0">
                  <SyntheseAnnuelle formateurs={formateurs} moisTravailles={moisTravailles} />
                </TabsContent>
                <TabsContent value="mois" className="min-w-0">
                  <EtatDuMois
                    formateurs={formateurs}
                    semaines={calendrier.filter((s) => s.mois === moisAffiche)}
                    mois={moisAffiche}
                    realiseAu={donnees?.realiseAu}
                  />
                </TabsContent>
                <LegendeMutualises formateurs={formateurs} />
              </Tabs>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Le mois affiché : flèches précédent / suivant, et la liste pour sauter directement. */
function ChoixMois({ liste, valeur, onChange }) {
  const rang = liste.indexOf(valeur);
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        disabled={rang <= 0}
        onClick={() => onChange(liste[rang - 1])}
        aria-label="Mois précédent"
      >
        <ChevronLeft className="size-4" />
      </Button>
      <Select value={valeur} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-44 text-sm" aria-label="Mois affiché">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {liste.map((mois) => (
            <SelectItem key={mois} value={mois}>
              {libelleMois(mois)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        disabled={rang >= liste.length - 1}
        onClick={() => onChange(liste[rang + 1])}
        aria-label="Mois suivant"
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

/* ─── Briques communes aux deux tableaux ─────────────────────────────────── */

const vacataire = (f) => f.statut === 'vacataire';
const mhs = (f) => f.mhs ?? (vacataire(f) ? 'Vac.' : '—');

/** Le reste du quota à la fin d'un mois : le quota moins tout ce qui a été payé jusque-là. */
function resteFinDeMois(formateur, mois) {
  const paye = formateur.mois.filter((m) => m.mois <= mois).reduce((total, m) => total + m.paye, 0);
  return Math.max(0, Math.round((formateur.totaux.quota - paye) * 100) / 100);
}

function LegendeMutualises({ formateurs }) {
  if (!formateurs.some((f) => f.mutualise)) return null;
  return (
    <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
      <span className={cn('inline-block size-3 rounded-sm border border-violet-200', fondMutualise)} />
      Formateur mutualisé : masse affectée et heures cumulées sur tous ses établissements — survolez le
      badge pour le détail, et une valeur soulignée pour la part faite ailleurs.
    </p>
  );
}

function Cadre({ children }) {
  return (
    <div className="rounded-lg border">
      <Table wrapperClassName="max-h-[60vh] rounded-lg" className="text-xs">
        {children}
      </Table>
    </div>
  );
}

function EnTete({ children }) {
  // Collé en haut du tableau quand il défile — sur le gris de l'en-tête, pas sur du transparent.
  return <TableHeader className="sticky top-0 z-20">{children}</TableHeader>;
}

function LigneFormateur({ formateur, children }) {
  const discret = vacataire(formateur) && 'italic text-muted-foreground';
  const fond = formateur.mutualise ? fondMutualise : 'bg-background';
  return (
    <TableRow className={cn('group', discret, formateur.mutualise && fondMutualise)}>
      <TableCell className={cn(cellule, fixeMle, fond, 'text-left group-hover:bg-muted')}>
        {formateur.matricule}
      </TableCell>
      <TableCell
        className={cn(cellule, fixeNom, fond, 'text-left group-hover:bg-muted', !vacataire(formateur) && 'font-medium')}
      >
        <span className="inline-flex items-center gap-1.5">
          {formateur.nom}
          {formateur.mutualise && <BadgeMutualise formateur={formateur} />}
        </span>
      </TableCell>
      {children}
    </TableRow>
  );
}

/** « Mutualisé » : au survol, la masse affectée et les heures réalisées de chaque établissement. */
function BadgeMutualise({ formateur }) {
  const { ici, ailleurs } = formateur.mutualise;
  const lignes = [{ nom: 'Cet établissement', ...ici }, ...ailleurs];
  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span className={cn(badgeMutualise, 'cursor-help')}>
          <Network className="size-3" />
          Mutualisé
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="right" className="w-auto p-3 text-left not-italic">
        <p className="text-sm font-medium">Formateur mutualisé</p>
        <p className="mt-0.5 max-w-72 whitespace-normal text-xs text-muted-foreground">
          Ses heures supplémentaires sont calculées sur l’ensemble de ses établissements : les
          masses affectées et les heures de chaque semaine s’additionnent.
        </p>
        <table className="mt-2 w-full text-xs tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className="pr-3 text-left font-medium">Établissement</th>
              <th className="px-2 text-right font-medium">Affectée</th>
              <th className="pl-2 text-right font-medium">Réalisé</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((ligne) => (
              <tr key={ligne.nom} className="border-t">
                <td className="py-1 pr-3">{ligne.nom}</td>
                <td className="px-2 py-1 text-right">{entier(ligne.affecte)} h</td>
                <td className="py-1 pl-2 text-right">{heures(ligne.heures)} h</td>
              </tr>
            ))}
            <tr className="border-t font-semibold">
              <td className="py-1 pr-3">Total</td>
              <td className="px-2 py-1 text-right">{entier(formateur.affecte)} h</td>
              <td className="py-1 pl-2 text-right">{heures(formateur.totaux.heures)} h</td>
            </tr>
          </tbody>
        </table>
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * Une valeur cumulée sur plusieurs établissements : soulignée en pointillé, et au survol une
 * CARTE (2026-10-18, demande du porteur — pas une infobulle) qui nomme chaque établissement.
 *
 * @param {{titre: string, ici: number, ailleurs: Array<{nom: string, valeur: number}>,
 *   total: number, format: (n: number) => string, children: React.ReactNode}} props
 */
function CarteCumul({ titre, ici, ailleurs, total, format, children }) {
  if (!ailleurs?.length) return children;
  const lignes = [{ nom: 'Cet établissement', valeur: ici }, ...ailleurs];
  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span className={cumule}>{children}</span>
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-auto p-3 text-left not-italic">
        <p className="text-sm font-medium">{titre}</p>
        <table className="mt-2 w-full text-xs tabular-nums">
          <tbody>
            {lignes.map((ligne) => (
              <tr key={ligne.nom} className="border-t first:border-t-0">
                <td className="py-1 pr-4">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={cn(
                        'size-2 rounded-full',
                        ligne.nom === 'Cet établissement' ? 'bg-primary' : 'bg-violet-500'
                      )}
                    />
                    {ligne.nom}
                  </span>
                </td>
                <td className="py-1 text-right">{format(ligne.valeur)} h</td>
              </tr>
            ))}
            <tr className="border-t font-semibold">
              <td className="py-1 pr-4">Total</td>
              <td className="py-1 text-right">{format(total)} h</td>
            </tr>
          </tbody>
        </table>
      </HoverCardContent>
    </HoverCard>
  );
}

/* ─── Synthèse annuelle ──────────────────────────────────────────────────── */

function SyntheseAnnuelle({ formateurs, moisTravailles }) {
  const duMois = (f, mois) => f.mois.find((m) => m.mois === mois);

  return (
    <Cadre>
      <EnTete>
        <TableRow className="hover:bg-transparent">
          <TableHead rowSpan={2} className={cn(tete, fixeMle, 'text-left')}>Mle</TableHead>
          <TableHead rowSpan={2} className={cn(tete, fixeNom, 'text-left')}>Nom et Prénom</TableHead>
          <TableHead rowSpan={2} className={tete}>Masse<br />statutaire</TableHead>
          <TableHead rowSpan={2} className={cn(tete, 'w-px')}>MHS</TableHead>
          <TableHead rowSpan={2} className={tete}>Masse<br />affectée</TableHead>
          <TableHead rowSpan={2} className={tete}>Quota<br />HS</TableHead>
          {moisTravailles.map((mois) => (
            <TableHead key={mois} colSpan={2} className={cn(tete, separation, fondGroupe, 'font-semibold')}>
              {libelleMois(mois)}
            </TableHead>
          ))}
          <TableHead rowSpan={2} className={cn(tete, separation)}>Total<br />réalisé</TableHead>
          <TableHead rowSpan={2} className={tete}>HS<br />réalisées</TableHead>
          <TableHead rowSpan={2} className={cn(tete, tetePaye)}>HS payées<br />(année)</TableHead>
          <TableHead rowSpan={2} className={tete}>Reste du<br />quota</TableHead>
        </TableRow>
        <TableRow className="hover:bg-transparent">
          {moisTravailles.flatMap((mois) => [
            <TableHead key={`${mois}-r`} className={cn(tete, separation, fondGroupe)}>TH.R</TableHead>,
            <TableHead key={`${mois}-p`} className={cn(tete, fondGroupe)}>HS payées</TableHead>,
          ])}
        </TableRow>
      </EnTete>
      <TableBody>
        {formateurs.map((f) => (
          <LigneFormateur key={f.matricule || f.nom} formateur={f}>
            <TableCell className={cellule}>{f.statutaire || '—'}</TableCell>
            <TableCell className={cellule}>{mhs(f)}</TableCell>
            <TableCell className={cellule}>
              <CarteCumul
                titre={`Masse affectée de ${f.nom}`}
                ici={f.mutualise?.ici.affecte}
                ailleurs={f.mutualise?.ailleurs.map((a) => ({ nom: a.nom, valeur: a.affecte }))}
                total={f.affecte}
                format={entier}
              >
                {entier(f.affecte)}
              </CarteCumul>
            </TableCell>
            <TableCell className={cellule}>{heures(f.totaux.quota)}</TableCell>
            {moisTravailles.flatMap((mois) => {
              const m = duMois(f, mois);
              return [
                <TableCell key={`${mois}-r`} className={cn(cellule, separation)}>
                  {decimales(m?.heures)}
                </TableCell>,
                <TableCell key={`${mois}-p`} className={cn(cellule, m?.paye && valeurHs)}>
                  {heuresOuVide(m?.paye)}
                </TableCell>,
              ];
            })}
            <TableCell className={cn(cellule, separation, 'font-medium')}>{heures(f.totaux.heures)}</TableCell>
            <TableCell className={cellule}>{heures(f.totaux.brut)}</TableCell>
            <TableCell className={cn(cellule, valeurPaye)}>{heures(f.totaux.paye)}</TableCell>
            {/* Le reste du quota en vert (2026-10-17, demande du porteur) — un zéro reste neutre. */}
            <TableCell className={cn(cellule, f.totaux.restant > 0 && valeurHs)}>{heures(f.totaux.restant)}</TableCell>
          </LigneFormateur>
        ))}
        {formateurs.length === 0 && <LigneVide colonnes={10 + moisTravailles.length * 2} />}
      </TableBody>
    </Cadre>
  );
}

/* ─── Un mois ────────────────────────────────────────────────────────────── */

/**
 * Le TH.SUP d'une semaine, NÉGATIF compris (2026-10-20, demande du porteur) : l'écart entre les
 * heures réalisées et le seuil de la semaine. Positif, ce sont les heures supp (plafonnées à 35 h) ;
 * négatif, ce qui manque pour atteindre le seuil. Ce n'est qu'un affichage : un écart négatif ne
 * retire rien aux heures supp des autres semaines.
 *
 * @returns {number|null}  `null` : pas d'écart à montrer — vacataire, ou semaine pas encore commencée
 */
function ecartSemaine(formateur, semaine, valeurs, realiseAu) {
  if (!formateur.mhs) return null;
  if (realiseAu && semaine.lundi > realiseAu.date) return null;
  const seuil = seuilHebdomadaire(semaine.joursFermes, formateur.mhs);
  const heuresSemaine = valeurs?.heures ?? 0;
  return heuresSemaine < seuil ? heuresSemaine - seuil : valeurs?.brut ?? 0;
}

const afficherEcart = (ecart) => {
  if (ecart === null) return '';
  if (ecart < 0) return `−${decimales(-ecart)}`;
  return decimales(ecart);
};

function EtatDuMois({ formateurs, semaines, mois, realiseAu }) {
  const parFormateur = useMemo(
    () => new Map(formateurs.map((f) => [f, new Map(f.semaines.map((s) => [s.numero, s]))])),
    [formateurs]
  );
  const semaine = (f, numero) => parFormateur.get(f)?.get(numero);
  const duMois = (f) => f.mois.find((m) => m.mois === mois);

  return (
    <Cadre>
      <EnTete>
        <TableRow className="hover:bg-transparent">
          <TableHead rowSpan={2} className={cn(tete, fixeMle, 'text-left')}>Mle</TableHead>
          <TableHead rowSpan={2} className={cn(tete, fixeNom, 'text-left')}>Nom et Prénom</TableHead>
          <TableHead rowSpan={2} className={cn(tete, 'w-px')}>MHS</TableHead>
          {semaines.map((s) => (
            <EnTeteSemaine key={s.numero} semaine={s} />
          ))}
          <TableHead rowSpan={2} className={cn(tete, separation)}>Total<br />réalisé</TableHead>
          <TableHead rowSpan={2} className={tete}>Cumul<br />TH.SUP</TableHead>
          <TableHead rowSpan={2} className={cn(tete, tetePaye)}>Plafond<br />(payé)</TableHead>
          <TableHead rowSpan={2} className={tete}>Quota<br />HS</TableHead>
          <TableHead rowSpan={2} className={tete}>Reste du<br />quota</TableHead>
        </TableRow>
        <TableRow className="hover:bg-transparent">
          {semaines.flatMap((s) => [
            <TableHead key={`${s.numero}-r`} className={cn(tete, separation, fondSemaine(s))}>
              TH.R
            </TableHead>,
            <TableHead key={`${s.numero}-s`} className={cn(tete, serre, fondSemaine(s))}>
              TH.SUP
            </TableHead>,
          ])}
        </TableRow>
      </EnTete>
      <TableBody>
        {formateurs.map((f) => {
          const m = duMois(f);
          return (
            <LigneFormateur key={f.matricule || f.nom} formateur={f}>
              <TableCell className={cellule}>{mhs(f)}</TableCell>
              {semaines.flatMap((s) => {
                const valeurs = semaine(f, s.numero);
                return [
                  <TableCell key={`${s.numero}-r`} className={cn(cellule, separation)}>
                    <CarteCumul
                      titre={`S-${s.calendaire} (S${s.numero}) — heures réalisées`}
                      ici={(valeurs?.heures ?? 0) - (valeurs?.ailleurs ?? []).reduce((t, a) => t + a.heures, 0)}
                      ailleurs={valeurs?.ailleurs?.map((a) => ({ nom: a.nom, valeur: a.heures }))}
                      total={valeurs?.heures ?? 0}
                      format={decimales}
                    >
                      {decimales(valeurs?.heures)}
                    </CarteCumul>
                  </TableCell>,
                  <TableCell
                    key={`${s.numero}-s`}
                    className={cn(
                      cellule,
                      serre,
                      valeurs?.brut > 0 && valeurHs,
                      ecartSemaine(f, s, valeurs, realiseAu) < 0 && 'text-red-600 dark:text-red-400'
                    )}
                  >
                    {afficherEcart(ecartSemaine(f, s, valeurs, realiseAu))}
                  </TableCell>,
                ];
              })}
              <TableCell className={cn(cellule, separation, 'font-medium')}>{decimales(m?.heures)}</TableCell>
              {/*
                Cumul TH.SUP (2026-10-20, règle du porteur) : total réalisé − masse horaire du mois
                (26 h par semaine, − 4,334 h par jour férié). Négatif en rouge, comme le TH.SUP.
              */}
              <TableCell
                className={cn(
                  cellule,
                  m?.cumul > 0 && valeurHs,
                  m?.cumul < 0 && 'text-red-600 dark:text-red-400'
                )}
              >
                {afficherEcart(m?.cumul ?? null)}
              </TableCell>
              <TableCell className={cn(cellule, valeurPaye)}>{heures(m?.paye)}</TableCell>
              <TableCell className={cellule}>{heures(f.totaux.quota)}</TableCell>
              <TableCell className={cn(cellule, resteFinDeMois(f, mois) > 0 && valeurHs)}>
                {heures(resteFinDeMois(f, mois))}
              </TableCell>
            </LigneFormateur>
          );
        })}
        {formateurs.length === 0 && <LigneVide colonnes={8 + semaines.length * 2} />}
      </TableBody>
    </Cadre>
  );
}

/**
 * L'en-tête d'une semaine, comme au chronogramme (2026-10-17, demande du porteur) : la teinte
 * dit qu'un jour est fermé, les badges disent combien (« 1 JF », « VAC »), et la carte au survol
 * nomme le férié, en français et en arabe, avec le seuil qui en découle.
 */
function EnTeteSemaine({ semaine: s }) {
  const feries = feriesDe(s);
  const vacances = vacancesDe(s);
  const badges = [];
  if (vacances.length >= 6) badges.push(['VAC', badgeVacances]);
  else if (vacances.length > 0) badges.push([`${vacances.length} JVAC`, badgeVacances]);
  if (feries.length > 0) badges.push([`${feries.length} JF`, badgeFerie]);

  const contenu = (
    <TableHead colSpan={2} className={cn(tete, separation, fondSemaine(s), s.joursFermes > 0 && 'cursor-help')}>
      <span className="font-semibold">
        S-{s.calendaire} (S{s.numero})
      </span>
      <br />
      <span className="text-muted-foreground">
        {dateFr(s.lundi)}
        <br />
        au {dateFr(samedi(s.lundi))}
      </span>
      <span className="mt-1 flex flex-wrap justify-center gap-0.5">
        {badges.length === 0 ? (
          <span className="text-[0.65rem] text-muted-foreground">JF=0</span>
        ) : (
          badges.map(([texte, teinte]) => (
            <span key={texte} className={cn('rounded px-1 text-[0.6rem] font-semibold leading-4', teinte)}>
              {texte}
            </span>
          ))
        )}
      </span>
    </TableHead>
  );

  if (s.joursFermes === 0) return contenu;

  const ouvres = 6 - s.joursFermes;
  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>{contenu}</HoverCardTrigger>
      <HoverCardContent side="bottom" className="w-auto max-w-72 p-3 text-left">
        <p className="text-sm font-medium">
          Semaine S{s.numero} (S-{s.calendaire}) — du {dateFr(s.lundi)} au {dateFr(samedi(s.lundi))}
        </p>

        {vacances.length > 0 && (
          <p className="mt-1 text-sm text-muted-foreground">
            {[...new Set(vacances.map((v) => v.motif))].join(', ')} — {vacances.length} jour(s) de
            vacances.
          </p>
        )}

        {feries.map((ferie) => (
          <div key={ferie.date} className="mt-2 border-t pt-2">
            <p className="text-sm font-medium">{ferie.motif}</p>
            {/* `dir="rtl"` : sinon chiffres et parenthèses se rendent à l'envers. */}
            {ferie.intituleAr && (
              <p dir="rtl" lang="ar" className="text-sm text-muted-foreground">
                {ferie.intituleAr}
              </p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {dateFr(ferie.date)} —{' '}
              {ferie.estime ? 'date estimée, fête lunaire confirmée quelques jours avant.' : 'jour férié.'}
            </p>
          </div>
        ))}

        <p className="mt-2 text-xs text-warning">
          {ouvres} jour(s) ouvré(s) — seuil des heures supp : {seuilHebdomadaire(s.joursFermes, 26)} h
          (MHS 26 h), {seuilHebdomadaire(s.joursFermes, 36)} h (MHS 36 h).
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}

function LigneVide({ colonnes }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colonnes} className="p-6 text-center text-sm text-muted-foreground">
        Aucun formateur ne correspond.
      </TableCell>
    </TableRow>
  );
}
