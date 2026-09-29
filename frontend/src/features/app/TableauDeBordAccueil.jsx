import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import {
  Area,
  Bar,
  BarChart,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { agregerAvancement, dureeSeance } from 'shared/domain';
import { Button } from '@/components/ui/button';
import { chargerContexte, chargerSemaines } from '@/features/emploi/api';
import { chargerAbsences } from '@/features/absences/api';
import { chargerAchevement, chargerAvancement } from '@/features/avancement/api';
import { chargerCompletude, chargerFormateursChronogramme } from '@/features/chronogramme/api';
import { adresseCase } from '@/features/chronogramme/useCaseCiblee';
import { COULEURS_PROGRESSION } from '@/features/avancement/GrapheProgression';
import { nombre } from '@/lib/nombres';
import { cn } from '@/lib/utils';
import ATraiter from './ATraiter';
import {
  SectionDiscipline,
  SectionGroupesAbsents,
  SectionGroupesRetards,
  TuilesAbsencesDiscipline,
  useTableauDeBordAbsences,
} from './StatistiquesAbsencesDiscipline';

/**
 * Le tableau de bord du directeur (2026-09-28, demande du porteur : « si tu es
 * un directeur, quels indicateurs veux-tu voir ? »), dans le style d'origine de
 * l'accueil — tuiles simples, sections encadrées, une colonne centrée.
 *
 * ═══ QUATRE QUESTIONS, DANS CET ORDRE ═══
 *   1. Sommes-nous dans les temps ?        avancement, projection, groupes en retard
 *   2. L'emploi du temps est-il prêt ?     horizon de planification, publication
 *   3. Qu'est-ce qui dérape ?              modules en voie d'achèvement, heures perdues
 *   4. Les ressources sont-elles bien employées ?  service des formateurs
 *
 * ⚠️ TOUT MÈNE À L'ENDROIT EXACT (2026-09-28, demande du porteur) : un groupe
 * en retard ouvre l'Avancement filtré sur lui, un module en voie d'achèvement sa case du
 * chronogramme, un formateur son chronogramme, la tuile « Planifié jusqu'à »
 * la première semaine qui n'est pas prête, rapport d'écarts ouvert.
 *
 * ⚠️ AUCUNE ROUTE NOUVELLE, et les MÊMES clés de cache que les écrans métier :
 * ce qu'un écran a déjà chargé ne coûte rien ici, et l'inverse.
 */

/** Semaines de l'année régionale — la projection s'arrête là. */
const DERNIERE_SEMAINE = 39;

/** Le rythme se mesure sur les quatre dernières semaines, pas depuis la rentrée. */
const FENETRE_RYTHME = 4;

/** Une semaine est « prête » quand l'emploi du temps couvre son chronogramme à ce taux. */
const SEUIL_PRETE = 95;

/** Un module est « en voie d'achèvement » si sa fin prévue tombe dans ces semaines-ci. */
const HORIZON_RISQUE = 3;

/** Les statuts des groupes, par écart au rythme régional (en points). */
const STATUTS = [
  { cle: 'avance', libelle: 'En avance', min: 2, couleur: 'bg-success' },
  {
    cle: 'rythme',
    libelle: 'Dans le rythme',
    min: -2,
    couleur: 'bg-success/50',
  },
  { cle: 'retard', libelle: 'En retard', min: -10, couleur: 'bg-warning' },
  {
    cle: 'critique',
    libelle: 'Critique',
    min: -Infinity,
    couleur: 'bg-destructive',
  },
];

export default function TableauDeBordAccueil() {
  /*
   * ⚠️ TOUT REPLIÉ PAR DÉFAUT, SAUF « À TRAITER » (2026-09-29, demande du
   * porteur : « je veux que ces cards sauf à traiter être masquées par
   * défaut, et si je clique sur une des cards stats en haut s'affiche la card
   * concernée »). Une seule section ouverte à la fois — cliquer une tuile
   * déjà ouverte la referme, cliquer une autre bascule dessus — dans le même
   * esprit que les catégories de « Documents » (`CartesDocuments.jsx`), d'où
   * vient aussi l'animation d'agrandissement.
   */
  const [sectionOuverte, setSectionOuverte] = useState(null);
  const basculerSection = (cle) => setSectionOuverte((avant) => (avant === cle ? null : cle));

  // ⚠️ MÊME CLÉ QUE L'ACCUEIL DU GESTIONNAIRE : voir `StatistiquesAbsencesDiscipline`.
  const bordAbsences = useTableauDeBordAbsences();
  const [contexte, semaines, absences, avancement, completude, achevement, formateurs] = useQueries(
    {
      queries: [
        {
          queryKey: ['emploi', 'contexte'],
          queryFn: chargerContexte,
          retry: false,
        },
        {
          queryKey: ['emploi', 'semaines'],
          queryFn: chargerSemaines,
          retry: false,
        },
        {
          queryKey: ['absences', 'toutes'],
          queryFn: () => chargerAbsences({}),
          retry: false,
        },
        /* ⚠️ LA MÊME CLÉ QUE LA PAGE AVANCEMENT, date comprise (`null` = l'état courant). */
        {
          queryKey: ['avancement', null],
          queryFn: () => chargerAvancement(),
          retry: false,
        },
        {
          queryKey: ['chronogramme-completude-annee'],
          queryFn: () => chargerCompletude(),
          retry: false,
        },
        /*
         * ⚠️ RELIT TOUS LES CHRONOGRAMMES : gardée cinq minutes, pour qu'un
         * aller-retour entre l'accueil et un écran ne la relance pas.
         */
        {
          queryKey: ['avancement', 'achevement', 'accueil'],
          queryFn: () => chargerAchevement(),
          retry: false,
          staleTime: 5 * 60 * 1000,
        },
        /* Nom → identifiant, pour ouvrir le chronogramme d'un formateur. La même
         clé que la page Chronogramme en mode formateur. */
        {
          queryKey: ['chronogrammes', 'formateurs'],
          queryFn: chargerFormateursChronogramme,
          retry: false,
        },
      ],
    },
  );

  const donnees = avancement.data;
  const courante = donnees?.semaineCourante ?? numeroDeSemaine(semaines.data?.courante);
  const lignes = donnees?.faces?.edtpro;

  const trajectoire = useMemo(
    () => calculerTrajectoire(donnees?.progression ?? [], courante),
    [donnees, courante],
  );
  const statuts = useMemo(
    () => statutsDesGroupes(lignes ?? [], donnees?.regional ?? null),
    [lignes, donnees],
  );
  const risques = useMemo(
    () => modulesARisque(lignes ?? [], achevement.data?.plages, courante, donnees?.intitules),
    [lignes, achevement.data, courante, donnees],
  );
  /* ⚠️ LA TUILE COMPTE À PART LES ACHEVÉS (2026-09-29, demande du porteur :
     « séparer le nombre module achevé et module en voie d'achèvement ») :
     depuis que `modulesARisque` inclut aussi les modules à 100 %, un compte
     brut mélangerait les deux dans une seule alerte. */
  const risquesEnCours = useMemo(() => risques.filter((module) => (module.taux ?? 0) < 100), [risques]);
  const risquesTermines = risques.length - risquesEnCours.length;
  const service = useMemo(
    () =>
      serviceDesFormateurs(lignes ?? [], donnees?.statutaires ?? {}, formateurs.data?.formateurs),
    [lignes, donnees, formateurs.data],
  );

  /*
   * ⚠️ SANS BASE, PAS DE CHIFFRES — ET ON LE DIT. Le contexte répond 404 tant
   * qu'aucune base n'a été importée : un tableau de zéros laisserait croire à
   * un établissement vide alors que la configuration n'a pas commencé.
   */
  if (contexte.isError) {
    return (
      <section className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm font-medium">Votre établissement n’a pas encore de base</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Les chiffres apparaîtront ici dès que vos formateurs et vos groupes seront connus.
        </p>
        <Button asChild size="sm" className="mt-3">
          <Link to="/app/parametres/carte">Construire la carte</Link>
        </Button>
      </section>
    );
  }

  const horizon = horizonDePlanification(
    completude.data,
    courante,
    numeroDeSemaine(semaines.data?.publication?.semaine),
  );
  const pertes = heuresPerdues(absences.data?.absences ?? []);
  const enRetard = (statuts.compte.retard ?? 0) + (statuts.compte.critique ?? 0);

  return (
    <>
      {/*
        ⚠️ AU-DESSUS DE LA GRILLE DE TUILES ELLE-MÊME (2026-09-29, revient sur
        « au-dessus de "À traiter"» : « en haut aussi de ces cards stats ») —
        la carte ouverte est désormais la toute première chose de l'accueil
        après la salutation, avant même les tuiles qui l'ouvrent : cliquer une
        tuile en bas de la grille n'oblige plus à remonter la page pour voir
        ce qui vient de s'ouvrir. Une seule ouverte à la fois, agrandie comme
        sur « Documents » : chaque section porte sa propre garde
        (`sectionOuverte === '…'`) et la même animation d'entrée que les
        catégories de `CartesDocuments.jsx`.
      */}
      {sectionOuverte === 'trajectoire' && (
        <div className="duration-300 animate-in fade-in-0 zoom-in-95 slide-in-from-top-3 motion-reduce:animate-none">
          <Trajectoire trajectoire={trajectoire} regional={donnees?.regional ?? null} />
        </div>
      )}
      {sectionOuverte === 'statuts' && (
        <div className="duration-300 animate-in fade-in-0 zoom-in-95 slide-in-from-top-3 motion-reduce:animate-none">
          <StatutsGroupes statuts={statuts} />
        </div>
      )}
      {sectionOuverte === 'risque' && (
        <div className="duration-300 animate-in fade-in-0 zoom-in-95 slide-in-from-top-3 motion-reduce:animate-none">
          <ModulesARisque risques={risques} courante={courante} />
        </div>
      )}
      {sectionOuverte === 'service' && (
        <div className="duration-300 animate-in fade-in-0 zoom-in-95 slide-in-from-top-3 motion-reduce:animate-none">
          <ServiceFormateurs service={service} />
        </div>
      )}
      {!bordAbsences.isError && (
        <>
          <SectionGroupesAbsents
            d={bordAbsences.data}
            chargement={bordAbsences.isLoading}
            visible={sectionOuverte === 'absences'}
          />
          <SectionGroupesRetards
            d={bordAbsences.data}
            chargement={bordAbsences.isLoading}
            visible={sectionOuverte === 'retards'}
          />
          <SectionDiscipline
            d={bordAbsences.data}
            chargement={bordAbsences.isLoading}
            visible={sectionOuverte === 'discipline'}
          />
        </>
      )}

      {/* ⚠️ TROIS PAR RANGÉE : à six tuiles, deux rangées pleines se lisent mieux
          que quatre colonnes laissant la seconde à moitié vide. */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TuileAvancement
          trajectoire={trajectoire}
          chargement={avancement.isLoading}
          onClick={() => basculerSection('trajectoire')}
          ouvert={sectionOuverte === 'trajectoire'}
        />
        <Tuile
          libelle={`Projection en S${DERNIERE_SEMAINE}`}
          valeur={trajectoire.fin === null ? null : `${nombre(trajectoire.fin)} %`}
          detail={
            trajectoire.fin === null
              ? 'Trop tôt pour projeter'
              : `au rythme des ${FENETRE_RYTHME} dernières semaines`
          }
          alerte={trajectoire.fin !== null && trajectoire.fin < 100}
          chargement={avancement.isLoading}
          vers="/app/avancement"
          onClick={() => basculerSection('trajectoire')}
          ouvert={sectionOuverte === 'trajectoire'}
        />
        {/* ⚠️ SANS SECTION LOCALE : elle mène directement à « Emploi », comme avant. */}
        <Tuile
          libelle="Planifié jusqu’à"
          valeur={horizon.derniere ? `S${horizon.derniere}` : null}
          detail={horizon.detail}
          alerte={!horizon.derniere}
          chargement={completude.isLoading || semaines.isLoading}
          vers={horizon.vers}
        />
        <Tuile
          libelle="Groupes en retard"
          valeur={statuts.total ? `${enRetard} / ${statuts.total}` : null}
          detail={
            statuts.compte.critique
              ? `dont ${statuts.compte.critique} en retard critique`
              : undefined
          }
          alerte={enRetard > 0}
          chargement={avancement.isLoading}
          onClick={() => basculerSection('statuts')}
          ouvert={sectionOuverte === 'statuts'}
        />
        <Tuile
          libelle="Modules en voie d’achèvement"
          valeur={achevement.isError ? null : risquesEnCours.length}
          detail={`fin prévue d’ici S${(courante ?? 0) + HORIZON_RISQUE}`}
          alerte={risquesEnCours.length > 0}
          chargement={achevement.isLoading || avancement.isLoading}
          onClick={() => basculerSection('risque')}
          ouvert={sectionOuverte === 'risque'}
          extra={
            risquesTermines > 0 && (
              <span className="shrink-0 text-right">
                <span className="block text-[0.65rem] text-muted-foreground">Achevés</span>
                <span className="block text-2xl font-semibold tabular-nums text-success">
                  {risquesTermines}
                </span>
              </span>
            )
          }
        />
        {/* ⚠️ SANS SECTION LOCALE : le registre des absences de FORMATEURS n'a pas
            de carte ici (page « Absences », onglet Formateurs). */}
        <Tuile
          libelle="Heures perdues"
          valeur={`${nombre(pertes.heures)} h`}
          detail={
            pertes.absences > 0
              ? `${pertes.absences} absence(s) sans rattrapage${
                  pertes.delai !== null
                    ? ` · rattrapage en ${nombre(pertes.delai)} j en moyenne`
                    : ''
                }`
              : 'Toutes les absences sont rattrapées'
          }
          alerte={pertes.heures > 0}
          chargement={absences.isLoading}
          vers={pertes.absences > 0 ? '/app/absences?filtre=attente' : '/app/absences'}
        />
        {/*
          ⚠️ SA PROPRE TUILE (2026-09-29, demande du porteur) : elle manquait —
          « Service des formateurs » restait visible en permanence, faute d'un
          geste pour la rouvrir une fois repliée.
        */}
        <Tuile
          libelle="Service des formateurs"
          valeur={`${service.length}/${formateurs.data?.formateurs?.length ?? '—'}`}
          detail="hors de 80 – 100 % du service statutaire"
          alerte={service.length > 0}
          chargement={avancement.isLoading || formateurs.isLoading}
          onClick={() => basculerSection('service')}
          ouvert={sectionOuverte === 'service'}
        />
        {/*
          ⚠️ POUR REMPLIR LA DERNIÈRE RANGÉE (2026-09-29, demande du porteur) :
          sans elle, dix tuiles laissaient la quatrième rangée à une seule
          carte, perdue seule sur trois colonnes. Sans section locale à
          ouvrir — un simple lien, comme « Planifié jusqu'à ».
        */}
        {/*
          ⚠️ REVIENT SUR « GROUPES » (2026-09-29, demande du porteur : « j'ai
          déjà 4/18, mets une autre stat ») : le total des groupes était déjà
          lisible dans « Groupes en retard » (4 / 18) — répéter le 18 n'y
          ajoutait rien. Les MODULES, comptés depuis les affectations, sont une
          donnée que rien d'autre sur cet accueil ne montre encore.
        */}
        <Tuile
          libelle="Modules"
          valeur={
            contexte.data
              ? new Set((contexte.data.affectations ?? []).map((a) => a.module)).size
              : null
          }
          detail="enseignés cette année, tous groupes confondus"
          chargement={contexte.isLoading}
          vers="/app/parametres/affectations"
        />
        {/*
          ⚠️ LA DOUZIÈME, POUR REMPLIR LA RANGÉE ENTIÈREMENT (2026-09-29,
          demande du porteur : « ajoute une douzième pour remplir complètement,
          nombre salle »).
        */}
        <Tuile
          libelle="Salles"
          valeur={contexte.data?.salles?.length ?? null}
          detail="espaces déclarés, prêtés compris"
          chargement={contexte.isLoading}
          vers="/app/parametres/espaces"
        />
        {/*
          ⚠️ DANS LA MÊME GRILLE, PAS UNE RANGÉE À PART (2026-09-29, demande du
          porteur : « mets ces cartes en haut avec les autres ») — neuf tuiles,
          trois rangées pleines de trois, au lieu d'un bloc séparé plus bas.
        */}
        <TuilesAbsencesDiscipline
          d={bordAbsences.data}
          chargement={bordAbsences.isLoading}
          onOuvrir={basculerSection}
          sectionOuverte={sectionOuverte}
        />
      </section>

      <ATraiter />
    </>
  );
}

/* ═══ Les sections ═════════════════════════════════════════════════════ */

/*
 * ⚠️ `onClick` FAIT BASCULER LA CARD LOCALE (2026-09-29, demande du porteur),
 * `vers` RESTE UN LIEN quand aucune section ne répond de cette tuile — les
 * deux sont mutuellement exclusifs, `onClick` l'emporte quand il est fourni.
 */
function Tuile({ libelle, valeur, detail, alerte, chargement, vers, onClick, ouvert, extra }) {
  const classe = cn(
    'rounded-lg border p-4 text-left transition-colors hover:border-input hover:bg-muted/40',
    ouvert && 'border-primary/40 bg-primary/5'
  );
  const principal = (
    <div>
      <p className="text-xs text-muted-foreground">{libelle}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', alerte && 'text-destructive')}>
        {chargement ? '—' : (valeur ?? '—')}
      </p>
      {detail && !chargement && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
  const contenu =
    extra && !chargement ? (
      <div className="flex items-start justify-between gap-4">
        {principal}
        {extra}
      </div>
    ) : (
      principal
    );

  if (onClick) {
    return (
      <button type="button" aria-pressed={ouvert} onClick={onClick} className={classe}>
        {contenu}
      </button>
    );
  }
  return (
    <Link to={vers} className={classe}>
      {contenu}
    </Link>
  );
}

/**
 * L'avancement à gauche, le taux régional attendu à droite (2026-09-29,
 * demande du porteur). L'avancement est ROUGE sous le régional, VERT au-dessus
 * ou à égalité : la couleur dit d'un coup d'œil de quel côté on se trouve.
 *
 * ⚠️ LE RÉGIONAL RESTE NEUTRE : c'est la référence, pas une mesure de
 * l'établissement — le colorer ferait croire qu'il peut être « bon » ou
 * « mauvais ».
 */
function TuileAvancement({ trajectoire, chargement, onClick, ouvert }) {
  const { actuel, regional, ecart } = trajectoire;

  return (
    <button
      type="button"
      aria-pressed={ouvert}
      onClick={onClick}
      className={cn(
        'rounded-lg border p-4 text-left transition-colors hover:border-input hover:bg-muted/40',
        ouvert && 'border-primary/40 bg-primary/5'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Taux d’avancement</p>
          <p
            className={cn(
              'mt-1 text-2xl font-semibold tabular-nums',
              !chargement && ecart !== null && (ecart < 0 ? 'text-destructive' : 'text-success')
            )}
          >
            {chargement || actuel === null ? '—' : `${nombre(actuel)} %`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Taux régional</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-muted-foreground">
            {chargement || regional === null ? '—' : `${nombre(regional)} %`}
          </p>
        </div>
      </div>
      {!chargement && ecart !== null && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {signe(ecart)} pt face au régional
        </p>
      )}
    </button>
  );
}

/** Le cadre commun des sections : titre et lien vers la vue complète DANS le cadre. */
function Section({ titre, lien, libelleLien, children }) {
  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium">{titre}</h2>
        {lien && (
          <Link to={lien} className="flex items-center gap-1 text-xs text-primary hover:underline">
            {libelleLien}
            <ArrowUpRight className="size-3" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * L'avancement de l'année, la projection jusqu'en S39 et le rythme régional.
 *
 * ⚠️ LA PROJECTION PART DE LA SEMAINE EN COURS, en pointillé : c'est une
 * hypothèse (« si l'on continue ainsi »), pas une mesure — la tracer pleine la
 * ferait lire comme une donnée.
 */
function Trajectoire({ trajectoire, regional }) {
  if (trajectoire.points.length === 0) return null;

  return (
    <Section titre="Trajectoire de l’année" lien="/app/avancement" libelleLien="Voir le détail">
      <p className="mt-0.5 text-xs">
        {trajectoire.rythme === null ? (
          <span className="text-muted-foreground">
            La projection apparaîtra après les premières semaines de cours.
          </span>
        ) : (
          <>
            <span className="text-muted-foreground">Rythme actuel : </span>
            <span className="font-medium tabular-nums">
              {nombre(trajectoire.rythme)} pt / semaine
            </span>
            <span className="text-muted-foreground"> · nécessaire pour finir : </span>
            <span
              className={cn(
                'font-medium tabular-nums',
                trajectoire.necessaire > trajectoire.rythme ? 'text-destructive' : 'text-success',
              )}
            >
              {nombre(trajectoire.necessaire)} pt / semaine
            </span>
            <span className="text-muted-foreground">
              {' '}
              sur {trajectoire.restantes} semaine(s) restante(s)
            </span>
          </>
        )}
      </p>

      <div className="mt-3 h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={trajectoire.points}
            margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
          >
            <XAxis
              dataKey="libelle"
              tickLine={false}
              axisLine={false}
              interval={3}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            />
            <YAxis
              domain={[0, 100]}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(valeur) => `${valeur} %`}
            />
            <Tooltip content={<InfoBulle />} />
            <Area
              type="monotone"
              dataKey="avancement"
              name="Avancement"
              stroke={COULEURS_PROGRESSION.avancement}
              fill={COULEURS_PROGRESSION.avancement}
              fillOpacity={0.12}
              strokeWidth={2}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="projection"
              name="Projection"
              stroke={COULEURS_PROGRESSION.avancement}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="regional"
              name="Rythme régional"
              stroke={COULEURS_PROGRESSION.regional}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-xs">
        <Repere couleur={COULEURS_PROGRESSION.avancement} libelle="Avancement" />
        <Repere couleur={COULEURS_PROGRESSION.avancement} libelle="Projection" pointille />
        {regional && (
          <Repere couleur={COULEURS_PROGRESSION.regional} libelle="Rythme régional attendu" />
        )}
      </div>
    </Section>
  );
}

/** Les groupes répartis par écart au régional, puis les plus en retard. */
function StatutsGroupes({ statuts }) {
  if (statuts.total === 0) return null;

  return (
    <Section titre="Statut des groupes" lien="/app/avancement" libelleLien="Tous les groupes">
      {/* ⚠️ ANNEAU À LA NOTION, PAS UNE BARRE (2026-09-29, demande du porteur,
          capture d'un graphique « Chart » Notion à l'appui) : le total au
          centre de l'anneau, la légende en dessous. */}
      <AnneauStatutsGroupes statuts={statuts} />

      {statuts.enRetard.length > 0 && (
        <ul className="mt-4 divide-y border-t">
          {statuts.enRetard.slice(0, 6).map((groupe) => (
            <li key={groupe.cle}>
              <Link to={avancementDesGroupes([groupe.sujet])} className={LIGNE_LIEN}>
                <span className="w-28 shrink-0 truncate font-medium">{groupe.sujet}</span>
                <Barre taux={groupe.taux} couleur={groupe.statut.couleur} />
                <span className="w-14 shrink-0 text-right text-xs tabular-nums">
                  {nombre(groupe.taux ?? 0)} %
                </span>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-destructive">
                  {signe(groupe.ecart)} pt
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** La teinte SVG (pas la classe Tailwind, réservée aux aplats) de chaque statut. */
const TEINTES_STATUTS = {
  avance: 'hsl(var(--success))',
  rythme: 'hsl(var(--success) / 50%)',
  retard: 'hsl(var(--warning))',
  critique: 'hsl(var(--destructive))',
};

/** L'anneau segmenté par statut, le total au centre — comme un « Chart » Notion. */
function AnneauStatutsGroupes({ statuts }) {
  const rayon = 60;
  const circonference = 2 * Math.PI * rayon;
  let cumul = 0;
  const segments = STATUTS.map((statut) => {
    const valeur = statuts.compte[statut.cle] ?? 0;
    const part = statuts.total > 0 ? valeur / statuts.total : 0;
    const decalage = cumul;
    cumul += part;
    return { ...statut, valeur, part, decalage };
  }).filter((segment) => segment.valeur > 0);

  return (
    <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-10">
      <div className="relative shrink-0">
        <svg viewBox="0 0 140 140" className="size-36 -rotate-90" aria-hidden="true">
          <circle cx="70" cy="70" r={rayon} fill="none" strokeWidth="16" className="stroke-muted" />
          {segments.map((segment) => (
            <circle
              key={segment.cle}
              cx="70"
              cy="70"
              r={rayon}
              fill="none"
              strokeWidth="16"
              stroke={TEINTES_STATUTS[segment.cle]}
              strokeDasharray={`${segment.part * circonference} ${circonference}`}
              strokeDashoffset={-segment.decalage * circonference}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold tabular-nums">{statuts.total}</span>
          <span className="text-[0.7rem] text-muted-foreground">Groupes</span>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs sm:flex-col sm:items-start">
        {STATUTS.map((statut) => (
          <span key={statut.cle} className="flex items-center gap-1.5">
            <span className={cn('block size-2.5 rounded-full', statut.couleur)} />
            {statut.libelle}
            <span className="tabular-nums text-muted-foreground">
              {statuts.compte[statut.cle] ?? 0}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Les modules dont le chronogramme prévoit la fin d'ici quelques semaines — ou
 * l'a déjà dépassée — et qui ne sont pas achevés.
 *
 * ⚠️ LA FIN PRÉVUE AU CHRONOGRAMME, PAS LA DATE D'EFM : celle-ci n'est connue
 * qu'une fois l'examen posé dans l'emploi du temps. La fin de plage est le
 * repère disponible pour TOUS les modules, dès la planification annuelle.
 */
function ModulesARisque({ risques, courante }) {
  if (risques.length === 0) return null;

  return (
    <Section titre="Modules en voie d’achèvement" lien="/app/avancement" libelleLien="Voir l’achèvement">
      <p className="mt-0.5 text-xs text-muted-foreground">
        Fin prévue au chronogramme d’ici S{(courante ?? 0) + HORIZON_RISQUE} ou déjà passée, module
        non achevé — les modules régionaux d’abord.
      </p>

      <TimelineModulesARisque risques={risques} courante={courante} />
    </Section>
  );
}

/** La largeur d'une colonne de semaine — sert aussi au calcul du défilement des boutons. */
const LARGEUR_COLONNE = 288; // w-72

/**
 * ═══ UNE FRISE, PAS UNE LISTE (2026-09-29, demande du porteur : « mettre
 * dans une timeline inspirée de Notion », maquettes à l'appui) ═══ Les
 * semaines en colonnes, chaque module rangé sous SA semaine de fin — la même
 * lecture qu'un Gantt Notion, réduite à ce que ce projet modélise vraiment :
 * des semaines numérotées, pas des dates de calendrier (§ « aucune heure
 * d'horloge » du domaine).
 *
 * ⚠️ LA SEMAINE EN COURS EST REPÉRÉE, PAS SEULEMENT CELLES DES MODULES :
 * sans elle, une frise qui commence à S5 en cours de S7 ne dit pas où on est
 * — c'est pourtant le repère qui donne son sens à « dépassée » ou « à venir ».
 *
 * ⚠️⚠️ TOUTE L'ANNÉE, MÊME VIDE, AVEC UN BASCULEUR (2026-09-29, revient sur
 * « seulement les semaines des modules » — demande du porteur : « afficher
 * les semaines de toute l'année même si vide, avec un bouton de bascule en
 * haut pour se déplacer entre les semaines ») : la frise couvre S1 à S39, et
 * s'ouvre déjà scrollée sur la semaine en cours plutôt qu'à S1 — sinon
 * l'essentiel resterait hors champ derrière trente-cinq colonnes vides.
 */
function TimelineModulesARisque({ risques, courante }) {
  const defilement = useRef(null);

  const semaines = useMemo(
    () => Array.from({ length: DERNIERE_SEMAINE }, (_, i) => i + 1),
    []
  );

  const parSemaine = useMemo(() => {
    const carte = new Map(semaines.map((s) => [s, []]));
    for (const module of risques) carte.get(module.fin)?.push(module);
    return carte;
  }, [semaines, risques]);

  const indexCourante = courante ? semaines.indexOf(courante) : -1;

  /** Centre la semaine en cours à l'ouverture — sinon la frise s'ouvre sur S1, loin de ce qui compte. */
  const allerAJourdhui = () => {
    if (!defilement.current || indexCourante < 0) return;
    defilement.current.scrollTo({
      left: Math.max(0, indexCourante * LARGEUR_COLONNE - 2 * LARGEUR_COLONNE),
      behavior: 'smooth',
    });
  };
  useEffect(() => {
    if (!defilement.current || indexCourante < 0) return;
    defilement.current.scrollLeft = Math.max(0, indexCourante * LARGEUR_COLONNE - 2 * LARGEUR_COLONNE);
    // ⚠️ UNE SEULE FOIS, À L'OUVERTURE : un ré-alignement à chaque changement de
    // `risques` (un module réalisé, retiré de la liste) ramènerait la vue à «
    // aujourd'hui » pendant qu'on regarde une autre semaine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const defiler = (sens) =>
    defilement.current?.scrollBy({ left: sens * LARGEUR_COLONNE * 3, behavior: 'smooth' });

  return (
    <div className="mt-3 space-y-2">
      {/*
        ⚠️ LE BASCULEUR, AU-DESSUS DE LA FRISE (2026-09-29, demande du
        porteur, maquette « ‹ Aujourd'hui › » à l'appui) : deux flèches font
        défiler de trois semaines, « Aujourd'hui » recentre sur la semaine en
        cours — le même geste que `NavigationSemaine`, réduit à ce dont cette
        frise a besoin.
      */}
      <div className="flex items-center justify-end gap-1">
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={allerAJourdhui}>
          Aujourd’hui
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7"
          aria-label="Semaines précédentes"
          onClick={() => defiler(-1)}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7"
          aria-label="Semaines suivantes"
          onClick={() => defiler(1)}
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>

      {/*
        ⚠️ FOND DAMIER, COMME LES COLONNES DU JOUR SUR « EMPLOI » (2026-09-29,
        demande du porteur : « améliore le style, plus » — après une première
        frise jugée juste) : un dégradé de gris très pâle en alternance sépare
        les semaines au premier regard, sans un trait de plus.
      */}
      <div ref={defilement} className="overflow-x-auto rounded-lg border bg-card">
      <div className="flex min-w-max">
        {semaines.map((semaine, index) => {
          const enCours = semaine === courante;
          const passee = courante !== null && semaine < courante;
          const modules = parSemaine.get(semaine) ?? [];
          return (
            <div
              key={semaine}
              className={cn(
                'w-72 shrink-0 border-r last:border-r-0',
                enCours ? 'bg-primary/5' : index % 2 === 1 && 'bg-muted/30'
              )}
            >
              {/* ⚠️ L'EN-TÊTE DE COLONNE COLLE EN HAUT DE LA FRISE QUI DÉFILE
                  (`sticky top-0`), comme les jours de « Emploi » — sans repère
                  fixe, on perd la semaine en faisant défiler horizontalement. */}
              <div
                className={cn(
                  'sticky top-0 z-10 flex h-9 items-center justify-between gap-2 border-b bg-background/95 px-3 backdrop-blur-sm',
                  enCours && 'border-b-primary/40'
                )}
              >
                <span
                  className={cn(
                    'flex items-center gap-1.5 text-xs font-semibold',
                    enCours ? 'text-primary' : passee ? 'text-destructive' : 'text-foreground'
                  )}
                >
                  {enCours && <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />}
                  S{semaine}
                  {enCours && <span className="font-normal text-muted-foreground">· en cours</span>}
                </span>
                {modules.length > 0 && (
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold tabular-nums',
                      passee ? 'bg-destructive/15 text-destructive' : 'bg-warning/25 text-accent-orange-deep'
                    )}
                  >
                    {modules.length}
                  </span>
                )}
              </div>

              <div className="space-y-2 p-2">
                {modules.length === 0 ? (
                  <p className="px-1 py-6 text-center text-[0.7rem] text-muted-foreground">
                    Rien de prévu
                  </p>
                ) : (
                  modules.map((module) => (
                    <CarteModuleTimeline key={module.cle} module={module} courante={courante} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

/**
 * Une carte de la frise — blanche, un LISERÉ DE COULEUR à gauche pour porter
 * l'urgence plutôt qu'un aplat entier (2026-09-29, demande du porteur :
 * « améliore le style, plus » — le premier essai teintait toute la carte,
 * lourd répété huit fois de suite ; Notion réserve la couleur aux étiquettes,
 * jamais au fond de la carte elle-même).
 */
/**
 * ⚠️ STYLE « CARTE NOTION » (2026-09-29, demande du porteur, captures des
 * cartes du Gantt Notion à l'appui) : plus de liseré coloré sur le bord — une
 * carte blanche toute simple, un petit anneau de progression au lieu d'une
 * barre, et une pastille de statut arrondie en bout de ligne (« En cours »,
 * « En retard », « Terminé »), exactement comme Notion l'affiche.
 *
 * ⚠️ LA COULEUR SUIT LE TAUX, PAS LA SEMAINE (2026-09-29, demande du
 * porteur : « le couleur d'anneau et le badge change selon l'état du taux ») :
 * un module fini avant la fin de la semaine reste vert même si la semaine est
 * dépassée, et un module bien avancé (≥ 50 %) reste orange plutôt que rouge.
 */
function CarteModuleTimeline({ module, courante }) {
  const taux = module.taux ?? 0;
  /* ⚠️ LES MODULES ACHEVÉS FIGURENT AUSSI DÉSORMAIS (2026-09-29, demande du
     porteur : « affiche aussi les modules achevés ») : `modulesARisque` ne
     filtre plus le taux 100 %, donc ce seuil se déclenche vraiment. Dès 95 %,
     « presque fini » — même repère que la semaine « prête » ailleurs dans ce
     tableau de bord. */
  const termine = taux >= 100;
  const presqueTermine = taux >= 95;
  const enRetard = taux < 60;
  const statut = termine ? 'Terminé' : presqueTermine ? 'Presque fini' : enRetard ? 'En retard' : 'En cours';
  const teinte = presqueTermine
    ? 'hsl(var(--success))'
    : enRetard
      ? 'hsl(var(--destructive))'
      : 'hsl(var(--warning))';
  const classesPastille = presqueTermine
    ? 'bg-success/10 text-success'
    : enRetard
      ? 'bg-destructive/10 text-destructive'
      : 'bg-warning/15 text-accent-orange-deep';

  /* ⚠️ DEUX TAUX, PAS UN (2026-09-29, demande du porteur : « le taux du
     module dans la semaine S5 doit être 100 et affiche le taux dans la
     semaine en cours 75 % ») : le pourcentage réel de LA SEMAINE EN COURS
     (heures déjà réalisées) reste affiché tel quel — c'est le seul qui existe
     avant que la semaine de fin ait eu lieu. En complément, une ligne indique
     l'objectif du chronogramme : 100 % des heures prévues D'ICI la semaine de
     fin, puisque c'est justement ce que « fin de plage » signifie. */
  const infobulle = `${nombre(module.realise ?? 0)} h réalisées / ${nombre(module.prevu ?? 0)} h prévues = ${nombre(taux)} % (S${courante ?? '?'}) — 100 % prévues d'ici S${module.fin}`;

  return (
    <Link
      to={adresseCase({ groupe: module.groupe, module: module.module, semaine: module.fin })}
      title={infobulle}
      className="block rounded-lg border bg-background px-2.5 py-2 text-xs transition-colors hover:bg-muted/40"
    >
      {/* ⚠️ `line-clamp-2`, PAS `truncate` : un titre comme « Culture et
          techniques intermédiaires du numérique » se coupait à quatre mots —
          deux lignes suffisent à le lire en entier la plupart du temps. */}
      <span className="line-clamp-2 block font-medium leading-snug">{module.intitule}</span>
      {module.estRegional && (
        <span className="mt-1 inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[0.6rem] font-medium text-primary">
          Régional
        </span>
      )}
      <span className="mt-1 block truncate text-[0.65rem] text-muted-foreground">
        {module.groupe} · {module.module}
      </span>

      <span className="mt-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <AnneauMini taux={taux} teinte={teinte} />
          <span className="shrink-0 text-[0.65rem] font-semibold tabular-nums" style={{ color: teinte }}>
            {nombre(taux)} %
          </span>
          <span className="shrink-0 text-[0.6rem] text-muted-foreground">
            {courante ? `en S${courante}` : ''} · {nombre(module.realise ?? 0)}/{nombre(module.prevu ?? 0)} h
          </span>
        </span>
        <span
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium',
            classesPastille
          )}
        >
          <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: teinte }} aria-hidden="true" />
          {statut}
        </span>
      </span>

      {/* ⚠️ L'OBJECTIF DE FIN DE PLAGE, PAS UNE MESURE : 100 % D'ICI la
          semaine de fin découle de la définition même du chronogramme (toutes
          les heures y sont dues), donc ce n'est jamais un second taux réel —
          seulement le repère qui donne son sens à la carte posée dans cette
          colonne. Inutile une fois le module réellement achevé. */}
      {!termine && (
        <span className="mt-1 block text-[0.6rem] text-muted-foreground">
          Objectif : 100 % d'ici S{module.fin}
        </span>
      )}
    </Link>
  );
}

/** Petit anneau de progression (14 px) accolé au pourcentage, à la Notion. */
function AnneauMini({ taux, teinte }) {
  const rayon = 6;
  const circonference = 2 * Math.PI * rayon;
  const parcours = Math.min(Math.max(taux, 0), 100);
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="8" cy="8" r={rayon} fill="none" strokeWidth="2.5" className="stroke-muted" />
      <circle
        cx="8"
        cy="8"
        r={rayon}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        stroke={teinte}
        strokeDasharray={circonference}
        strokeDashoffset={circonference * (1 - parcours / 100)}
      />
    </svg>
  );
}

/**
 * Les formateurs dont les heures affectées s'écartent de leur service
 * statutaire — au-delà (surcharge) ou nettement en deçà (heures disponibles).
 *
 * ⚠️ LES SOUS-CHARGÉS AUTANT QUE LES SURCHARGÉS : un formateur à 60 % de son
 * service, ce sont des heures qui peuvent absorber un retard sans recruter.
 *
 * ⚠️ « BAR CHART — NEGATIVE », PAS UNE LISTE (2026-09-29, demande du porteur,
 * capture d'un graphique en barres avec axe zéro à l'appui) : l'axe zéro est
 * le service statutaire — une barre qui monte, c'est un formateur en
 * surcharge ; une barre qui descend, ce sont des heures encore disponibles.
 */
function ServiceFormateurs({ service }) {
  const navigate = useNavigate();
  if (service.length === 0) return null;

  const donnees = service.slice(0, 8).map((formateur) => ({
    nom: formateur.nom,
    ecart: Math.round((formateur.affecte ?? 0) - (formateur.statutaire ?? 0)),
    affecte: formateur.affecte,
    statutaire: formateur.statutaire,
    surcharge: (formateur.affecte ?? 0) > (formateur.statutaire ?? 0),
    vers: formateur.vers,
  }));

  return (
    <Section
      titre="Service des formateurs"
      lien="/app/parametres/formateurs"
      libelleLien="Formateurs"
    >
      <p className="mt-0.5 text-xs text-muted-foreground">
        Écart en heures face au service statutaire de l’année — l’axe 0 est le service dû.
      </p>

      <div className="mt-3 h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={donnees} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            {/* ⚠️ LE NOM COMPLET, À PLAT (demande du porteur, 2026-09-29) : le
                seul premier mot, incliné, ne permettait pas de reconnaître le
                formateur. Deux lignes pour tenir sous une barre étroite. */}
            <XAxis
              dataKey="nom"
              tickLine={false}
              axisLine={false}
              interval={0}
              height={36}
              tick={<EtiquetteFormateur />}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(valeur) => `${valeur > 0 ? '+' : ''}${valeur}h`}
            />
            <ReferenceLine y={0} stroke="hsl(var(--border))" />
            <Tooltip cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} content={<InfoBulleService />} />
            <Bar
              dataKey="ecart"
              radius={4}
              cursor="pointer"
              onClick={(donnee) => donnee?.vers && navigate(donnee.vers)}
            >
              {donnees.map((formateur) => (
                <Cell
                  key={formateur.nom}
                  fill={formateur.surcharge ? 'hsl(var(--destructive))' : 'hsl(var(--warning))'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

/** « ABDELGHANI LAASSAL » sous sa barre : le premier mot, puis le reste dessous. */
function EtiquetteFormateur({ x, y, payload }) {
  const [premier, ...reste] = String(payload?.value ?? '').split(' ');

  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fontSize={11}
      fill="hsl(var(--muted-foreground))"
    >
      <tspan x={x} dy="0.9em">
        {premier}
      </tspan>
      {reste.length > 0 && (
        <tspan x={x} dy="1.2em">
          {reste.join(' ')}
        </tspan>
      )}
    </text>
  );
}

function InfoBulleService({ active, payload }) {
  if (!active || !payload?.length) return null;
  const formateur = payload[0].payload;

  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <p className="mb-0.5 font-medium">{formateur.nom}</p>
      <p className="text-muted-foreground">
        {nombre(formateur.affecte)} / {nombre(formateur.statutaire)} h
      </p>
      <p className={formateur.surcharge ? 'font-medium text-destructive' : 'font-medium text-warning'}>
        {formateur.surcharge
          ? `surcharge : +${nombre(formateur.ecart)} h`
          : `${nombre(-formateur.ecart)} h disponibles`}
      </p>
    </div>
  );
}

/** Une ligne de liste cliquable, qui mène à son sujet. */
const LIGNE_LIEN =
  '-mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted/40';

function Barre({ taux, couleur }) {
  return (
    <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
      <span
        className={cn('block h-full rounded-full', couleur)}
        style={{ width: `${Math.min(100, Math.max(0, taux ?? 0))}%` }}
      />
    </span>
  );
}

function Repere({ couleur, libelle, pointille }) {
  return (
    <span className="flex items-center gap-1.5">
      {pointille ? (
        <span className="block w-4 border-t-2 border-dashed" style={{ borderColor: couleur }} />
      ) : (
        <span className="block size-3 rounded-sm" style={{ background: couleur }} />
      )}
      {libelle}
    </span>
  );
}

function InfoBulle({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const valeurs = payload.filter((entree) => entree.value != null);
  if (valeurs.length === 0) return null;

  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <p className="mb-0.5 font-medium">{label}</p>
      {valeurs.map((entree) => (
        <p key={entree.dataKey} className="text-muted-foreground">
          {entree.name} :{' '}
          <span className="font-medium tabular-nums text-foreground">{nombre(entree.value)} %</span>
        </p>
      ))}
    </div>
  );
}

/* ═══ Les calculs ══════════════════════════════════════════════════════ */

/**
 * L'avancement atteint, le rythme récent, et où il mène en S39.
 *
 * ⚠️ LES SEMAINES DE VACANCES NE COMPTENT NI DANS LE RYTHME NI DANS LE RESTE À
 * FAIRE : elles n'avancent rien, et les compter ferait croire à un rythme plus
 * lent — puis à une fin d'année plus lointaine — qu'ils ne le sont.
 */
export function calculerTrajectoire(progression, courante) {
  const parNumero = new Map(progression.map((point) => [point.numero, point]));
  const actuel = parNumero.get(courante)?.avancement ?? null;
  const regionalCourant = parNumero.get(courante)?.regional ?? null;
  const ecart =
    actuel !== null && regionalCourant !== null
      ? Math.round((actuel - regionalCourant) * 10) / 10
      : null;

  const actives = (de, a) =>
    progression.filter((point) => point.numero > de && point.numero <= a && !point.vacances).length;

  let rythme = null;
  if (actuel !== null && courante >= 2) {
    const depart = Math.max(0, courante - FENETRE_RYTHME);
    const base = depart === 0 ? 0 : (parNumero.get(depart)?.avancement ?? 0);
    const semaines = actives(depart, courante);
    if (semaines > 0) rythme = Math.round(((actuel - base) / semaines) * 100) / 100;
  }

  const restantes = courante ? actives(courante, DERNIERE_SEMAINE) : 0;
  const fin =
    rythme === null ? null : Math.min(100, Math.round((actuel + rythme * restantes) * 10) / 10);
  const necessaire =
    actuel === null || restantes === 0
      ? null
      : Math.round(((100 - actuel) / restantes) * 100) / 100;

  const points = progression
    .filter((point) => point.numero <= DERNIERE_SEMAINE)
    .map((point) => ({
      libelle: point.libelle,
      avancement: courante !== null && point.numero <= courante ? point.avancement : null,
      regional: point.regional,
      projection:
        rythme !== null && point.numero >= courante
          ? Math.min(100, Math.round((actuel + rythme * actives(courante, point.numero)) * 10) / 10)
          : null,
    }));

  return { actuel, regional: regionalCourant, ecart, rythme, fin, necessaire, restantes, points };
}

/** Chaque groupe, son taux, son écart au régional et son statut. */
function statutsDesGroupes(lignes, regional) {
  const groupes = agregerAvancement(lignes, 'groupe').filter((groupe) => groupe.prevu > 0);
  if (!regional) return { total: 0, compte: {}, enRetard: [] };

  const classes = groupes.map((groupe) => {
    const ecart = Math.round(((groupe.taux ?? 0) - regional.taux) * 10) / 10;
    const statut = STATUTS.find((candidat) => ecart >= candidat.min);
    return { ...groupe, ecart, statut };
  });

  const compte = {};
  for (const groupe of classes) compte[groupe.statut.cle] = (compte[groupe.statut.cle] ?? 0) + 1;

  return {
    total: classes.length,
    compte,
    enRetard: classes
      .filter((groupe) => groupe.statut.cle === 'retard' || groupe.statut.cle === 'critique')
      .sort((a, b) => a.ecart - b.ecart),
  };
}

/**
 * Les couples (groupe, module) dont la plage prévue s'achève d'ici
 * `HORIZON_RISQUE` semaines — achevés ou non (2026-09-29, demande du
 * porteur : « affiche aussi les modules achevés » — sans eux, une colonne ne
 * montrant que des retards laisse croire qu'aucun module ne finit jamais à
 * temps). Les régionaux d'abord, puis par fin prévue.
 */
function modulesARisque(lignes, plages, courante, intitules) {
  if (!plages || courante === null) return [];

  /* ⚠️ VENTILÉ PAR GROUPE : un module n'est achevé que POUR UN GROUPE. */
  return agregerAvancement(lignes, 'module', 'groupes')
    .map((entree) => {
      const plage = plages[`${entree.ventilation}||${entree.sujet}`]?.prevue;
      return {
        cle: entree.cle,
        module: entree.sujet,
        groupe: entree.ventilation,
        intitule:
          (intitules && typeof intitules[entree.sujet] === 'string' && intitules[entree.sujet]) ||
          entree.sujet,
        estRegional: entree.estRegional,
        taux: entree.taux,
        realise: entree.realise,
        prevu: entree.prevu,
        fin: plage?.fin ?? null,
      };
    })
    .filter(
      (module) => module.groupe && module.fin !== null && module.fin <= courante + HORIZON_RISQUE,
    )
    .sort(
      (a, b) =>
        Number(b.estRegional) - Number(a.estRegional) ||
        a.fin - b.fin ||
        (a.taux ?? 0) - (b.taux ?? 0),
    );
}

/** Les formateurs hors de 80 – 100 % de leur service, les plus éloignés d'abord. */
function serviceDesFormateurs(lignes, statutaires, identites) {
  const parNom = new Map(
    (identites ?? []).map((formateur) => [normaliser(formateur.nom), formateur.identifiant]),
  );

  return agregerAvancement(lignes, 'formateur')
    .map((formateur) => {
      const statutaire = statutaires[formateur.sujet] ?? 0;
      const identifiant = parNom.get(normaliser(formateur.sujet));
      return {
        /* Son chronogramme ; introuvable, l'Avancement filtré sur lui. */
        vers: identifiant
          ? `/app/parametres/chronogramme?${new URLSearchParams({ formateur: identifiant })}`
          : `/app/avancement?${new URLSearchParams({ formateur: formateur.sujet })}`,
        nom: formateur.sujet,
        affecte: formateur.prevu,
        statutaire,
        ratio: statutaire > 0 ? Math.round((formateur.prevu / statutaire) * 100) : null,
      };
    })
    .filter(
      (formateur) => formateur.ratio !== null && (formateur.ratio < 80 || formateur.ratio > 100),
    )
    .sort((a, b) => Math.abs(b.ratio - 100) - Math.abs(a.ratio - 100));
}

/**
 * Jusqu'où l'emploi du temps est prêt : la dernière semaine d'une suite
 * ININTERROMPUE, à partir de celle en cours, qui couvre son chronogramme.
 *
 * ⚠️ ININTERROMPUE : une S9 saisie derrière une S6 vide ne rend pas la S6
 * prête — c'est la S6 qui arrivera en premier.
 */
function horizonDePlanification(completude, courante, publiee) {
  const semaines = completude?.semaines;
  if (!semaines || courante === null) return { derniere: null, vers: '/app/emploi' };

  const parNumero = new Map(semaines.map((entree) => [entree.numero, entree]));
  let derniere = null;
  for (let numero = courante; numero <= DERNIERE_SEMAINE; numero += 1) {
    const entree = parNumero.get(numero);
    if (!entree || !(entree.prevu > 0) || (entree.taux ?? 0) < SEUIL_PRETE) break;
    derniere = numero;
  }

  const avance = derniere === null ? null : derniere - courante;
  const publication =
    publiee === null
      ? null
      : publiee > courante
        ? `S${publiee} publiée`
        : `S${courante + 1} non publiée`;

  /* La première semaine qui N'EST PAS prête : c'est elle qu'il faut compléter. */
  const aCompleter = (derniere ?? courante - 1) + 1;
  const vers =
    completude.anneeScolaire && aCompleter <= DERNIERE_SEMAINE
      ? `/app/emploi?${new URLSearchParams({
          semaine: `${completude.anneeScolaire}-W${aCompleter}`,
          rapport: '1',
        })}`
      : '/app/emploi';

  return {
    derniere,
    vers,
    detail: [
      derniere === null ? `S${courante} incomplète` : `${avance} semaine(s) d’avance`,
      publication,
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

/** Les heures des absences sans rattrapage, et le délai moyen des rattrapées. */
function heuresPerdues(absences) {
  const enAttente = absences.filter((absence) => !absence.dateRattrapage);
  const rattrapees = absences.filter((absence) => absence.dateRattrapage && absence.dateAbsence);

  const delais = rattrapees
    .map(
      (absence) => (jourLocal(absence.dateRattrapage) - jourLocal(absence.dateAbsence)) / 86400000,
    )
    .filter((jours) => jours >= 0);

  return {
    absences: enAttente.length,
    heures: enAttente.reduce((somme, absence) => somme + dureeSeance(absence.seance), 0),
    delai: delais.length ? Math.round(delais.reduce((a, b) => a + b, 0) / delais.length) : null,
  };
}

/* ═══ Utilitaires ══════════════════════════════════════════════════════ */

/** « 2026-W4 » → 4. `null` si la semaine n'est pas connue. */
function numeroDeSemaine(semaine) {
  const correspondance = /-W(\d{1,3})$/.exec(String(semaine ?? ''));
  return correspondance ? Number.parseInt(correspondance[1], 10) : null;
}

/** « AAAA-MM-JJ » → Date LOCALE : `new Date('2026-09-28')` serait minuit UTC. */
function jourLocal(texte) {
  const [annee, mois, jour] = texte.split('-').map(Number);
  return new Date(annee, mois - 1, jour);
}

/** L'Avancement filtré sur ces groupes — ses modules, un par bâton. */
function avancementDesGroupes(groupes) {
  const requete = new URLSearchParams();
  for (const groupe of groupes) requete.append('groupe', groupe);
  return `/app/avancement?${requete}`;
}

const normaliser = (nom) =>
  String(nom ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();

const signe = (valeur) => `${valeur >= 0 ? '+' : ''}${nombre(valeur)}`;
