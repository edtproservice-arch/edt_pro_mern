import { useMemo, useState } from 'react';
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import { TrendingUp } from 'lucide-react';
import PanneauFiltres from '@/features/avancement/PanneauFiltres';
import { nombre } from '@/lib/nombres';

/**
 * ═══ OÙ LES STAGIAIRES S'ABSENTENT ═══ (2026-10-23, demande du porteur :
 * « sous forme de graphe chaque groupe ou les formateurs (module) pour voir
 * exactement où les stagiaires s'absentent »).
 *
 * ⚠️ EN RADAR À POINTS (2026-10-23, « sous forme de radar chart — dots, par
 * rapport au module × formateur × groupe, filtré par groupe, formateur comme
 * le filtre en avancement ») : un axe par MODULE, la distance au centre est le
 * nombre de séances manquées. Le groupe et le formateur se choisissent dans le
 * MÊME panneau « Filtrer » que la page Avancement (un seul à la fois chacun,
 * rien de coché = tout).
 *
 * ⚠️ DEUX RADARS, LE MÊME FILTRE (2026-10-23, « deux radars, un par module et
 * un par formateur ») : l'un pose un axe par MODULE, l'autre un axe par
 * FORMATEUR ; le panneau « Filtrer » les restreint tous les deux.
 *
 * ⚠️ TOUS LES MODULES, MÊME SANS ABSENCE (2026-10-23, demande du porteur) :
 * les axes viennent des AFFECTATIONS de la base (`modulesAffectes`) qui
 * répondent au filtre, plus tout module où une absence a été marquée — un
 * module sans absence garde son axe, son point au centre.
 *
 * Source : `repartitionAbsences` du tableau de bord (groupe × module ×
 * formateur de la séance manquée) et `modulesAffectes`. Retards exclus.
 */
export default function RepartitionAbsences({ repartition, affectations = [], effectifs = [] }) {
  /*
   * ⚠️ FILTRÉ D'EMBLÉE SUR LE GROUPE LE PLUS ABSENT (2026-10-24, demande du
   * porteur) : `null` tant qu'on n'a rien touché — c'est alors ce groupe-là.
   * Dès le premier choix, y compris « Effacer le filtre », le choix fait foi.
   */
  const [filtresChoisis, setFiltres] = useState(null);
  const groupeLePlusAbsent = useMemo(() => {
    const parGroupe = new Map();
    for (const ligne of repartition) {
      if (ligne.groupe) parGroupe.set(ligne.groupe, (parGroupe.get(ligne.groupe) ?? 0) + ligne.n);
    }
    return [...parGroupe].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))[0]?.[0] ?? null;
  }, [repartition]);
  const filtres = useMemo(
    () => filtresChoisis ?? { groupe: groupeLePlusAbsent ? [groupeLePlusAbsent] : [], formateur: [] },
    [filtresChoisis, groupeLePlusAbsent]
  );

  const retenues = useMemo(
    () => repartition.filter((ligne) => correspond(ligne, filtres)),
    [repartition, filtres]
  );

  /*
   * ⚠️ CHAQUE FACETTE NE PROPOSE QUE CE QUE L'AUTRE LAISSE : un formateur
   * choisi, la liste des groupes se réduit aux siens — sinon on choisirait un
   * groupe pour obtenir un radar vide. La valeur déjà retenue reste proposée,
   * pour qu'on puisse la décocher.
   */
  const facettes = useMemo(() => {
    const valeurs = (cle) => {
      const ensemble = new Set(
        [...repartition, ...affectations]
          .filter((ligne) => correspond(ligne, { ...filtres, [cle]: [] }))
          .map((ligne) => ligne[cle] || SANS[cle])
      );
      for (const choisie of filtres[cle]) ensemble.add(choisie);
      return [...ensemble].sort((a, b) => a.localeCompare(b, 'fr'));
    };
    return { groupe: valeurs('groupe'), formateur: valeurs('formateur') };
  }, [repartition, affectations, filtres]);

  const nuanceGroupe = useMemo(() => nuancesParTaux(repartition, effectifs), [repartition, effectifs]);

  const { parModule, parFormateur, total, nonJustifiees } = useMemo(() => {
    const affectees = affectations.filter((ligne) => correspond(ligne, filtres));
    return {
      parModule: parAxe(retenues, affectees, 'module'),
      parFormateur: parAxe(retenues, affectees, 'formateur'),
      total: retenues.reduce((somme, ligne) => somme + ligne.n, 0),
      nonJustifiees: retenues.reduce((somme, ligne) => somme + ligne.nonJustifiees, 0),
    };
  }, [retenues, affectations, filtres]);

  if (repartition.length === 0 && affectations.length === 0) return null;

  const portee = [filtres.groupe[0], filtres.formateur[0]].filter(Boolean).join(' · ') || 'Tous les groupes et formateurs';

  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-sm font-medium">Où les stagiaires s’absentent</h2>
          <p className="text-xs text-muted-foreground">Séances manquées · {portee}</p>
        </div>
        <PanneauFiltres
          facettes={facettes}
          filtres={filtres}
          onChange={setFiltres}
          nuances={{ groupe: nuanceGroupe }}
          legende={<LegendeTaux />}
        />
      </div>

      <div className="mt-2 grid gap-4 lg:grid-cols-2">
        <RadarAbsences titre="Par module" axes={parModule} cle="module" />
        <RadarAbsences titre="Par formateur" axes={parFormateur} cle="formateur" />
      </div>

      <p className="mt-2 text-center text-xs text-muted-foreground">
        {nombre(total)} absence(s), dont {nombre(nonJustifiees)} non justifiée(s) · retards exclus
      </p>
    </section>
  );
}

const LIBELLES = {
  module: { un: 'Module le plus touché', plusieurs: 'Modules les plus touchés', aucun: 'module' },
  formateur: { un: 'Formateur le plus touché', plusieurs: 'Formateurs les plus touchés', aucun: 'formateur' },
};

/** Un radar à points : un axe par module ou par formateur, la distance = séances manquées. */
function RadarAbsences({ titre, axes, cle }) {
  const libelles = LIBELLES[cle];
  if (axes.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Aucun {libelles.aucun} pour ce filtre.
      </div>
    );
  }

  /* ⚠️ BEAUCOUP D'AXES, PEU DE PLACE : au-delà de 24 (tout l'établissement,
     sans filtre), seuls ceux qui portent des absences gardent leur libellé —
     les autres restent des rayons muets, au centre. */
  const libellesReduits = axes.length > 24;

  // Les ex aequo sont tous nommés : en citer un seul laisserait croire qu'il se détache.
  const maximum = Math.max(0, ...axes.map((axe) => axe.total));
  const plusTouches = axes.filter((axe) => axe.total === maximum).map((axe) => axe.nom);

  return (
    <div className="rounded-md border p-3">
      <p className="text-xs font-medium text-muted-foreground">
        {titre} · {nombre(axes.length)} {libelles.aucun}(s)
      </p>
      <div className="mx-auto h-80 max-w-xl">
        <ResponsiveContainer width="100%" height="100%">
          {/* Les noms de formateurs, plus longs que les codes de module, ont besoin de marge autour du cercle. */}
          <RadarChart data={axes} outerRadius={cle === 'formateur' ? '56%' : '68%'}>
            <PolarGrid stroke="hsl(var(--border))" />
            <PolarAngleAxis
              dataKey="nom"
              tickFormatter={(nom, index) => (libellesReduits && !axes[index]?.total ? '' : nom)}
              tick={{ fontSize: axes.length > 16 || cle === 'formateur' ? 9 : 11, fill: 'hsl(var(--muted-foreground))' }}
            />
            <Tooltip content={<Infobulle cle={cle} />} />
            <Radar
              dataKey="total"
              name="Séances manquées"
              stroke="hsl(var(--destructive))"
              fill="hsl(var(--destructive))"
              fillOpacity={0.35}
              dot={{ r: 4, fillOpacity: 1 }}
              isAnimationActive={false}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      {maximum > 0 ? (
        <p className="flex items-center justify-center gap-1.5 text-center text-sm font-medium">
          {plusTouches.length > 1 ? libelles.plusieurs : libelles.un} : {plusTouches.join(', ')} —{' '}
          {nombre(maximum)} séance(s)
          <TrendingUp className="size-4 shrink-0" />
        </p>
      ) : (
        <p className="text-center text-sm font-medium">Aucune absence</p>
      )}
    </div>
  );
}

const SANS = { groupe: 'Sans groupe', formateur: 'Sans formateur' };

/*
 * ═══ LA COULEUR DU TAUX D'ABSENCE DE CHAQUE GROUPE ═══ (2026-10-24, demande du
 * porteur : « les badges groupes avec une couleur qui désigne leur taux
 * d'absence pour faciliter le filtre »).
 *
 * ⚠️ LE TAUX EST PAR STAGIAIRE : séances manquées de l'année ÷ effectif. Le
 * total brut ferait toujours passer un gros groupe pour le plus absent.
 *
 * ⚠️ RELATIF AU GROUPE LE PLUS ABSENT, en trois paliers : il n'existe pas de
 * seuil réglementaire, et un seuil fixe virerait tout au vert en octobre et
 * tout au rouge en juin. Un groupe sans effectif connu reste neutre.
 */
const PALIERS = [
  { jusqua: 1 / 3, libelle: 'Faible', classe: 'border-success/50 bg-success/10 text-success hover:bg-success/20', pastille: 'bg-success' },
  { jusqua: 2 / 3, libelle: 'Moyen', classe: 'border-warning/60 bg-warning/15 text-warning hover:bg-warning/25', pastille: 'bg-warning' },
  { jusqua: Infinity, libelle: 'Élevé', classe: 'border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20', pastille: 'bg-destructive' },
];

function nuancesParTaux(repartition, effectifs) {
  const effectifDe = new Map(effectifs.map(({ groupe, effectif }) => [String(groupe).toUpperCase(), effectif]));
  const manquees = new Map();
  for (const ligne of repartition) {
    const cle = String(ligne.groupe).toUpperCase();
    manquees.set(cle, (manquees.get(cle) ?? 0) + ligne.n);
  }
  const taux = new Map();
  for (const [cle, effectif] of effectifDe) {
    if (effectif > 0) taux.set(cle, (manquees.get(cle) ?? 0) / effectif);
  }
  const maximum = Math.max(0, ...taux.values());

  return (groupe) => {
    const cle = String(groupe).toUpperCase();
    if (!taux.has(cle)) return null;
    const valeur = taux.get(cle);
    const palier = PALIERS.find((p) => (maximum > 0 ? valeur / maximum : 0) <= p.jusqua);
    const effectif = effectifDe.get(cle);
    return {
      classe: palier.classe,
      titre: `${palier.libelle} — ${nombre(manquees.get(cle) ?? 0)} séance(s) manquée(s) pour ${nombre(effectif)} stagiaire(s), soit ${valeur.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} par stagiaire`,
    };
  };
}

function LegendeTaux() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.65rem] text-muted-foreground">
      <span>Taux d’absence du groupe (séances manquées par stagiaire, comparé au plus absent) :</span>
      {PALIERS.map((palier) => (
        <span key={palier.libelle} className="flex items-center gap-1">
          <span className={`size-2 rounded-full ${palier.pastille}`} />
          {palier.libelle}
        </span>
      ))}
    </p>
  );
}

/** « Rien de coché = tout », un seul choix par facette — la grammaire du filtre d'Avancement. */
function correspond(ligne, filtres) {
  return ['groupe', 'formateur'].every(
    (cle) => filtres[cle].length === 0 || filtres[cle].includes(ligne[cle] || SANS[cle])
  );
}

/**
 * Un axe par module (ou par formateur) affecté au filtre — à zéro sans
 * absence —, avec les absences retenues qui s'y rapportent.
 */
function parAxe(lignes, affectations, cle) {
  const axes = new Map();
  const axeDe = (ligne) => {
    const nom = ligne[cle] || (cle === 'module' ? 'Sans module' : SANS.formateur);
    if (!axes.has(nom)) axes.set(nom, { nom, intitules: new Set(), total: 0, nonJustifiees: 0, sources: [] });
    const axe = axes.get(nom);
    if (cle === 'module' && ligne.intitule) axe.intitules.add(ligne.intitule);
    return axe;
  };

  for (const affectation of affectations) axeDe(affectation);
  for (const ligne of lignes) {
    const axe = axeDe(ligne);
    axe.total += ligne.n;
    axe.nonJustifiees += ligne.nonJustifiees;
    axe.sources.push(ligne);
  }

  // ⚠️ L'ORDRE AUTOUR DU CERCLE est alphabétique : trié par total, le radar ne serait qu'une spirale.
  return [...axes.values()]
    .map((axe) => ({ ...axe, intitules: [...axe.intitules] }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

/** Au-delà, l'info-bulle déborderait de l'écran : le reste est compté, pas nommé. */
const STAGIAIRES_MAX = 12;

/**
 * Le détail d'un point (2026-10-23, demande du porteur : « affiche le nom
 * complet du module et la liste des stagiaires ») : le module et son intitulé
 * — ou le formateur —, puis, par groupe et formateur (ou groupe et module),
 * les stagiaires qui ont manqué.
 *
 * ⚠️ PLUSIEURS INTITULÉS POUR UN CODE : sans filtre, un même code peut réunir
 * des filières où il ne désigne pas le même module — on les cite tous.
 */
function Infobulle({ active, payload, cle }) {
  if (!active || !payload?.length) return null;
  const axe = payload[0].payload;
  return (
    <div className="max-w-sm rounded-md border bg-background px-3 py-2 text-xs shadow-md">
      <p className="font-medium">
        {axe.nom}
        {axe.intitules.length > 0 && <span className="font-normal"> — {axe.intitules.join(' / ')}</span>}
      </p>
      <p className="text-muted-foreground">
        {axe.total === 0
          ? 'Aucune absence'
          : `${nombre(axe.total)} séance(s), dont ${nombre(axe.nonJustifiees)} non justifiée(s)`}
      </p>
      {axe.sources
        .slice()
        .sort((a, b) => b.n - a.n)
        .map((source) => (
          <div key={`${source.groupe}||${source.module}||${source.formateur}`} className="mt-1.5">
            {/* Sous un module : le groupe et son formateur ; sous un formateur : le groupe et le module. */}
            <p className="font-medium">
              {source.groupe || SANS.groupe} ·{' '}
              {cle === 'module'
                ? source.formateur || SANS.formateur
                : `${source.module || 'sans module'}${source.intitule ? ` — ${source.intitule}` : ''}`}{' '}
              : {nombre(source.n)}
            </p>
            <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
              {(source.stagiaires ?? []).slice(0, STAGIAIRES_MAX).map((stagiaire) => (
                <li key={stagiaire.matricule} className="flex justify-between gap-3">
                  <span className="truncate">{stagiaire.nom}</span>
                  <span className="shrink-0 tabular-nums">
                    {nombre(stagiaire.n)} séance(s)
                    {stagiaire.nonJustifiees < stagiaire.n && ` · ${nombre(stagiaire.n - stagiaire.nonJustifiees)} justifiée(s)`}
                  </span>
                </li>
              ))}
              {(source.stagiaires?.length ?? 0) > STAGIAIRES_MAX && (
                <li>et {nombre(source.stagiaires.length - STAGIAIRES_MAX)} autre(s)</li>
              )}
            </ul>
          </div>
        ))}
    </div>
  );
}
