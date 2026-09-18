import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { nombre } from '@/lib/nombres';

/**
 * L'avancement de l'ÉTABLISSEMENT face au rythme régional, semaine par semaine.
 *
 * ═══ ⚠️ UN SEUL GRAPHE POUR DEUX ÉCRANS ═══
 * La page Avancement le montre sur l'année entière ; l'accueil le montre ZOOMÉ
 * sur la semaine en cours. Ce sont deux cadrages du MÊME tracé — en écrire deux
 * versions, c'est la garantie qu'elles divergeront au premier ajustement de
 * couleur ou de règle (§4.2 du plan).
 *
 * ⚠️ LA COURBE N'EST JAMAIS FILTRÉE : elle porte sur tout l'établissement, et se
 * lit TOUJOURS dans les séances posées — y compris sur la face e-note, dont le
 * fichier ne contient aucun historique par semaine. Le rythme régional, lui, ne
 * connaît ni filière ni formateur : le comparer à une sélection confronterait
 * deux périmètres différents.
 */

/* Le bleu clair des vacances, celui du calendrier et des grilles. */
export const COULEUR_VACANCES = 'hsl(var(--primary) / 0.10)';

export const COULEURS_PROGRESSION = {
  avancement: 'hsl(var(--accent-orange))',
  regional: 'hsl(var(--accent-sky))',
};

/**
 * @param {object} options
 * @param {Array} options.progression — un point par semaine, de la S1 à la S39
 * @param {object} options.courante — le point de la semaine en cours
 * @param {number} [options.fenetre] — nombre de semaines à montrer autour de la
 *   semaine en cours. Omis, l'année entière est tracée.
 * @param {number} [options.hauteur]
 */
export default function GrapheProgression({
  progression,
  courante,
  fenetre,
  hauteur = 200,
  /*
   * ⚠️ LE REPÈRE NE DIT « AUJOURD'HUI » QUE S'IL L'EST. Rembobiné en S20, il
   * l'annonçait quand même — le graphe affirmait donc que la semaine en cours
   * était celle qu'on venait de choisir.
   */
  estAujourdhui = true,
}) {
  const points = fenetre ? cadrer(progression, courante, fenetre) : progression;

  /*
   * ═══ ⚠️ ZOOMER, C'EST AUSSI RESSERRER L'AXE DES TAUX ═══
   * Sur une fenêtre de début d'année, les deux séries valent quelques
   * pourcents : gardées sur une échelle de 0 à 100, elles se confondraient avec
   * l'axe et le « zoom » ne montrerait rien de plus que la vue d'ensemble. On
   * borne donc à ce que la fenêtre contient, avec une marge — et jamais
   * au-delà de 100, qui reste le plafond d'un taux.
   */
  const plafond = fenetre ? plafondDe(points) : 100;

  /*
   * ═══ ⚠️ LES SEMAINES DE VACANCES SONT MARQUÉES ═══ (demande du porteur,
   * 2026-09-01.) Sans elles, un palier de la courbe orange se lit comme un
   * ARRÊT — alors que l'établissement était fermé. Et le rythme régional, lui,
   * ne monte pas non plus ces semaines-là : les deux plats s'expliquent d'un
   * coup dès qu'on voit la bande.
   *
   * ⚠️ CE SONT LES SEMAINES QUE LE TAUX RÉGIONAL ÉCARTE, pas un second calcul :
   * le drapeau vient de `semainesDeVacances`, la fonction dont `tauxRegional`
   * se sert lui-même.
   */
  const plages = plagesDeVacances(points);

  const bornes = [points[0]?.numero ?? 1, points[points.length - 1]?.numero ?? 1];
  /*
   * ⚠️ TOUTES LES SEMAINES QUAND ON EST ZOOMÉ, une sur quatre sinon :
   * trente-neuf étiquettes se chevaucheraient, alors qu'une dizaine tiennent —
   * et c'est précisément pour les lire une à une qu'on zoome.
   */
  const graduations = points
    .filter((_, rang) => (fenetre ? true : rang % 4 === 0))
    .map((point) => point.numero);

  return (
    <ResponsiveContainer width="100%" height={hauteur}>
      <AreaChart data={points} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        {/*
          ⚠️ DES DÉGRADÉS, comme le modèle : une nappe opaque cacherait celle du
          dessous, et c'est justement leur recouvrement qui porte l'écart.

          ⚠️ DES IDENTIFIANTS UNIQUES : deux graphes sur la même page
          partageraient sinon leurs `<linearGradient>`, et le second effacerait
          les couleurs du premier. Le cas se présente dès que l'accueil et un
          autre bloc coexistent.
        */}
        <defs>
          <linearGradient id={`nappeAvancement-${fenetre ?? 'annee'}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={COULEURS_PROGRESSION.avancement} stopOpacity={0.5} />
            <stop offset="95%" stopColor={COULEURS_PROGRESSION.avancement} stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id={`nappeRythme-${fenetre ?? 'annee'}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={COULEURS_PROGRESSION.regional} stopOpacity={0.4} />
            <stop offset="95%" stopColor={COULEURS_PROGRESSION.regional} stopOpacity={0.04} />
          </linearGradient>
        </defs>

        {/*
          ⚠️ DÉCLARÉES AVANT LES NAPPES, DONC DESSOUS : recharts empile dans
          l'ordre du JSX, et une bande posée après masquerait les courbes.
        */}
        {plages.map((plage) => (
          <ReferenceArea
            key={plage.debut}
            /* ⚠️ ± 0,5 : une semaine occupe l'intervalle entre deux demi-crans,
               sans quoi la bande s'arrêterait au centre de la graduation. */
            x1={plage.debut - 0.5}
            x2={plage.fin + 0.5}
            fill={COULEUR_VACANCES}
            fillOpacity={1}
            stroke="none"
            /* La bande ne doit pas ÉLARGIR le domaine : hors de la fenêtre, elle
               se coupe au bord plutôt que de décaler l'axe d'une demi-semaine. */
            ifOverflow="hidden"
            /*
             * ⚠️ « VAC », LE MOT DU CHRONOGRAMME (demande du porteur,
             * 2026-09-01) : c'est le badge que ses en-têtes de semaine portent
             * déjà. Un aplat bleu se devine, il ne se lit pas — et sur une bande
             * de 27 px, trois lettres sont tout ce qui tient.
             *
             * ⚠️ EN HAUT DE LA BANDE : au milieu, il passerait sous les nappes
             * dès que les courbes montent.
             */
            label={{
              value: 'VAC',
              position: 'insideTop',
              fill: 'hsl(var(--primary))',
              fontSize: 9,
              fontWeight: 600,
            }}
          />
        ))}

        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
        {/*
          ═══ ⚠️ UN AXE NUMÉRIQUE, ET C'EST LA BANDE DE VACANCES QUI L'IMPOSE ═══
          Sur un axe de CATÉGORIES, `ReferenceArea` va d'un centre de bande à
          l'autre : une semaine isolée — `x1 === x2` — ne dessine RIEN. Mesuré
          sur les données réelles, où l'unique semaine de vacances (S15) ne
          produisait aucun rectangle. En numérique, `S15 ± 0,5` couvre la semaine
          entière, quelle que soit la longueur de la période.

          ⚠️ LES GRADUATIONS SONT DONNÉES EXPLICITEMENT : `interval` ne s'applique
          plus, et sans `ticks` recharts choisirait des valeurs rondes (0, 10,
          20…) qui ne sont pas des semaines.
        */}
        <XAxis
          dataKey="numero"
          type="number"
          domain={bornes}
          ticks={graduations}
          tickFormatter={(numero) => `S${numero}`}
          tickLine={false}
          axisLine={{ stroke: 'hsl(var(--border))' }}
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
        />
        <YAxis
          type="number"
          domain={[0, plafond]}
          width={44}
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={false}
          unit=" %"
        />
        <Tooltip
          cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3' }}
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: '1px solid hsl(var(--border))',
            background: 'hsl(var(--card))',
          }}
          formatter={(valeur, cle) => [
            `${nombre(valeur)} %`,
            cle === 'regional' ? 'Rythme régional' : 'Avancement',
          ]}
          labelFormatter={(numero) => `Semaine ${numero}`}
        />

        {/*
          ⚠️ LA RÉFÉRENCE SE DESSINE EN PREMIER, DONC DESSOUS : tracée après, sa
          nappe masquerait le retard — précisément ce qu'on vient voir.
        */}
        <Area
          type="monotone"
          dataKey="regional"
          stroke={COULEURS_PROGRESSION.regional}
          strokeWidth={2}
          fill={`url(#nappeRythme-${fenetre ?? 'annee'})`}
          /* Sans animation : Chrome gèle les trames d'une page qui ne compose
             pas, et les nappes resteraient plates. */
          isAnimationActive={false}
          dot={false}
          activeDot={{ r: 3 }}
        />
        <Area
          type="monotone"
          dataKey="avancement"
          stroke={COULEURS_PROGRESSION.avancement}
          strokeWidth={2}
          fill={`url(#nappeAvancement-${fenetre ?? 'annee'})`}
          isAnimationActive={false}
          /*
           * ⚠️ AUCUN POINT AU REPOS, ET LE MÊME COMPORTEMENT SUR LES DEUX ÉCRANS
           * (correction du porteur, 2026-09-01). J'avais posé `dot={{ r: 2 }}`
           * sur la seule vue zoomée : la courbe s'y couvrait de pastilles que la
           * page Avancement n'a jamais eues — deux cadrages du même tracé ne
           * peuvent pas se lire différemment. Le point ne sert qu'à désigner ce
           * que l'infobulle est en train de dire ; `activeDot` le fait
           * apparaître au survol, et lui seul.
           *
           * ⚠️ `activeDot` EST ÉCRIT, pas laissé au défaut de recharts : c'est
           * LUI le comportement demandé — un point qui ne paraît qu'au survol.
           * Implicite, il se perdrait au premier réglage des séries sans que
           * rien ne le signale.
           */
          dot={false}
          activeDot={{ r: 3 }}
        />

        {/*
          ═══ ⚠️ OÙ L'ON EN EST DANS L'ANNÉE ═══
          Rien d'autre ne dit quelle portion des nappes est déjà vécue et
          laquelle reste à faire.

          ⚠️ DÉCLARÉ APRÈS LES NAPPES : recharts empile dans l'ordre du JSX, et
          posé avant, le repère passerait DERRIÈRE elles — invisible sur toute la
          partie remplie.
        */}
        {courante && (
          <ReferenceLine
            /* ⚠️ LE NUMÉRO, plus le libellé : l’axe est numérique depuis que la
               bande de vacances l’exige. */
            x={courante.numero}
            stroke="hsl(var(--foreground))"
            strokeOpacity={0.45}
            strokeDasharray="4 4"
            label={{
              value: estAujourdhui ? `${courante.libelle} · aujourd’hui` : courante.libelle,
              position: 'insideTopLeft',
              fill: 'hsl(var(--muted-foreground))',
              fontSize: 10,
            }}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * La tranche de semaines à montrer autour de celle en cours.
 *
 * ⚠️ ELLE GARDE SA LARGEUR AUX BORDS DE L'ANNÉE. Un simple « n semaines de part
 * et d'autre » donnerait une demi-fenêtre en S1 comme en S39 — c'est-à-dire
 * précisément à la rentrée, le moment où l'on regarde cet écran le plus souvent.
 * On décale la fenêtre au lieu de la rogner.
 */
export function cadrer(progression = [], courante, fenetre) {
  if (progression.length <= fenetre) return progression;

  const index = courante ? progression.indexOf(courante) : -1;
  if (index === -1) return progression.slice(0, fenetre);

  const debut = Math.min(
    Math.max(0, index - Math.floor(fenetre / 2)),
    progression.length - fenetre
  );
  return progression.slice(debut, debut + fenetre);
}

/**
 * Le plafond de l'axe des taux sur une fenêtre.
 *
 * ⚠️ UN PLANCHER À 5 % : au tout début de l'année les deux séries valent des
 * dixièmes, et un axe calé sur elles donnerait une graduation illisible
 * (« 0,1 % · 0,2 % »). ⚠️ ET UN PLAFOND À 100 : un taux ne va pas au-delà, et
 * laisser l'échelle monter ferait croire à un objectif plus lointain.
 */
/**
 * Les plages CONTIGUËS de vacances, en libellés de semaine.
 *
 * ⚠️ CONTIGUËS, ET NON UNE BANDE PAR SEMAINE : deux vacances qui se suivent
 * donneraient deux rectangles séparés par un filet, qu'on lirait comme deux
 * périodes distinctes.
 */
function plagesDeVacances(points = []) {
  const plages = [];

  for (const point of points) {
    if (!point.vacances) continue;

    const derniere = plages[plages.length - 1];
    if (derniere && derniere.fin === point.numero - 1) derniere.fin = point.numero;
    else plages.push({ debut: point.numero, fin: point.numero });
  }

  return plages;
}

function plafondDe(points = []) {
  const valeurs = points.flatMap((point) =>
    [point.avancement, point.regional].filter((valeur) => typeof valeur === 'number')
  );
  if (valeurs.length === 0) return 100;

  const maximum = Math.max(...valeurs);
  return Math.min(100, Math.max(5, Math.ceil((maximum * 1.15) / 5) * 5));
}
