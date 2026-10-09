import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  File,
  FileSpreadsheet,
  FileText,
  Star,
} from 'lucide-react';
import {
  FILTRES_VIDES,
  SEUIL_ACHEVEMENT,
  completionModules,
  datesDeLaPlage,
  datesOuvrablesDeLaPlage,
  facettesAvancement,
  filtrerAvancement,
} from 'shared/domain';
import BadgeSemestre, { normaliserSemestre } from '@/components/common/BadgeSemestre';
import TableauTriable from '@/components/common/TableauTriable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { nombre } from '@/lib/nombres';
import { cn } from '@/lib/utils';
import { chargerAchevement, exporterAchevement } from './api';
import PanneauFiltres from './PanneauFiltres';
import { useEtatPartage } from '@/features/guidage/useEtatPartage';

/**
 * L'ACHÈVEMENT des modules — combien sont terminés, et lesquels traînent.
 * ← le `#module-completion-card` d'avancement.html + sa modale de détail
 *
 * ═══ ⚠️ UNE LIGNE, PUIS UNE MODALE ═══
 * C'est la forme de l'existant, et elle est juste : le COMPTE se lit d'un coup
 * d'œil et tient sur une ligne ; le détail — cent vingt couples groupe/module —
 * n'a pas à occuper la page en permanence. L'écran d'avancement est déjà dense.
 *
 * ═══ ⚠️⚠️ IL IGNORE LES FILTRES DE LA PAGE (2026-09-25, demande du porteur :
 * « il faut afficher tous les modules même si pas encore achevé ») ═══
 * C'était l'inverse jusqu'ici — le bilan suivait les lignes retenues par le
 * filtre de la page, sur l'idée que « filtré sur la 2ᵉ année, 12 modules
 * achevés sur 40 parle de cette promotion ». Le porteur est revenu dessus :
 * filtrer la page sur UN formateur ne doit plus faire disparaître les modules
 * des AUTRES de ce bilan, qui répond à une question différente — « où en est
 * l'ÉTABLISSEMENT, dans son ensemble ? ». `lignes` est donc TOUJOURS
 * `brutes`, l'ensemble non filtré de l'année.
 *
 * Ce composant porte son PROPRE filtre (`PanneauFiltres`, réutilisé tel quel),
 * séparé de celui de la page : une façon de REGARDER cette même liste complète
 * en modale, pas de la réduire par défaut — elle reste vide à l'ouverture.
 */
export default function AchevementModules({
  lignes,
  anneeScolaire,
  dateObservee = null,
  face = 'edtpro',
  /* Le nom complet de chaque module, par code — résolu par le serveur depuis la
     répartition DRIF (`Base.affectations` ne garde que le code). */
  intitules = {},
}) {
  const [ouvert, setOuvert] = useState(false);
  const [filtresModale, setFiltresModale] = useState(FILTRES_VIDES);
  // Les filtres de la fenêtre, partagés pendant le guidage (2026-10-04).
  useEtatPartage('avancement.achevement.filtres', filtresModale, (valeur) => {
    if (valeur && typeof valeur === 'object' && !Array.isArray(valeur)) setFiltresModale({ ...FILTRES_VIDES, ...valeur });
  });

  const completion = useMemo(() => completionModules(lignes), [lignes]);
  const facettes = useMemo(() => facettesAvancement(lignes), [lignes]);
  const retenues = useMemo(
    () => filtrerAvancement(lignes, filtresModale),
    [lignes, filtresModale]
  );
  const completionFiltree = useMemo(() => completionModules(retenues), [retenues]);
  const lignesTableau = useLignesTableau({
    details: completionFiltree?.details ?? [],
    ouvert,
    anneeScolaire,
    dateObservee,
    face,
    intitules,
  });

  /*
   * ═══ LE FILTRE PAR SOURCE (2026-10-07, demande du porteur) ═══ La source
   * (Emploi / Chronogramme / Non planifié) n'existe qu'une fois les plages
   * chargées : elle se filtre donc APRÈS le domaine, sur les lignes du tableau,
   * et seulement sur la face eDTpro, la seule qui la montre.
   */
  const sources = useMemo(
    () =>
      face === 'edtpro'
        ? ORDRE_SOURCES.filter((source) => lignesTableau.lignes.some((ligne) => ligne.source === source))
        : [],
    [face, lignesTableau.lignes]
  );
  // Une source retenue sur la face eDTpro ne doit pas vider la face e-note, qui n'en a pas.
  const sourcesChoisies = face === 'edtpro' ? (filtresModale.source ?? AUCUNE) : AUCUNE;
  const lignesVisibles = useMemo(
    () =>
      sourcesChoisies.length === 0
        ? lignesTableau.lignes
        : lignesTableau.lignes.filter((ligne) => sourcesChoisies.includes(ligne.source)),
    [lignesTableau.lignes, sourcesChoisies]
  );
  const acheves = lignesVisibles.filter((ligne) => ligne.acheve).length;

  if (!completion || completion.total === 0) return null;

  return (
    <>
      {/*
        ⚠️ UN BOUTON, PAS UNE LIGNE CLIQUABLE DÉGUISÉE : le curseur, le focus au
        clavier et la restitution vocale en dépendent, et rien d'autre ne dirait
        qu'il y a un détail derrière.
      */}
      <button
        type="button"
        onClick={() => setOuvert(true)}
        /* ⚠️ `py-2` : le MÊME espace en haut et en bas (demande du porteur, 2026-09-28 :
           « diminuer le padding top et bottom avec la même épaisseur »). `-mb-4` annule le
           `p-4` de la carte sous la ligne — sans lui, le bas gardait 24 px contre 8 en haut. */
        className="-mb-4 mt-2 flex w-full items-center gap-3 border-t py-2 text-left transition-colors hover:text-primary"
      >
        <CheckCircle2 className="size-4 shrink-0 text-success" />

        {/* ⚠️ `leading-none` + `mt-0.5` (demande du porteur, 2026-09-25 :
            d'abord « centrer le texte et la barre verticalement », puis
            « déplacer le texte et la barre un peu en bas pour qu'ils soient au
            centre ») : l'interligne PAR DÉFAUT de `text-xs` dépasse la hauteur
            réelle des lettres, et le retirer (`leading-none`) resserre la boîte
            au-dessus de son centre visuel plutôt que de le centrer — d'où ce
            léger réglage fin vers le bas, à côté d'une icône et d'une barre qui,
            elles, n'ont pas cet interligne à corriger. */}
        <span className="mt-0.5 text-xs leading-none">
          <span className="font-medium">{completion.acheves} module(s) achevé(s)</span>
          <span className="text-muted-foreground">
            {' '}
            sur {completion.total} — {completion.enCours} en cours
          </span>
        </span>

        {/* La barre reprend la forme de celle du tableau : même lecture partout. */}
        <span className="mt-0.5 hidden h-1.5 max-w-40 flex-1 overflow-hidden rounded-full bg-muted sm:block">
          <span
            className="block h-full rounded-full bg-success"
            style={{ width: `${Math.min(100, completion.taux ?? 0)}%` }}
          />
        </span>

        <span className="ml-auto flex items-center gap-1 text-xs leading-none text-muted-foreground">
          {nombre(completion.taux)} %
          <ChevronRight className="size-3.5" />
        </span>
      </button>

      <Dialog open={ouvert} onOpenChange={setOuvert}>
        {/*
          ⚠️⚠️ `flex flex-col` REMPLACE LA GRILLE DE shadcn, ET C'EST CE QUI
          DÉBLOQUE LE DÉFILEMENT. `DialogContent` est un `grid` : ses rangées se
          dimensionnent sur leur contenu, donc le tableau poussait la modale
          au-delà de `max-h-[85vh]`, et `overflow-hidden` COUPAIT le bas — les
          dernières lignes devenaient inatteignables. En colonne flex, l'en-tête
          garde sa taille et le tableau prend le reste, avec `min-h-0` pour
          l'autoriser à devenir plus court que son contenu.
        */}
        {/* ⚠️ JUSQU'À 96 % DE L'ÉCRAN (2026-10-07, demande du porteur : « s'il y a
            l'espace augmenter le width du modal pour annuler le scroll bar
            horizontal ») — `max-w-7xl` (1 280 px) ne suffisait plus depuis que
            l'intitulé a sa propre colonne, et la fin prévue sa seconde ligne. */}
        <DialogContent className="flex max-h-[85vh] w-[96vw] max-w-[min(96vw,120rem)] flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Achèvement des modules</DialogTitle>
            <DialogDescription>
              {acheves} achevé(s) et {lignesVisibles.length - acheves} en cours, sur{' '}
              {lignesVisibles.length}. Un module est tenu pour achevé à partir de{' '}
              {SEUIL_ACHEVEMENT} % de sa masse affectée — les modules en cours viennent en premier.
            </DialogDescription>
          </DialogHeader>

          {/*
            ⚠️ LE FILTRE DE CETTE FENÊTRE, SÉPARÉ DE CELUI DE LA PAGE (2026-09-25,
            demande du porteur : « je veux ajouter un filtre en modale »). Même
            composant que celui de la page (`PanneauFiltres`) — sa liste, déjà
            défilante au-delà de quelques valeurs, répond au « avec un
            scrollbar » demandé — mais son propre état : fermer cette fenêtre et
            la rouvrir retrouve la liste complète, jamais un filtre oublié.
          */}
          <div className="flex shrink-0 justify-end gap-2">
            <PanneauFiltres
              facettes={facettes}
              filtres={filtresModale}
              onChange={setFiltresModale}
              supplementaires={[{ cle: 'source', libelle: 'Source', valeurs: sources }]}
            />
            <Telecharger
              face={face}
              lignes={lignesVisibles}
              resume={`${acheves} achevé(s) et ${lignesVisibles.length - acheves} en cours, sur ${lignesVisibles.length}.`}
              dateObservee={dateObservee}
            />
          </div>

          <Tableau lignes={lignesVisibles} face={face} chargement={lignesTableau.chargement} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * DEUX JEUX DE COLONNES, UN PAR FACE (demande du porteur, 2026-09-01 — et c'est
 * déjà ce que faisait l'existant : `#modal-enote-content` et
 * `#modal-edtpro-content`, deux tables commutées).
 *
 * eDTpro sait QUAND : les séances sont datées, on peut donc dire le début, la
 * fin, et d'où vient l'information — la grille ou le chronogramme.
 *
 * E-note ne le sait PAS : un export déclare des HEURES cumulées, jamais le jour
 * où le module a commencé. Lui donner des colonnes « Début » et « Fin » qu'on
 * remplirait de « N/A » sur toutes les lignes ferait chercher une panne. Il
 * montre donc ce qu'il sait : affecté, réalisé, taux, statut.
 *
 * ⚠️ LE TRI PASSE PAR `TableauTriable`, le composant du bilan de charge, et non
 * par un second mécanisme : chaque colonne y déclare la VALEUR sur laquelle elle
 * trie, séparément de ce qu'elle affiche. C'est ce qui évite le défaut de
 * l'existant, qui relisait le texte des cellules et faisait passer « 90 h »
 * avant « 100 h ».
 */
/**
 * Les lignes du détail, dates comprises — calculées UNE fois, pour le tableau ET
 * pour l'export : le fichier téléchargé dit exactement ce que la fenêtre montre.
 */
function useLignesTableau({ details, ouvert, anneeScolaire, dateObservee, face, intitules }) {
  const avecDates = face === 'edtpro';

  /*
   * ⚠️ LES PLAGES NE SE CHARGENT QU'À L'OUVERTURE, ET QUE POUR eDTpro : la route
   * relit TOUS les chronogrammes de l'année, un parcours qu'on ne doit payer ni
   * à chaque ouverture de la page, ni sur une face qui n'affiche aucune date.
   */
  const plages = useQuery({
    /* ⚠️ LA DATE FAIT PARTIE DE LA CLÉ : sans elle, rembobiner rendrait les
       plages de l'état courant depuis le cache, à côté d'un décompte rembobiné. */
    queryKey: ['avancement', 'achevement', anneeScolaire, dateObservee],
    queryFn: () => chargerAchevement(dateObservee),
    enabled: ouvert && avecDates,
    retry: false,
    /* ⚠️ MÊME RAISON QUE LA PAGE : rembobiner avec le détail ouvert ne doit pas
       vider le tableau le temps de l'aller-retour. */
    placeholderData: keepPreviousData,
  });

  /*
   * ⚠️ LES DATES SONT CALCULÉES UNE FOIS, ICI, et non dans le rendu de chaque
   * cellule : le TRI a besoin des mêmes valeurs que l'affichage. Les recalculer
   * de deux côtés ferait diverger l'ordre de ce qu'on lit — le défaut même que
   * `TableauTriable` existe pour éviter.
   */
  const lignes = useMemo(() => {
    const parCle = plages.data?.plages ?? {};
    return details.map((detail) => ({
      ...detail,
      intitule: intitules[detail.module] ?? null,
      ...(avecDates
        ? datesDuModule(detail, parCle[`${detail.groupe}||${detail.module}`] ?? null, {
            anneeScolaire,
            dateObservee,
            rentrees: plages.data?.rentrees ?? [],
            feries: plages.data?.feries ?? [],
          })
        : {}),
    }));
  }, [details, avecDates, plages.data, intitules, anneeScolaire, dateObservee]);

  return { lignes, chargement: plages.isLoading };
}

function Tableau({ lignes, face, chargement }) {
  const avecDates = face === 'edtpro';
  const colonnes = avecDates ? COLONNES_DATES : COLONNES_HEURES;

  return (
    <>
      <TableauTriable
        colonnes={colonnes}
        lignes={lignes}
        cleLigne={(ligne) => `${ligne.groupe}||${ligne.module}`}
        vide="Aucun module."
        /*
         * ⚠️⚠️ `max-h-[...]` EST ICI DEPUIS LE 2026-09-25 — ET C'EST LUI QUI FAIT
         * RÉELLEMENT DÉFILER LE TABLEAU, PAS `flex-1 min-h-0` (signalé par le
         * porteur : 245 modules, tableau coupé, aucune barre de défilement).
         *
         * ⚠️ LA RAISON EST UNE LIMITE DE FLEXBOX, PAS UN OUBLI DE CLASSE :
         * `DialogContent` n'a qu'un `max-height` (85 vh), jamais de `height`. Un
         * conteneur flex dont la hauteur n'est que MAXIMALE — jamais DÉFINITIVE —
         * ne redistribue pas l'espace restant à ses enfants `flex-1` : le
         * navigateur calcule d'abord leur taille comme si le conteneur n'avait
         * AUCUNE limite, avant de ne clipper que le résultat final au moment de
         * peindre. C'est pour cela que « 7 modules » semblait fonctionner —
         * rien ne dépassait jamais l'espace réellement disponible — et que
         * « 245 » a révélé le défaut : le tableau grandissait à sa taille
         * NATURELLE (9 000 px et plus), simplement rognée par l'`overflow-hidden`
         * de la modale, sans le moindre défilement pour atteindre le bas.
         *
         * `max-h-[calc(85vh-11rem)]` donne au tableau une limite CHIFFRÉE, pas
         * seulement héritée d'un parent lui-même sans hauteur ferme — 11 rem
         * couvrant l'en-tête, le bouton « Filtrer » et les marges de la modale.
         * `min-h-0 flex-1` restent : sur un court tableau, ils continuent de le
         * laisser aussi bas que son contenu plutôt que d'imposer ce plafond.
         */
        className="min-h-0 flex-1 overflow-hidden max-h-[calc(85vh-11rem)]"
      />

      {chargement && (
        <p className="pt-2 text-center text-xs text-muted-foreground">Chargement des dates…</p>
      )}
    </>
  );
}

/**
 * Télécharger le détail en Word, PDF ou Excel (2026-10-07, demande du porteur).
 *
 * ⚠️ LES LIGNES DE LA FENÊTRE, FILTRE COMPRIS : l'écran envoie le texte de
 * chaque cellule tel qu'il l'affiche — dates, « En cours (83 %) », source —
 * et le serveur ne fait que le mettre en page. Recalculer côté serveur aurait
 * fait une seconde lecture des mêmes règles, libre de diverger.
 */
function Telecharger({ face, lignes, resume, dateObservee }) {
  const telechargement = useMutation({
    mutationFn: (format) => {
      const colonnes = face !== 'edtpro' ? EXPORT_HEURES : format === 'xlsx' ? EXPORT_EXCEL : EXPORT_DATES;
      return exporterAchevement({
        format,
        resume,
        dateObservee,
        colonnes: colonnes.map(({ id, entete }) => ({ id, entete })),
        lignes: lignes.map((ligne) => colonnes.map(({ valeur }) => String(valeur(ligne) ?? ''))),
      });
    },
    onError: (erreur) => toast.error('Téléchargement impossible', { description: erreur.message }),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          disabled={lignes.length === 0 || telechargement.isPending}
        >
          <Download className="size-4" />
          {telechargement.isPending ? 'Préparation…' : 'Télécharger'}
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => telechargement.mutate('docx')}>
          <FileText className="size-3.5 text-blue-600" />
          Télécharger en Word
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => telechargement.mutate('pdf')}>
          <File className="size-3.5 text-red-600" />
          Télécharger en PDF
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => telechargement.mutate('xlsx')}>
          <FileSpreadsheet className="size-3.5 text-green-600" />
          Télécharger en Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Les sources, dans l'ordre où le filtre les propose. */
const ORDRE_SOURCES = ['Emploi', 'Chronogramme', 'Non planifié'];
const AUCUNE = [];

/* Les colonnes du FICHIER — le texte de chaque cellule, comme à l'écran. */
const EXPORT_COMMUNES = [
  { id: 'groupe', entete: 'Groupe', valeur: (l) => l.groupe },
  { id: 'module', entete: 'Module', valeur: (l) => l.module },
  { id: 'intitule', entete: 'Intitulé du module', valeur: (l) => l.intitule ?? '' },
  {
    id: 'formateur',
    entete: 'Formateur',
    valeur: (l) => (l.formateurs.length > 0 ? l.formateurs.join(' · ') : 'Non assigné'),
  },
  { id: 'semestre', entete: 'Semestre', valeur: (l) => normaliserSemestre(l.semestre) ?? '' },
  { id: 'regional', entete: 'Régional', valeur: (l) => (l.estRegional ? 'Oui' : '') },
];
const EXPORT_DATES = [
  ...EXPORT_COMMUNES,
  { id: 'debut', entete: 'Début', valeur: (l) => l.debut },
  { id: 'fin', entete: 'Fin', valeur: (l) => l.finTexte },
  { id: 'source', entete: 'Source', valeur: (l) => l.source },
];
/*
 * ⚠️ L'EXCEL N'A NI « EN COURS » NI SOURCE (2026-10-09, demande du porteur) :
 * une semaine et une date prévisionnelle de début, puis de fin, jours fériés
 * exclus — des valeurs à retravailler dans le tableur, pas un libellé d'écran.
 */
const EXPORT_EXCEL = [
  ...EXPORT_COMMUNES,
  { id: 'semaineDebut', entete: 'Semaine début', valeur: (l) => l.prevision?.semaineDebut },
  { id: 'dateDebut', entete: 'Date début', valeur: (l) => l.prevision?.dateDebut },
  { id: 'semaineFin', entete: 'Semaine fin', valeur: (l) => l.prevision?.semaineFin },
  { id: 'dateFin', entete: 'Date fin', valeur: (l) => l.prevision?.dateFin },
];
const EXPORT_HEURES = [
  ...EXPORT_COMMUNES,
  { id: 'affecte', entete: 'Affecté (H)', valeur: (l) => nombre(l.prevu) },
  { id: 'realise', entete: 'Réalisé (H)', valeur: (l) => nombre(l.realise) },
  { id: 'taux', entete: 'Taux (%)', valeur: (l) => `${nombre(l.taux)} %` },
  { id: 'statut', entete: 'Statut', valeur: (l) => (l.acheve ? 'Achevé' : 'En cours') },
];

/* ─── Les colonnes communes aux deux faces ──────────────────────────────── */

const COLONNES_COMMUNES = [
  { id: 'groupe', entete: 'Groupe', tri: (l) => l.groupe, rendu: (l) => <span className="font-medium">{l.groupe}</span> },
  { id: 'module', entete: 'Module', tri: (l) => l.module, rendu: (l) => l.module },
  {
    /* ⚠️ SA PROPRE COLONNE (2026-10-07, demande du porteur) : sous le code, le
       nom complet ne se triait pas et ne se lisait qu'en petit. */
    id: 'intitule',
    entete: 'Intitulé du module',
    tri: (l) => l.intitule ?? '',
    rendu: (l) => (
      <div className="min-w-48 max-w-80 text-xs leading-snug">
        {l.intitule ?? <span className="text-muted-foreground">—</span>}
      </div>
    ),
  },
  {
    id: 'formateur',
    entete: 'Formateur',
    tri: (l) => l.formateurs.join(' '),
    /* ⚠️ « Non assigné » plutôt qu'une case vide, comme l'existant : un module
       sans formateur est un problème à corriger, pas une donnée manquante. */
    rendu: (l) => (
      <span className="text-xs text-muted-foreground">
        {l.formateurs.length > 0 ? l.formateurs.join(' · ') : 'Non assigné'}
      </span>
    ),
  },
  {
    id: 'semestre',
    entete: 'Semestre',
    tri: (l) => l.semestre ?? '',
    rendu: (l) => <BadgeSemestre semestre={l.semestre} />,
  },
  {
    id: 'regional',
    entete: 'Régional',
    /* Les régionaux d'abord en tri descendant : c'est ce qu'on vient chercher. */
    tri: (l) => (l.estRegional ? 1 : 0),
    /* Le même repère que le tableau principal : l'étoile ambre. */
    rendu: (l) =>
      l.estRegional ? (
        <Star className="size-3 fill-warning text-warning" />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

/* ─── Face eDTpro : Début · Fin · Source ────────────────────────────────── */

const COLONNES_DATES = [
  ...COLONNES_COMMUNES,
  {
    id: 'debut',
    entete: 'Début',
    /*
     * ⚠️ ON TRIE SUR LA SEMAINE, PAS SUR LE TEXTE AFFICHÉ : la colonne mélange
     * des dates (« 31/08/2026 ») et des semaines (« S14 ») selon la source, et
     * « 31/08 » se rangerait avant « 14/09 » en ordre alphabétique. La semaine
     * est la seule grandeur que les deux formes partagent.
     */
    tri: (l) => l.semaineDebut,
    rendu: (l) => <span className="text-xs tabular-nums">{l.debut}</span>,
  },
  {
    id: 'fin',
    entete: 'Fin',
    /* Un module en cours n'a pas de fin : il se range en dernier, jamais au
       milieu de ceux qui en ont une. */
    tri: (l) => l.semaineFin,
    rendu: (l) => <span className="text-xs tabular-nums">{l.fin}</span>,
  },
  {
    id: 'source',
    entete: 'Source',
    tri: (l) => l.source,
    rendu: (l) => <BadgeSource source={l.source} />,
  },
];

/* ─── Face e-note : Affecté · Réalisé · Taux · Statut ───────────────────── */

const COLONNES_HEURES = [
  ...COLONNES_COMMUNES,
  {
    id: 'affecte',
    entete: 'Affecté (H)',
    aligne: 'droite',
    tri: (l) => l.prevu,
    rendu: (l) => <span className="tabular-nums">{nombre(l.prevu)}</span>,
  },
  {
    id: 'realise',
    entete: 'Réalisé (H)',
    aligne: 'droite',
    tri: (l) => l.realise,
    rendu: (l) => <span className="tabular-nums">{nombre(l.realise)}</span>,
  },
  {
    id: 'taux',
    entete: 'Taux (%)',
    aligne: 'droite',
    tri: (l) => l.taux,
    rendu: (l) => <span className="font-semibold tabular-nums">{nombre(l.taux)} %</span>,
  },
  {
    id: 'statut',
    entete: 'Statut',
    tri: (l) => (l.acheve ? 1 : 0),
    rendu: (l) => (
      <Badge
        variant="secondary"
        className={cn(
          'text-[0.65rem]',
          l.acheve
            ? 'bg-success text-white hover:bg-success'
            : 'bg-accent-orange text-white hover:bg-accent-orange'
        )}
      >
        {l.acheve ? 'Achevé' : 'En cours'}
      </Badge>
    ),
  },
];

/**
 * Début · Fin · Source d'un module — face eDTpro.
 * ← `loadModulesCompletionTable()` d'avancement.html (l. 2338-2420)
 *
 * ═══ ⚠️ LA PRIORITÉ EST L'EMPLOI, PUIS LE CHRONOGRAMME ═══
 * Ce qui a été RÉELLEMENT posé prime sur ce qui était prévu : on veut savoir
 * quand le module a commencé, pas quand il devait. Le chronogramme ne prend le
 * relais que si rien n'a encore été posé — et « Source » dit lequel des deux
 * parle, sans quoi une intention se lirait comme un fait.
 *
 * ⚠️ LE CHRONOGRAMME S'EXPRIME EN SEMAINES, PAS EN DATES : c'est un prévisionnel
 * à la semaine, et lui donner un jour précis lui prêterait une exactitude qu'il
 * n'a pas. C'est déjà le choix de l'existant.
 *
 * @returns {{debut, fin, finTexte: string, source, semaineDebut: number, semaineFin: number}}
 */
function datesDuModule(detail, plage, contexte = {}) {
  let debut = 'N/A';
  let source = 'Non planifié';
  /* `Infinity` range ce qui n'a pas de date EN DERNIER, jamais au milieu. */
  let semaineDebut = Infinity;

  if (plage?.posee) {
    debut = enDate(plage.datesPosees?.debut);
    source = 'Emploi';
    semaineDebut = plage.posee.debut;
  } else if (plage?.prevue) {
    debut = `S${plage.prevue.debut}`;
    source = 'Chronogramme';
    semaineDebut = plage.prevue.debut;
  } else if (detail.taux > 0) {
    /* Des heures comptées sans plage : le module existe dans les totaux mais
       aucune semaine ne le porte. ← la branche « À venir » de l'existant. */
    debut = 'À venir';
    source = 'Emploi';
  }

  /*
   * ⚠️ « EN COURS (17 %) » REMPLACE LA DATE DE FIN, il ne s'y ajoute pas : tant
   * que le module n'est pas achevé, sa dernière séance posée N'EST PAS sa fin.
   * L'afficher comme telle annoncerait un module terminé qui ne l'est pas.
   */
  let fin = 'N/A';
  let finTexte = null;
  let semaineFin = Infinity;

  if (detail.taux > 0 && !detail.acheve) {
    const prevision = finPrevisionnelle(detail, plage, contexte);
    // Le même libellé en texte brut, pour l'export.
    finTexte = `En cours (${Math.round(detail.taux)} %)${
      prevision ? ` — ${prevision.libelle} S${prevision.semaine} (${enDate(prevision.date)})${prevision.depassee ? ', dépassée' : ''}` : ''
    }`;
    // Trié sur la fin ATTENDUE : un module en cours se range avec ceux qui finissent la même semaine.
    if (prevision) semaineFin = prevision.semaine;
    fin = (
      <span className="block whitespace-nowrap">
        <span className="font-semibold text-accent-orange">En cours ({Math.round(detail.taux)} %)</span>
        {prevision && (
          <span
            className={cn('block text-[0.7rem]', prevision.depassee ? 'text-destructive' : 'text-muted-foreground')}
            title={
              prevision.estimee
                ? 'Estimée au rythme constaté dans l’emploi : aucun chronogramme pour ce module.'
                : 'Dernière semaine prévue au chronogramme.'
            }
          >
            {prevision.libelle} S{prevision.semaine} · {enDate(prevision.date)}
            {prevision.depassee && ' (dépassée)'}
          </span>
        )}
      </span>
    );
  } else if (source === 'Chronogramme') {
    fin = `S${plage.prevue.fin}`;
    semaineFin = plage.prevue.fin;
  } else if (detail.acheve && plage?.posee) {
    fin = enDate(plage.datesPosees?.fin);
    semaineFin = plage.posee.fin;
  }

  return {
    debut,
    fin,
    finTexte: finTexte ?? fin,
    source,
    semaineDebut,
    semaineFin,
    prevision: previsionExport(semaineDebut, semaineFin, contexte),
  };
}

/**
 * Semaines et dates prévisionnelles de début et de fin, pour l'export Excel :
 * les MÊMES semaines que la fenêtre (posée, sinon prévue ; fin attendue pour un
 * module en cours), datées du premier et du dernier jour ouvrable, fériés exclus.
 */
function previsionExport(semaineDebut, semaineFin, { anneeScolaire, rentrees = [], feries = [] } = {}) {
  const dater = (semaine) =>
    Number.isFinite(semaine)
      ? datesOuvrablesDeLaPlage(Number(anneeScolaire), { debut: semaine, fin: semaine }, rentrees, feries)
      : null;
  const debut = dater(semaineDebut);
  const fin = dater(semaineFin);

  return {
    semaineDebut: Number.isFinite(semaineDebut) ? `S${semaineDebut}` : '',
    dateDebut: debut ? enDate(debut.debut) : '',
    semaineFin: Number.isFinite(semaineFin) ? `S${semaineFin}` : '',
    dateFin: fin ? enDate(fin.fin) : '',
  };
}

/**
 * La fin ATTENDUE d'un module en cours (2026-10-07, demande du porteur : « même
 * si la source est emploi et le module en cours, montrer aussi la semaine de
 * fin d'après le chronogramme, et proposer une date prévisionnelle »).
 *
 * 1. Le CHRONOGRAMME d'abord : sa dernière semaine prévue, et le samedi de
 *    cette semaine comme date prévisionnelle.
 * 2. Sans chronogramme, une ESTIMATION au rythme constaté dans l'emploi : le
 *    taux atteint divisé par les semaines écoulées depuis la première séance,
 *    prolongé jusqu'à 100 %. Les vacances n'y sont pas retirées — d'où le mot
 *    « estimée », et le survol qui le dit.
 *
 * « Dépassée » : la date attendue est déjà passée (à la date observée, ou
 * aujourd'hui) alors que le module n'est pas achevé.
 *
 * @returns {{semaine: number, date: string, libelle: string, estimee: boolean, depassee: boolean} | null}
 */
function finPrevisionnelle(detail, plage, { anneeScolaire, dateObservee, rentrees = [] } = {}) {
  let semaine = null;
  let estimee = false;
  let date = null;

  if (plage?.prevue) {
    semaine = plage.prevue.fin;
    // Le samedi de la dernière semaine prévue, tel que le serveur l'a daté.
    date = plage.datesPrevues?.fin ?? null;
  } else if (plage?.posee) {
    const ecoulees = plage.posee.fin - plage.posee.debut + 1;
    const rythme = detail.taux / ecoulees;
    if (rythme > 0) {
      semaine = plage.posee.fin + Math.ceil((100 - detail.taux) / rythme);
      estimee = true;
    }
  }

  /* ⚠️ LES RENTRÉES DU SERVEUR : ce sont elles qui ancrent S1 (07/09 en
     2026-2027) — sans elles, la date tomberait une semaine trop tôt. */
  if (!date && semaine) {
    date = datesDeLaPlage(Number(anneeScolaire), { debut: semaine, fin: semaine }, rentrees)?.fin ?? null;
  }
  if (!date) return null;

  const reference = dateObservee ? String(dateObservee).slice(0, 10) : aujourdhui();
  return {
    semaine,
    date,
    estimee,
    libelle: estimee ? 'Estimée' : 'Prévue',
    depassee: date < reference,
  };
}

/** « AAAA-MM-JJ » du jour, en heure locale. */
function aujourdhui() {
  const maintenant = new Date();
  const mois = String(maintenant.getMonth() + 1).padStart(2, '0');
  const jour = String(maintenant.getDate()).padStart(2, '0');
  return `${maintenant.getFullYear()}-${mois}-${jour}`;
}

/** D'où vient la date affichée — la grille, le chronogramme, ou rien. */
function BadgeSource({ source }) {
  const apparence =
    {
      Emploi: 'bg-success/15 text-success hover:bg-success/15',
      Chronogramme: 'bg-primary/10 text-primary hover:bg-primary/10',
    }[source] ?? 'bg-muted text-muted-foreground hover:bg-muted';

  return (
    <Badge variant="secondary" className={cn('text-[0.65rem] font-normal', apparence)}>
      {source}
    </Badge>
  );
}

/** « 2026-09-14 » -> « 14/09/2026 ». */
function enDate(iso) {
  if (!iso) return 'N/A';
  const [annee, mois, jour] = String(iso).split('-');
  return jour ? `${jour}/${mois}/${annee}` : 'N/A';
}

