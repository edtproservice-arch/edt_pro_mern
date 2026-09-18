import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, Star } from 'lucide-react';
import { SEUIL_ACHEVEMENT } from 'shared/domain';
import BadgeSemestre from '@/components/common/BadgeSemestre';
import TableauTriable from '@/components/common/TableauTriable';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { nombre } from '@/lib/nombres';
import { cn } from '@/lib/utils';
import { chargerAchevement } from './api';

/**
 * L'ACHÈVEMENT des modules — combien sont terminés, et lesquels traînent.
 * ← le `#module-completion-card` d'avancement.html + sa modale de détail
 *
 * ═══ ⚠️ UNE LIGNE, PUIS UNE MODALE ═══
 * C'est la forme de l'existant, et elle est juste : le COMPTE se lit d'un coup
 * d'œil et tient sur une ligne ; le détail — cent vingt couples groupe/module —
 * n'a pas à occuper la page en permanence. L'écran d'avancement est déjà dense.
 *
 * ⚠️ IL SUIT LES FILTRES : le bilan porte sur les lignes retenues. Filtré sur la
 * 2ᵉ année, « 12 modules achevés sur 40 » parle de cette promotion — c'est
 * précisément la question qu'on pose en filtrant.
 */
export default function AchevementModules({
  completion,
  anneeScolaire,
  dateObservee = null,
  face = 'edtpro',
}) {
  const [ouvert, setOuvert] = useState(false);

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
        className="mt-3 flex w-full items-center gap-3 border-t pt-3 text-left transition-colors hover:text-primary"
      >
        <CheckCircle2 className="size-4 shrink-0 text-success" />

        <span className="text-xs">
          <span className="font-medium">{completion.acheves} module(s) achevé(s)</span>
          <span className="text-muted-foreground">
            {' '}
            sur {completion.total} — {completion.enCours} en cours
          </span>
        </span>

        {/* La barre reprend la forme de celle du tableau : même lecture partout. */}
        <span className="hidden h-1.5 max-w-40 flex-1 overflow-hidden rounded-full bg-muted sm:block">
          <span
            className="block h-full rounded-full bg-success"
            style={{ width: `${Math.min(100, completion.taux ?? 0)}%` }}
          />
        </span>

        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
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
        <DialogContent className="flex max-h-[85vh] max-w-5xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Achèvement des modules</DialogTitle>
            <DialogDescription>
              {completion.acheves} achevé(s) et {completion.enCours} en cours, sur{' '}
              {completion.total}. Un module est tenu pour achevé à partir de{' '}
              {SEUIL_ACHEVEMENT} % de sa masse affectée — les modules en cours viennent en premier.
            </DialogDescription>
          </DialogHeader>

          <Tableau
            details={completion.details}
            ouvert={ouvert}
            anneeScolaire={anneeScolaire}
            dateObservee={dateObservee}
            face={face}
          />
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
function Tableau({ details, ouvert, anneeScolaire, dateObservee, face }) {
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
    if (!avecDates) return details;
    const parCle = plages.data?.plages ?? {};
    return details.map((detail) => ({
      ...detail,
      ...datesDuModule(detail, parCle[`${detail.groupe}||${detail.module}`] ?? null),
    }));
  }, [details, avecDates, plages.data]);

  const colonnes = avecDates ? COLONNES_DATES : COLONNES_HEURES;

  return (
    <>
      <TableauTriable
        colonnes={colonnes}
        lignes={lignes}
        cleLigne={(ligne) => `${ligne.groupe}||${ligne.module}`}
        vide="Aucun module."
        /* ⚠️ C'EST ICI QUE LE TABLEAU DEVIENT DÉFILANT : `flex-1` lui donne la
           hauteur restante de la modale, `min-h-0` l'autorise à être plus court
           que son contenu — sans quoi il déborderait par le bas, coupé. Le
           défilement lui-même vit dans l'enveloppe de `Table` (cf.
           `TableauTriable`), seule ancre possible pour l'en-tête collant. */
        className="min-h-0 flex-1 overflow-hidden"
      />

      {plages.isLoading && (
        <p className="pt-2 text-center text-xs text-muted-foreground">Chargement des dates…</p>
      )}
    </>
  );
}

/* ─── Les colonnes communes aux deux faces ──────────────────────────────── */

const COLONNES_COMMUNES = [
  { id: 'groupe', entete: 'Groupe', tri: (l) => l.groupe, rendu: (l) => <span className="font-medium">{l.groupe}</span> },
  { id: 'module', entete: 'Module', tri: (l) => l.module, rendu: (l) => l.module },
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
 * @returns {{debut, fin, source, semaineDebut: number, semaineFin: number}}
 */
function datesDuModule(detail, plage) {
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
  let semaineFin = Infinity;

  if (detail.taux > 0 && !detail.acheve) {
    fin = (
      <span className="font-semibold text-accent-orange">
        En cours ({Math.round(detail.taux)} %)
      </span>
    );
  } else if (source === 'Chronogramme') {
    fin = `S${plage.prevue.fin}`;
    semaineFin = plage.prevue.fin;
  } else if (detail.acheve && plage?.posee) {
    fin = enDate(plage.datesPosees?.fin);
    semaineFin = plage.posee.fin;
  }

  return { debut, fin, source, semaineDebut, semaineFin };
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

