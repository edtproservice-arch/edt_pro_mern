import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { nombre } from '@/lib/nombres';
import { decouper, interligne, tailleCommune } from './etiquettes';

/**
 * Un axe d'avancement, en barres empilées.
 * ← `renderAvancementChart()` d'avancement.html (l. 4613-4617)
 *
 * ═══ ⚠️ DEUX PILES CÔTE À CÔTE, PAS UNE ═══
 * L'existant traçait `stack1` = MH AFFECTÉE et `stack2` = MH RÉALISÉE, chacune
 * partagée entre présentiel et synchrone. C'est ce qui fait tout l'intérêt du
 * graphique : une pile de réalisé toute seule ne dit pas s'il en reste trois
 * heures ou trois cents. On garde donc les deux, l'affectée en teinte pleine et
 * la réalisée en teinte claire — le rapport des deux longueurs EST le taux, lu
 * d'un coup d'œil sur cinquante lignes.
 *
 * ═══ ⚠️ VERT PRÉSENTIEL, VIOLET DISTANCIEL ═══
 * Ce sont les couleurs que l'application emploie DÉJÀ partout : vert pour une
 * séance en salle, violet pour une séance à distance — dans la grille, dans le
 * chronogramme, sur les onglets de la carte d'affectations. L'existant mettait
 * du bleu au synchrone ; le reprendre ici aurait fait mentir toutes les autres
 * pages. (Le bleu structurel est réservé, cf. `DESIGN_SYSTEM.md`.)
 *
 * ═══ ⚠️ DEUX COURBES SUR UN SECOND AXE, EN % ═══
 * ← `datasets.push({ type: 'line', … yAxisID: 'y_percent' })` de l'existant.
 * Elles ne s'affichent QUE sur les axes formateur et groupe, comme lui
 * (`display: type !== 'module'`) : sur l'axe module, chaque colonne est déjà un
 * module, et une courbe qui relie cinquante-quatre modules sans ordre entre eux
 * ne décrit aucune évolution — elle ferait un zigzag qu'on lirait à tort comme
 * une tendance.
 *
 * ⚠️ LE TAUX OBJECTIF PÉDAGOGIQUE est réservé à l'axe GROUPE, et c'est ce qui
 * donne son sens au reste : il dit où le groupe DEVRAIT en être au vu du
 * calendrier — jours ouvrés écoulés, stages du groupe retirés. Un taux de 40 %
 * ne veut rien dire seul ; comparé à cette ligne, il dit avance ou retard.
 * Il n'a pas d'équivalent par formateur : une personne n'a pas de calendrier de
 * formation à elle.
 */

/*
 * ⚠️ LES COULEURS PASSENT PAR `hsl(var(--…))`, PAS PAR UNE CLASSE TAILWIND :
 * recharts écrit un attribut SVG `fill`, qui ne comprend pas les classes. Les
 * variables, elles, se résolvent dans le navigateur — et le graphique suit donc
 * le thème sans qu'on ait à le recalculer.
 */
const SERIES = [
  { cle: 'prevuPresentiel', pile: 'prevu', couleur: 'hsl(var(--accent-green))', libelle: 'Affecté présentiel' },
  { cle: 'prevuSynchrone', pile: 'prevu', couleur: 'hsl(var(--accent-purple-mid))', libelle: 'Affecté distanciel' },
  { cle: 'realisePresentiel', pile: 'realise', couleur: 'hsl(var(--accent-green) / 0.4)', libelle: 'Réalisé présentiel' },
  { cle: 'realiseSynchrone', pile: 'realise', couleur: 'hsl(var(--accent-purple-mid) / 0.4)', libelle: 'Réalisé distanciel' },
];

const LIBELLES = Object.fromEntries(SERIES.map((s) => [s.cle, s.libelle]));

/**
 * Comment NOMMER le complément, selon l'axe — dans l'infobulle seulement.
 *
 * ⚠️ SOUS L'AXE, IL N'EST PAS INTRODUIT : la place y manque, et deux noms de
 * formateurs sous un code de module se comprennent sans qu'on les annonce.
 */
const LIBELLE_COMPLEMENT = {
  formateurs: 'Formateur(s)',
  groupes: 'Groupe(s)',
  modules: 'Module(s)',
};

/** Le même mot, au pluriel, pour le compte de repli : « 13 groupes ». */
const PLURIEL_COMPLEMENT = { formateurs: 'formateurs', groupes: 'groupes', modules: 'modules' };

/** « A » ne se lit pas : c'est le badge de la grille, pas un mot. */
const SEMESTRE_LU = { S1: 'Semestre 1', S2: 'Semestre 2', A: 'Annuel' };

export default function GrapheAvancement({
  lignes,
  entete,
  axe,
  /**
   * La dimension que les bâtons portent — décidée par `dimensionComplement`,
   * donc dépendante des filtres actifs. `null` : il ne reste rien à nommer.
   */
  complement = null,
  objectifs = {},
  intitules = {},
  reference = null,
}) {
  /*
   * ⚠️ LES SUJETS SANS AUCUNE MASSE SORTENT DU GRAPHIQUE, mais restent NOMMÉS
   * dessous. Une barre plate n'apprend rien et écrase l'échelle des autres ;
   * les taire, en revanche, laisserait croire qu'ils n'existent pas — c'est la
   * règle déjà tenue par le panneau de statistiques de l'emploi du temps.
   */
  /*
   * ⚠️ L'OBJECTIF EST ATTACHÉ À LA LIGNE, pas lu dans le rendu : recharts a
   * besoin d'une clé de données, et une fonction de recherche par sujet serait
   * rappelée pour chaque point à chaque rendu.
   */
  const avecObjectif = lignes.map((ligne) => ({
    ...ligne,
    objectif: objectifs[ligne.sujet] ?? null,
    /*
     * ⚠️ LA RÉFÉRENCE EST EN HEURES, PAS EN POURCENTAGES — c'est un PLAFOND à
     * comparer aux barres : la masse statutaire dit ce qu'un formateur doit
     * assurer dans l'année, la masse globale ce que le programme d'un groupe
     * prévoit. Sur l'axe des taux, elle serait incomparable à ce qu'elle borne.
     */
    reference: reference?.valeurs?.[ligne.sujet] ?? null,
    /*
     * ⚠️ L'ÉTIQUETTE SE CALCULE ICI, UNE FOIS : elle sert à DEUX endroits — la
     * forme qui la dessine, et le calcul de la place à réserver en haut. Deux
     * calculs finiraient par diverger d'un caractère, et le texte déborderait
     * du tracé sans que rien ne le signale.
     */
    etiquette: complement
      ? resumerComplements(ligne.complements, PLURIEL_COMPLEMENT[complement])
      : null,
  }));

  const brutes = avecObjectif.filter((ligne) => ligne.prevu > 0 || ligne.realise > 0);
  const sansMasse = lignes.filter((ligne) => ligne.prevu === 0 && ligne.realise === 0);

  /*
   * ═══ ⚠️ UNE SEULE TAILLE POUR TOUTE LA RANGÉE ═══ (cf. `etiquettes.js`.)
   * Calculée sujet par sujet, elle donnerait « M101 » en 10 px à côté
   * d'« ABDELGHANI LAASAL » en 7 px : une rangée de libellés de tailles
   * différentes se lit comme un défaut d'affichage, pas comme un ajustement.
   *
   * ⚠️ ET DEUX TAILLES DISTINCTES, une par étage : les libellés d'axe et les
   * étiquettes de bâton ne portent pas les mêmes mots. Les lier ferait rétrécir
   * l'axe à cause d'un nom de groupe, ou l'inverse.
   */
  const tailleAxe = tailleCommune(
    brutes.map((ligne) => ligne.sujet),
    { largeur: LARGEUR_TEXTE, lignesMax: LIGNES_AXE }
  );

  const tailleEtiquette = tailleCommune(
    brutes.map((ligne) => ligne.etiquette),
    { largeur: LARGEUR_TEXTE, lignesMax: LIGNES_ETIQUETTE }
  );

  /*
   * ⚠️ LES LIGNES SE DÉCOUPENT UNE FOIS, à la taille retenue : la forme qui les
   * dessine et le calcul de la place à réserver en haut doivent voir EXACTEMENT
   * le même découpage — sinon le texte déborde du tracé sans rien signaler.
   */
  const traces = brutes.map((ligne) => ({
    ...ligne,
    etiquetteLignes: ligne.etiquette
      ? decouper(ligne.etiquette, {
          largeur: LARGEUR_TEXTE,
          taille: tailleEtiquette,
          lignesMax: LIGNES_ETIQUETTE,
        })
      : [],
  }));

  const margeHaute = margeDesEtiquettes(traces, tailleEtiquette);

  // Les courbes ne valent que là où les sujets se comparent — cf. en-tête.
  const courbeTaux = axe === 'formateur' || axe === 'groupe';
  const courbeObjectif = axe === 'groupe' && traces.some((ligne) => ligne.objectif !== null);
  const courbeReference = Boolean(reference) && traces.some((ligne) => ligne.reference !== null);

  if (traces.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Aucune masse à représenter sur cet axe.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/*
        ⚠️ LE GRAPHIQUE DÉFILE, LA PAGE NON. En colonnes, chaque sujet réclame sa
        largeur : à cinquante-quatre modules répartis sur la largeur de l'écran,
        les barres tombent sous deux pixels et les libellés se chevauchent. On
        réserve donc une largeur MINIMALE par sujet et on laisse le bloc défiler
        — la règle déjà tenue pour les tableaux larges.
      */}
      <div className="overflow-x-auto rounded-lg border p-3">
        <div style={{ minWidth: Math.max(320, LARGEUR_SUJET * traces.length) }}>
          <ResponsiveContainer width="100%" height={HAUTEUR}>
            {/*
              ⚠️ EN RECHARTS, `layout="vertical"` DONNE DES BARRES HORIZONTALES —
              le mot décrit l'axe des catégories, pas le sens des barres. Les
              colonnes s'obtiennent donc avec la disposition PAR DÉFAUT, en
              échangeant les rôles des deux axes.
            */}
            {/*
              ⚠️ LA PLACE DES LIBELLÉS SE RÉSERVE UNE SEULE FOIS, sur `height` de
              l'axe. La donner AUSSI en `margin.bottom` la compte DEUX fois :
              mesuré, il ne restait que 72 px de zone de tracé sur 300, la moitié
              des colonnes tombait sous 5 px et le graphique paraissait plat —
              ce que j'ai d'abord pris pour un défaut d'échelle.
            */}
            {/*
              ⚠️ LA PLACE DU HAUT EST CALCULÉE, PAS FIXE : les étiquettes se
              posent TOUJOURS AU-DESSUS des bâtons (demande du porteur,
              2026-09-02), il faut donc que le plus haut d'entre eux en laisse
              assez. Sans cela, la seule issue serait de l'écrire DANS le bâton,
              ce qui masque précisément ce qu'on vient lire.
            */}
            <ComposedChart data={traces} margin={{ left: 4, right: 8, top: margeHaute, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                type="category"
                /*
                 * ⚠️ `cle`, PAS `sujet` : ventilé par groupe, le même module
                 * revient sur plusieurs bâtons, et l'axe des CATÉGORIES de
                 * recharts les fusionnerait s'ils partageaient leur valeur.
                 * C'est le tick qui réaffiche le code du module.
                 */
                dataKey="cle"
                interval={0}
                tickLine={false}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                height={MARGE_BASSE}
                tick={<TickSujet donnees={traces} axe={axe} taille={tailleAxe} />}
              />
              <YAxis
                yAxisId="heures"
                type="number"
                width={52}
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                unit=" h"
              />

              {/*
                ⚠️ UN SECOND AXE, À DROITE, EN POURCENTAGES — et borné à 110 %
                comme l'existant (`suggestedMax: 110`). Sans borne, un module
                dépassé à 130 % écraserait toute la courbe vers le bas ; sans
                second axe, un taux de 50 se lirait comme 50 HEURES sur une
                échelle qui monte à 1400.
              */}
              {courbeTaux && (
                <YAxis
                  yAxisId="taux"
                  orientation="right"
                  type="number"
                  domain={[0, 110]}
                  width={44}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  unit=" %"
                />
              )}
              <Tooltip
                cursor={{ fill: 'hsl(var(--muted))' }}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: '1px solid hsl(var(--border))',
                  background: 'hsl(var(--card))',
                }}
                formatter={(valeur, cle, entree) =>
                  /* ⚠️ DEUX UNITÉS SUR LE MÊME GRAPHE : les courbes de TAUX sont
                     en pourcentages, les barres et la courbe de RÉFÉRENCE en
                     heures. Une mise en forme unique ferait lire « 42 h » là où
                     il faut lire « 42 % », et l'inverse. */
                  cle === 'taux' || cle === 'objectif'
                    ? [`${nombre(valeur)} %`, entree?.name ?? cle]
                    : [`${nombre(valeur)} h`, LIBELLES[cle] ?? entree?.name ?? cle]
                }
                /*
                 * ⚠️ LE TAUX EST DANS L'EN-TÊTE DE L'INFOBULLE. Le libellé de
                 * l'axe est incliné et ne peut pas porter une seconde ligne : le
                 * chiffre qu'on vient chercher doit se trouver là où l'on
                 * survole, sinon il faut rebasculer sur le tableau pour le lire.
                 */
                labelFormatter={(cle) => {
                  const ligne = traces.find((entree) => entree.cle === cle);
                  if (!ligne) return cle;
                  const sujet = ligne.sujet;
                  const taux = ligne.taux === null ? '' : ` — ${nombre(ligne.taux)} %`;
                  /*
                   * ⚠️ LE SEMESTRE ET L'EFM RÉGIONAL PASSENT ICI. L'étiquette
                   * d'axe est inclinée et ne peut porter qu'une ligne ; ce sont
                   * pourtant les deux repères qui expliquent un taux — un module
                   * de S2 n'a pas à être avancé en novembre.
                   */
                  const semestre = ligne.semestre ? ` · ${SEMESTRE_LU[ligne.semestre] ?? ligne.semestre}` : '';
                  const regional = ligne.estRegional ? ' · EFM régional' : '';
                  /* ⚠️ LE NOM COMPLET AUSSI : l'étiquette de l'axe est tronquée
                     à vingt-deux caractères, et un intitulé DRIF en fait
                     soixante — « EGTSI106 » seul n'apprend rien. */
                  const nom = intitules[sujet] ? ` — ${intitules[sujet]}` : '';
                  /*
                   * ⚠️ ICI ILS SONT TOUS NOMMÉS, là où l'étiquette de l'axe n'en
                   * porte que deux : l'infobulle a la place d'une phrase, et
                   * c'est le seul endroit où « +3 » se résout.
                   */
                  const avec = (ligne.complements ?? []).length
                    ? ` · ${LIBELLE_COMPLEMENT[complement]} : ${ligne.complements.join(', ')}`
                    : '';
                  return `${sujet}${nom}${taux}${semestre}${regional}${avec}`;
                }}
              />

              {SERIES.map((serie) => (
                <Bar
                  key={serie.cle}
                  dataKey={serie.cle}
                  yAxisId="heures"
                  /*
                   * ═══ ⚠️ LE NOM EST SUR LE BÂTON, PLUS SOUS L'AXE ═══ (demande
                   * du porteur, 2026-09-01 : « je veux que le nom soit en
                   * bâtonné ou bien en haut du bâtonné ».)
                   *
                   * ⚠️ PAR LA `shape`, PAS PAR UN `label` : ni `label` ni
                   * `<LabelList>` ne rendent quoi que ce soit sur un `<Bar>` en
                   * recharts 3 — vérifié dans le SVG produit, aucun nœud
                   * `recharts-label`. La forme, elle, reçoit ses coordonnées et
                   * dessine ce qu'on veut.
                   */
                  shape={
                    serie.pile === 'prevu' ? (
                      <BatonNomme cle={serie.cle} taille={tailleEtiquette} />
                    ) : undefined
                  }
                  stackId={serie.pile}
                  fill={serie.couleur}
                  maxBarSize={14}
                  /*
                   * ⚠️ SANS ANIMATION. Recharts anime l'apparition par
                   * `requestAnimationFrame`, et Chrome GÈLE ces trames dans un
                   * onglet ou un panneau qui n'est pas à l'écran : les barres
                   * restent à hauteur nulle et le graphique paraît vide, axes
                   * dessinés autour du rien. Déjà constaté sur le panneau de
                   * statistiques de l'emploi du temps.
                   */
                  isAnimationActive={false}
                />
              ))}
              {/*
                ⚠️ LES COURBES SE DÉCLARENT APRÈS LES BARRES : recharts empile
                dans l'ordre du JSX, et déclarée avant, la ligne passerait
                DERRIÈRE les colonnes — invisible partout où une barre est haute.
              */}
              {courbeTaux && (
                <Line
                  yAxisId="taux"
                  type="monotone"
                  dataKey="taux"
                  name="Taux d’avancement"
                  stroke="hsl(var(--accent-orange))"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  /* Un sujet sans masse déclarée n'a pas de taux : la courbe
                     saute le point plutôt que de le poser à zéro. */
                  connectNulls={false}
                  isAnimationActive={false}
                />
              )}

              {/*
                ⚠️ SUR L'AXE DES HEURES, comme l'existant (`yAxisID: 'y_hours'`)
                et contrairement aux deux courbes de taux : ce n'est pas un
                rythme mais un PLAFOND, qui se lit à la même échelle que les
                barres qu'il borne.
              */}
              {courbeReference && (
                <Line
                  yAxisId="heures"
                  type="monotone"
                  dataKey="reference"
                  name={reference.libelle}
                  stroke="hsl(var(--accent-purple-deep))"
                  strokeWidth={2}
                  /* ⚠️ EN POINTILLÉ ET SANS POINTS, comme l'existant
                     (`borderDash`, `pointRadius: 0`) : une référence n'est pas
                     une mesure, et des points la feraient lire comme une série
                     relevée sujet par sujet. */
                  strokeDasharray="6 4"
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              )}

              {courbeObjectif && (
                <Line
                  yAxisId="taux"
                  type="monotone"
                  dataKey="objectif"
                  name="Objectif pédagogique"
                  stroke="hsl(var(--warning))"
                  strokeWidth={2}
                  /* ⚠️ EN POINTILLÉ, comme l'existant : ce n'est pas une mesure
                     mais un REPÈRE — ce que le calendrier prescrit, pas ce qui a
                     été fait. Un trait plein les mettrait sur le même plan. */
                  strokeDasharray="5 5"
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {sansMasse.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Sans aucune masse déclarée ({sansMasse.length}) :{' '}
          {[...new Set(sansMasse.map((ligne) => ligne.sujet))].join(', ')} — à corriger dans la carte
          d’affectations, pas ici.
        </p>
      )}

    </div>
  );
}

/**
 * ⚠️ TICK DESSINÉ À LA MAIN, pour l'INCLINER. `angle` sur la prop `tick` ne
 * suffit pas : recharts 3 recalcule alors l'ancrage et tronque, et ni
 * `<LabelList>` ni la prop `label` de `<Bar>` ne rendent quoi que ce soit —
 * vérifié dans le SVG produit, aucun nœud `recharts-label`. Plutôt que de
 * deviner l'API d'une version, on dessine ce dont on a besoin : c'est du SVG, et
 * il est sous contrôle.
 *
 * ⚠️ INCLINÉ À -45°, comme l'existant. Un nom de formateur fait vingt
 * caractères et un intitulé de module soixante : droits, ils se chevauchent dès
 * la troisième colonne ; verticaux, ils se lisent la tête penchée.
 */
function TickSujet({ x, y, payload, donnees, axe, taille }) {
  /* Les repères ne valent que sur l'axe module — cf. plus bas. */
  const avecReperes = axe === 'module';
  /*
   * ⚠️ LES REPÈRES NE VALENT QUE SUR L'AXE MODULE. Un GROUPE suit des modules
   * des deux semestres et porte donc presque toujours « A » : le badge ne
   * décrirait pas le groupe mais l'ensemble de ses cours, et l'étoile dirait
   * seulement qu'AU MOINS UN de ses modules est régional. Le commentaire le
   * disait déjà ; le code ne l'appliquait pas — vu sur une capture.
   */
  /*
   * ⚠️ LA LIGNE SE CHERCHE TOUJOURS, les REPÈRES seulement sur l'axe module :
   * le complément — qui enseigne, à qui — vaut pour deux axes, le badge et
   * l'étoile pour un seul.
   */
  const ligne = donnees?.find((entree) => entree.cle === payload.value) ?? null;
  const badge = avecReperes && ligne?.semestre ? BADGES[ligne.semestre] : null;
  const etoile = avecReperes && ligne?.estRegional;

  /*
   * ═══ ⚠️ -45° PARTOUT, PARCE QUE LE NOM SE COUPE EN DEUX ═══ (demande du
   * porteur.) Le passage à la verticale ne servait qu'à loger « ABDELGHANI
   * LAASAL » sur une seule ligne. En le coupant à l'espace — prénom au-dessus,
   * nom en dessous — chaque ligne redescend à une douzaine de caractères, et
   * l'inclinaison à 45°, plus lisible, redevient tenable.
   *
   * ⚠️ UNE SEULE RÈGLE, PAS UNE BRANCHE PAR AXE : un code de module ne porte
   * aucune espace, il reste donc sur une ligne sans qu'on ait à le dire.
   *
   * ═══ ⚠️ ON AFFICHE `sujet`, JAMAIS `payload.value` ═══ (correction du
   * porteur, 2026-09-02 : « laisser seulement le nom du module ».) Depuis que
   * l'axe est indexé par `cle`, cette valeur est l'identité INTERNE du bâton —
   * « EGQ102||OPCM101 ». Le groupe est déjà écrit au-dessus du bâton : le
   * répéter sous l'axe, séparateur compris, doublait la largeur des libellés
   * pour ne rien apprendre.
   */
  const lignesDuNom = decouper(ligne?.sujet ?? payload.value, {
    largeur: LARGEUR_TEXTE,
    taille,
    lignesMax: LIGNES_AXE,
  });

  return (
    <g transform={`translate(${x},${y})`}>
      {/*
        ═══ ⚠️ LE BADGE NE TOURNE PAS AVEC LE NOM ═══ (demande du porteur.)
        C'est ce qui en fait un BADGE et non un bout de texte incliné : posé à
        plat sous l'axe, il se lit d'un coup d'œil sur cinquante colonnes, avec
        le même rectangle plein et le même blanc que dans la grille et le
        chronogramme. Tourné avec le libellé, il redevenait une lettre penchée
        qu'il fallait déchiffrer.
      */}
      {badge && (
        <g transform={`translate(0,${DECALAGE_BADGE})`}>
          <rect x={-7} y={0} width={14} height={12} rx={2} fill={badge.fond} />
          <text x={0} y={9} textAnchor="middle" fontSize={9} fontWeight="600" fill="white">
            {badge.court}
          </text>
          {/*
            ⚠️ L'ÉTOILE GARDE SON AMBRE, celui de l'EFM régional dans la grille
            et dans le tableau : c'est la même information partout.

            ⚠️ ET ELLE EST PLUS GRANDE QUE LE BADGE (demande du porteur) : à 9 px
            elle passait pour une poussière à côté d'un rectangle plein de 14 px
            de large. C'est le seul repère qui ne soit pas encadré — il lui faut
            sa taille pour exister.
          */}
          {etoile && (
            <text x={0} y={26} textAnchor="middle" fontSize={14} fill="hsl(var(--warning))">
              ★
            </text>
          )}
        </g>
      )}

      {/*
        ═══ ⚠️ DROIT, PLUS EN BIAIS ═══ (demande du porteur, 2026-09-02.)
        Incliné, le nom avait une longueur illimitée — il débordait sur la marge
        basse, pas sur ses voisins — mais il se lisait la tête penchée et coûtait
        120 px pris sur le tracé. Droit, il tient dans la largeur de sa colonne :
        `decouper` le replie, et `tailleCommune` rétrécit toute la rangée d'un
        cran plutôt que de casser un mot.
      */}
      <g transform={`translate(0,${DEBUT_LIBELLE(Boolean(badge), etoile)})`}>
        {lignesDuNom.map((texte, rang) => (
          <text
            key={`${texte}-${rang}`}
            y={rang * interligne(taille)}
            textAnchor="middle"
            dy={3.5}
            fontSize={taille}
            fill="hsl(var(--foreground))"
          >
            {texte}
          </text>
        ))}
      </g>
    </g>
  );
}

/**
 * Un bâton de la pile « affecté », surmonté du complément.
 *
 * ═══ ⚠️ SEUL LE SEGMENT DU HAUT L'ÉCRIT ═══
 * La pile en compte deux — présentiel puis distanciel. Les laisser tous deux
 * écrire donnerait le nom en double, l'un derrière l'autre. Le segment du haut
 * est le distanciel s'il existe, le présentiel sinon ; et c'est bien SON `y` qui
 * est le sommet de la pile.
 *
 * ═══ ⚠️ DROIT, REPLIÉ ET RÉTRÉCI ═══ (demande du porteur, 2026-09-02.)
 * Il était VERTICAL, précisément pour qu'un nom de dix-sept caractères ne morde
 * pas sur ses voisins dans une colonne de 44 px. Droit, la même garantie
 * s'obtient autrement : `decouper` le replie sur deux lignes et `tailleCommune`
 * rétrécit toute la rangée d'un cran — jamais une ligne plus large que sa
 * colonne, donc jamais de chevauchement.
 *
 * ═══ ⚠️ TOUJOURS AU-DESSUS, JAMAIS DEDANS ═══ (demande du porteur, 2026-09-02 :
 * « met en haut du bâtonné pas dans le bâtonné pour ne pas déranger ».) Écrit
 * par-dessus, il masquait la barre — c'est-à-dire la seule chose que le
 * graphique ait à montrer. La place nécessaire est donc RÉSERVÉE en haut du
 * tracé (`margeDesEtiquettes`) : le cas « ça ne rentre pas » n'existe plus.
 */
function BatonNomme({ cle, x, y, width, height, fill, payload, taille }) {
  const lignes = payload?.etiquetteLignes ?? [];

  /* Le segment du HAUT de la pile : le distanciel s'il porte des heures. */
  const sommet = payload?.prevuSynchrone > 0 ? 'prevuSynchrone' : 'prevuPresentiel';

  const centre = x + width / 2;

  /*
   * ⚠️ ON EMPILE VERS LE HAUT : la DERNIÈRE ligne se pose juste au-dessus du
   * bâton, les précédentes au-dessus d'elle. Empilées vers le bas, elles
   * recouvriraient précisément ce qu'elles annoncent.
   */
  const bas = y - ECART_BATON;

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} />

      {cle === sommet &&
        lignes.map((texte, rang) => (
          <text
            key={`${texte}-${rang}`}
            x={centre}
            y={bas - (lignes.length - 1 - rang) * interligne(taille)}
            textAnchor="middle"
            fontSize={taille}
            fill="hsl(var(--muted-foreground))"
          >
            {texte}
          </text>
        ))}
    </g>
  );
}

/** Ce qui sépare le bas de l'étiquette du sommet du bâton. */
const ECART_BATON = 4;

/**
 * La place à réserver EN HAUT pour que chaque étiquette tienne au-dessus de son
 * bâton.
 *
 * ═══ ⚠️ CE N'EST PAS « la plus longue étiquette » ═══
 * La contrainte est un COUPLE : un bâton haut portant un nom court n'a besoin de
 * rien, un bâton moyen portant un nom long en demande beaucoup. Pour une marge
 * `M`, l'espace libre au-dessus du bâton `i` vaut `M + (H − M)(1 − vᵢ/max)` ; on
 * résout cette inéquation sujet par sujet et on garde le pire.
 *
 * ⚠️ ON DIVISE PAR LE MAXIMUM DES DONNÉES, pas par le plafond que recharts
 * affichera : celui-ci est arrondi VERS LE HAUT à une graduation ronde, donc les
 * bâtons y sont un peu plus courts que calculé ici. L'écart va dans le bon sens
 * — il reste plus de place, jamais moins.
 *
 * ⚠️ BORNÉE À 45 % DE LA HAUTEUR : sans cela une étiquette pathologique
 * écraserait le tracé jusqu'à le rendre illisible. Le budget de caractères de
 * `resumerComplements` rend ce plafond théorique — il est là par sécurité, pas
 * par nécessité.
 */
function margeDesEtiquettes(traces, taille) {
  const valeurs = traces.flatMap((t) => [t.prevu ?? 0, t.realise ?? 0, t.reference ?? 0]);
  const max = Math.max(0, ...valeurs);
  if (max <= 0) return MARGE_HAUTE;

  /* Hauteur disponible avant la marge du haut : l'axe des sujets prend le bas. */
  const disponible = HAUTEUR - MARGE_BASSE;

  let besoin = MARGE_HAUTE;

  for (const trace of traces) {
    if (!trace.etiquetteLignes?.length) continue;

    const part = (trace.prevu ?? 0) / max;
    if (part <= 0) continue;

    const requis = trace.etiquetteLignes.length * interligne(taille) + MARGE_HAUTE;
    besoin = Math.max(besoin, (requis - disponible * (1 - part)) / part);
  }

  return Math.min(Math.ceil(besoin), Math.round(HAUTEUR * 0.45));
}

/** Ce qu'on garde libre en haut du tracé : un titre écrit dessus serait rogné. */
const MARGE_HAUTE = 8;

/** Le badge commence juste sous l'axe ; le libellé après lui. */
const DECALAGE_BADGE = 6;

/**
 * Où commence le libellé, sous le badge et son éventuelle étoile.
 *
 * ⚠️ LES VALEURS SE DÉDUISENT DE CE QUI EST DESSINÉ, elles ne se règlent pas à
 * l'œil : le rectangle occupe `[6, 18]`, l'étoile descend jusqu'à ~28. Mes
 * premières valeurs (16 et 26) plaçaient le nom à 22 et 32 — soit 4 px de
 * respiration après le badge et **2 px après l'étoile**, ce qui les faisait se
 * toucher sur M102, M107 et M111.
 *
 * ⚠️ ET C'EST BIEN UN ÉCART VERTICAL, quel que soit l'angle : le libellé est
 * TOURNÉ, mais le point d'où part sa rotation, lui, ne l'est pas.
 */
const BAS_DU_BADGE = DECALAGE_BADGE + 12; // la hauteur du rectangle
const BAS_DE_L_ETOILE = DECALAGE_BADGE + 29; // sa ligne de base (26), plus la descendante

/**
 * ⚠️ LE HAUT DE LA BOÎTE DU LIBELLÉ TOMBE ~5 px AU-DESSUS de son point
 * d'ancrage — le `dy` plus l'ascendante de la police. Sans en tenir compte, la
 * respiration demandée n'arrive jamais entière : mesuré, un même écart nominal
 * de 9 px donnait **8 px sous l'étoile mais 4 px sous le badge**, parce que
 * j'avais en plus surestimé de 4 px le bas de l'étoile.
 */
const ASCENDANTE_LIBELLE = 5;
const RESPIRATION = 10;

const DEBUT_LIBELLE = (avecBadge, avecEtoile) => {
  if (!avecBadge) return DECALAGE_BADGE;
  const bas = avecEtoile ? BAS_DE_L_ETOILE : BAS_DU_BADGE;
  return bas + RESPIRATION + ASCENDANTE_LIBELLE;
};

/*
 * ⚠️ LES COULEURS DU BADGE DE SEMESTRE, celles de `BadgeSemestre` — un module ne
 * peut pas changer de couleur selon l'écran. Elles sont écrites ici en
 * `hsl(var(--…))` parce que recharts dessine du SVG : une classe Tailwind n'y
 * serait pas interprétée, et le badge resterait transparent.
 */
const BADGES = {
  S1: { court: '1', fond: 'hsl(var(--accent-sky-deep))' },
  S2: { court: '2', fond: 'hsl(var(--accent-green-deep))' },
  A: { court: 'A', fond: 'hsl(var(--accent-orange))' },
};


/*
 * ⚠️ LÉGENDE ÉCRITE EN HTML, pas le `<Legend>` de recharts : elle doit dire les
 * DEUX dimensions à la fois — la couleur porte le TYPE de séance, l'intensité
 * dit affecté ou réalisé. Une liste plate de quatre entrées laisserait croire à
 * quatre catégories indépendantes.
 *
 * ⚠️ ELLE EST EXPORTÉE ET POSÉE PAR LA PAGE (demande du porteur, 2026-08-31) :
 * elle partage sa ligne avec le bouton « Filtrer ». Rendue ici, elle occupait
 * une rangée à elle seule au-dessus du graphe, et le bouton une autre.
 */
export function Legende({
  courbeTaux = false,
  courbeObjectif = false,
  reference = null,
  /* La semaine où le réalisé s'arrête — `null` quand l'écran est rembobiné, le
     bandeau disant alors déjà la date. */
  jusquA = null,
  /* Ce que « réalisé » désigne, quand ce n'est pas une semaine — « des séances
     terminées » dans les sessions consultatives. Il l'emporte sur `jusquA`. */
  mention = null,
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
      <Paire couleur="hsl(var(--accent-green))" libelle="Présentiel" />
      <Paire couleur="hsl(var(--accent-purple-mid))" libelle="Distanciel" />
      <span className="text-muted-foreground">
        teinte pleine = affecté · teinte claire = réalisé
        {/*
          ⚠️ JUSQU'OÙ COMPTE LE RÉALISÉ : depuis qu'il s'arrête à la semaine en
          cours, un module planifié jusqu'en juin n'apparaît plus comme fait —
          et sans cette mention, l'écart avec le chiffre qu'on avait en tête
          passerait pour une perte de données.
        */}
        {mention ? ` ${mention}` : jusquA ? ` jusqu’à S${jusquA}` : ''}
      </span>

      {/* ⚠️ UNE COURBE NON LÉGENDÉE EST UN TRAIT DE COULEUR : sans ces deux
          entrées, l'orange et l'ambre en pointillé ne disent rien de ce qu'ils
          mesurent — et surtout pas qu'ils sont en POURCENTAGES quand tout le
          reste du graphe est en heures. */}
      {courbeTaux && <Trait couleur="hsl(var(--accent-orange))" libelle="Taux d’avancement (%)" />}
      {courbeObjectif && (
        <Trait couleur="hsl(var(--warning))" libelle="Objectif pédagogique (%)" pointille />
      )}
      {/* ⚠️ SON UNITÉ EST ÉCRITE — « (h) » : c'est la seule courbe du graphe qui
          ne soit pas en pourcentages, et rien d'autre ne le dirait. */}
      {reference && <Trait couleur="hsl(var(--accent-purple-deep))" libelle={`${reference} (h)`} pointille />}
    </div>
  );
}

/** Le repère d'une COURBE : un segment, pas un carré — la forme dit la nature. */
function Trait({ couleur, libelle, pointille = false }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="18" height="6" aria-hidden="true">
        <line
          x1="0"
          y1="3"
          x2="18"
          y2="3"
          stroke={couleur}
          strokeWidth="2"
          strokeDasharray={pointille ? '4 3' : undefined}
        />
      </svg>
      {libelle}
    </span>
  );
}

function Paire({ couleur, libelle }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-flex overflow-hidden rounded-sm">
        <span className="block size-3" style={{ background: couleur }} />
        <span className="block size-3" style={{ background: couleur, opacity: 0.4 }} />
      </span>
      {libelle}
    </span>
  );
}

/**
 * ⚠️ LA HAUTEUR EST FIXE, et c'est la LARGEUR qui suit le nombre de sujets :
 * l'inverse de la version en barres horizontales. Une hauteur qui grandirait
 * avec les sujets ne servirait à rien — en colonnes, c'est l'axe des catégories
 * qui manque de place, jamais celui des heures.
 */
const HAUTEUR = 420;
/*
 * ═══ ⚠️ ÉLARGIE DE 44 À 56 AVEC LE PASSAGE AU TEXTE DROIT ═══ (2026-09-02.)
 * Un mot de dix caractères — « ABDELGHANI », « DEVOWFS101 » — ne tient dans
 * 44 px qu'à 6 px de police, ce qui ne se lit plus. À 56 px il tient à 8. Le
 * graphique défilait déjà horizontalement ; il défile un peu plus, et c'est le
 * prix d'un nom lisible.
 */
const LARGEUR_SUJET = 56;

/*
 * ⚠️ ZONE MORTE TEMPORELLE : ce bloc dépend de `LARGEUR_SUJET` et `MARGE_BASSE`
 * dépend de lui — l'ordre de déclaration N'EST PAS décoratif. Un `const` est
 * hoisté mais NON initialisé : placé plus haut, il rendrait un `ReferenceError`
 * au montage, que `vite build` ne signale pas (piège déjà payé deux fois ici).
 */

/**
 * La largeur RÉELLEMENT écrivable d'une colonne : sa largeur, moins la
 * gouttière qui empêche deux libellés voisins de se toucher.
 */
const LARGEUR_TEXTE = LARGEUR_SUJET - 2;

/**
 * ⚠️ DEUX LIGNES AU PLUS, DES DEUX CÔTÉS. Une troisième descendrait sous la
 * place réservée par `MARGE_BASSE` — ou, en haut, mangerait le tracé qu'elle
 * surmonte. Au-delà, c'est la TAILLE qui absorbe, puis la troncature.
 */
const LIGNES_AXE = 2;

/*
 * ⚠️ TROIS EN HAUT DU BÂTON, ET C'EST MESURÉ : « ABDESSAMAD AIT TALEB +1 » fait
 * quatre mots — sur deux lignes il ne rentre à aucune taille lisible, et
 * `lignesForcees` le coupait en « ABDESSAMAD / AIT TALEB … ». Une troisième
 * ligne le rend entier, pour ~10 px pris au tracé. Sous l'axe, en revanche, deux
 * suffisent : on y écrit « PRÉNOM NOM », jamais une liste.
 */
const LIGNES_ETIQUETTE = 3;

/** La plus grande taille de libellé — celle dont `tailleCommune` part. */
const TAILLE_MAX = 10;

/** Ce qui dépasse sous la ligne de base de la dernière ligne. */
const DESCENDANTE = 8;

/**
 * La place réservée sous l'axe : le BADGE (et son étoile) puis le libellé.
 *
 * ⚠️ ELLE SE CALCULE SUR LE CAS LE PLUS COÛTEUX — l'axe module, où le badge et
 * son étoile occupent ~50 px avant que le libellé ne commence. À -45°, seize
 * caractères à 10 px descendent de ~80/√2 ≈ 56 px, plus la seconde ligne.
 * Trop court, recharts rogne le bas du graphique et les noms sont coupés.
 *
 * ⚠️ ELLE A PU REDESCENDRE DE 170 À 120 en revenant à -45° : à la verticale, un
 * texte descendait de TOUTE sa longueur.
 */
/*
 * ═══ ⚠️ ELLE TOMBE DE 120 À ~68, ET C'EST LE VRAI GAIN DU TEXTE DROIT ═══
 * (2026-09-02.) Un nom incliné descend de toute sa longueur projetée ; droit, il
 * ne descend que de ses deux lignes. Les ~50 px rendus reviennent au TRACÉ, où
 * ils servent enfin à comparer des hauteurs de bâtons.
 *
 * ⚠️ ELLE SE DÉDUIT DE CE QUI EST DESSINÉ, elle ne se règle pas à l'œil : le
 * point de départ du libellé (badge et étoile compris), plus la seconde ligne, à
 * la taille MAXIMALE — c'est le pire cas, puisque `tailleCommune` ne fait que
 * rétrécir. Le reste est la descendante de la dernière ligne.
 */
const MARGE_BASSE =
  DEBUT_LIBELLE(true, true) + (LIGNES_AXE - 1) * interligne(TAILLE_MAX) + DESCENDANTE;


/**
 * Les compléments d'un bâton, en UNE ligne courte.
 *
 * ⚠️ DEUX AU PLUS, PUIS UN COMPTE : sans filtre, un module est enseigné par cinq
 * personnes et un formateur touche quinze groupes — la diagonale sous l'axe ne
 * peut pas les porter. Deux noms disent déjà de qui il s'agit ; le reste se
 * compte, et l'infobulle les nomme tous.
 *
 * ═══ ⚠️ LES NOMS NE SE TRONQUENT PLUS UN À UN ═══ (2026-09-02.) Ils l'étaient
 * à seize caractères, pour un texte incliné dont on ne pouvait ni replier ni
 * rétrécir les lignes — « ABDELGHANI LAASAL » y devenait « ABDELGHANI LAAS… »,
 * tronqué de deux lettres pour rien. Depuis le passage au texte DROIT, c'est
 * `decouper` qui replie et `tailleCommune` qui rétrécit : le budget ci-dessous
 * suffit à borner la LISTE, et chaque nom retenu reste entier.
 */
function resumerComplements(valeurs = [], mot = '') {
  if (!valeurs || valeurs.length === 0) return null;

  /*
   * ⚠️ ON REMPLIT UN BUDGET DE CARACTÈRES, on ne compte pas des noms : « 2 noms
   * au plus » donnait « ACADA101 (F…, ACADI101 (F… +12 », où les DEUX suffixes
   * étaient coupés — or « ACADA101 » et « ACADA101 (FQ) » sont deux groupes
   * différents. Un nom ENTIER suivi d'un compte en dit plus que deux moitiés.
   */
  let ligne = '';
  let nommes = 0;

  for (const valeur of valeurs) {
    const candidat = ligne ? `${ligne}, ${valeur}` : valeur;
    if (candidat.length > BUDGET_COMPLEMENT) break;
    ligne = candidat;
    nommes += 1;
  }

  /* Aucun ne tient : on compte, plutôt que d'afficher un début de mot. */
  if (nommes === 0) return `${valeurs.length} ${mot}`;

  const reste = valeurs.length - nommes;
  return reste > 0 ? `${ligne} +${reste}` : ligne;
}

/**
 * ⚠️ CE BUDGET BORNE LA DIAGONALE. Cette ligne s'ajoute sous un nom déjà sur
 * deux lignes ; c'est elle qui décide de la place à réserver sous l'axe
 * (`MARGE_BASSE`). Mesuré : 28 caractères à 9 px laissent encore 15 px de marge
 * sur l'axe formateur, le plus coûteux des trois.
 */
const BUDGET_COMPLEMENT = 20;

/*
 * ⚠️ `couperEnDeux` ET `tronquer` ONT ÉTÉ RETIRÉS (2026-09-02) : ils coupaient à
 * la PREMIÈRE espace et tronquaient à seize caractères, deux règles taillées
 * pour un texte incliné dont la longueur ne gênait personne. `decouper`
 * d'`etiquettes.js` les remplace — il remplit chaque ligne, et rétrécit plutôt
 * que de casser un mot.
 */
