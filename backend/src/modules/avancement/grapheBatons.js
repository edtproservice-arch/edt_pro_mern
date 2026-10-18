import { taux } from 'shared/domain';
import { echapperXml } from '../seances/xmlCellules.js';

/**
 * Le graphe à bâtons du rapport d'avancement (2026-10-17) — le MÊME graphique
 * natif dans le Word (donc le PDF) et dans l'Excel : les deux ne diffèrent que
 * par l'endroit où vivent ses données.
 *
 * ═══ ⚠️ LE DESSIN DE L'APPLICATION (2026-10-17, demande du porteur : « les
 * mêmes couleurs en application, PDF, Word, Excel ») ═══
 * Comme `GrapheAvancement` : par module, DEUX bâtons empilés — l'affecté et le
 * réalisé —, chacun en présentiel (vert) et distanciel (violet), le réalisé dans
 * les mêmes teintes à 40 %. Les couleurs sont celles du thème clair
 * (`globals.css` : `--accent-green` 125 78 % 37 %, `--accent-purple-mid`
 * 273 66 % 60 %) ; les 40 % d'opacité de l'écran sont ici mêlés au blanc, une
 * couleur pleine que Word, Excel et LibreOffice rendent tous à l'identique.
 *
 * ⚠️ DEUX PILES PAR CATÉGORIE N'EXISTENT PAS dans un graphique Office : chaque
 * module occupe donc TROIS emplacements — la pile affectée, la pile réalisée,
 * un vide qui le sépare du suivant —, les séries de l'une restant vides sur
 * l'autre. Le nom du module est le niveau supérieur d'un axe à deux niveaux,
 * centré sous ses deux piles. C'est la `grilleDuGraphe`, écrite telle quelle
 * dans la feuille (Excel) ou le classeur incorporé (Word).
 */

export const SERIES_GRAPHE = [
  { cle: 'affectePresentiel', nom: 'Affecté présentiel', couleur: '15A821' },
  { cle: 'affecteDistanciel', nom: 'Affecté distanciel', couleur: 'A056DC' },
  { cle: 'realisePresentiel', nom: 'Réalisé présentiel', couleur: 'A1DCA6' },
  { cle: 'realiseDistanciel', nom: 'Réalisé distanciel', couleur: 'D9BBF1' },
];

/** Les en-têtes de la grille : l'étiquette du module, sa pile, puis une colonne par série. */
/*
 * ═══ LA COURBE DU TAUX (2026-10-17, demande du porteur : « ajoute aussi la
 * courbe du taux dans le graphe ») ═══ Celle de l'application : orange
 * (`--accent-orange`, 25 100 % 43 %), sur un second axe à droite en %, borné à
 * 110 % comme l'écran — un module dépassé à 130 % n'écrase pas la courbe. Son
 * point est posé sur la pile RÉALISÉE de chaque module (le taux est ce réalisé
 * rapporté à l'affecté), et la courbe enjambe les emplacements vides. Un module
 * sans heure affectée n'a pas de taux : pas de point.
 */
export const COURBE_TAUX = { nom: 'Taux d’avancement (%)', couleur: 'DD5B00' };

/** Au-delà, les pourcentages écrits sur la courbe se chevaucheraient : on les retire. */
const TAUX_ECRITS_MAX = 16;

export const ENTETES_GRILLE = ['Module', 'Pile', ...SERIES_GRAPHE.map((s) => s.nom), COURBE_TAUX.nom];

/**
 * L'étiquette d'un module sous le graphe : son code, et son groupe dans le
 * rapport d'un formateur — À LA LIGNE : sur la même, dix modules se chevauchaient.
 */
export const etiquetteDe = (type, ligne) =>
  type === 'formateur' && ligne.complement ? `${ligne.module}\n${ligne.complement}` : ligne.module;

/** Au-delà, « Affecté » et « Réalisé » ne tiennent plus sous leurs piles : les teintes de la légende suffisent. */
const PILES_NOMMEES_MAX = 6;

/**
 * Les lignes de données du graphe, emplacement par emplacement :
 * `[module, pile, affecté P, affecté D, réalisé P, réalisé D, taux %]` — `null`
 * là où la série n'a rien à dessiner.
 *
 * @param {Array<{etiquette, affectePresentiel, affecteDistanciel, realisePresentiel, realiseDistanciel}>} batons
 */
export function grilleDuGraphe(batons) {
  const [affecte, realise] = batons.length <= PILES_NOMMEES_MAX ? ['Affecté', 'Réalisé'] : ['', ''];
  return batons.flatMap((baton, rang) => [
    [baton.etiquette, affecte, baton.affectePresentiel, baton.affecteDistanciel, null, null, null],
    ['', realise, null, null, baton.realisePresentiel, baton.realiseDistanciel, taux(baton.realise, baton.affecte)],
    ...(rang < batons.length - 1 ? [['', '', null, null, null, null, null]] : []),
  ]);
}

/** Calibri, `taille` en centièmes de point — le texte d'un élément du graphique. */
const texteGraphe = (taille, { gras = false } = {}) =>
  '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>' +
  `<a:defRPr sz="${taille}" b="${gras ? 1 : 0}"><a:solidFill><a:srgbClr val="595959"/></a:solidFill>` +
  '<a:latin typeface="Calibri"/><a:cs typeface="Calibri"/></a:defRPr></a:pPr><a:endParaRPr lang="fr-FR"/></a:p></c:txPr>';

/** Le nom d'une feuille dans une formule : entre apostrophes, les siennes doublées. */
const feuilleFormule = (nom) => `'${String(nom).replaceAll("'", "''")}'`;

/** Les points non vides d'une colonne de la grille, pour un cache de graphique. */
const points = (valeurs, enTexte) =>
  valeurs
    .map((v, i) => {
      if (v === null || v === undefined || v === '') return '';
      return `<c:pt idx="${i}"><c:v>${enTexte ? echapperXml(String(v)) : Number(v) || 0}</c:v></c:pt>`;
    })
    .join('');

/**
 * Le graphique, ses valeurs MISES EN CACHE — c'est ce que Word et LibreOffice
 * affichent ; les cellules désignées ne servent qu'à les modifier (Excel les
 * relit).
 *
 * `references` : où la feuille porte la grille — son nom, la ligne de ses
 * en-têtes (les données suivent) et la lettre de ses six colonnes, dans
 * l'ordre d'`ENTETES_GRILLE` (les deux premières côte à côte : l'axe à deux
 * niveaux les lit d'un seul bloc). Par défaut, le classeur incorporé au Word.
 * `classeurIncorpore` : Word seulement — dans Excel, les données SONT la feuille.
 */
export function xmlGraphe(
  grille,
  { feuille = 'Feuil1', entete = 1, colonnes = ['A', 'B', 'C', 'D', 'E', 'F', 'G'], classeurIncorpore = true } = {}
) {
  const derniere = entete + grille.length;
  const cellule = (colonne, ligne) => `$${colonne}$${ligne}`;
  const plage = (colonne) => `${feuilleFormule(feuille)}!${cellule(colonne, entete + 1)}:${cellule(colonne, derniere)}`;
  const nombre = grille.length;

  const categories =
    `<c:cat><c:multiLvlStrRef><c:f>${feuilleFormule(feuille)}!${cellule(colonnes[0], entete + 1)}:${cellule(colonnes[1], derniere)}</c:f>` +
    `<c:multiLvlStrCache><c:ptCount val="${nombre}"/>` +
    `<c:lvl>${points(grille.map((l) => l[1]), true)}</c:lvl>` +
    `<c:lvl>${points(grille.map((l) => l[0]), true)}</c:lvl>` +
    '</c:multiLvlStrCache></c:multiLvlStrRef></c:cat>';

  const xmlSeries = SERIES_GRAPHE.map(
    (serie, rang) =>
      `<c:ser><c:idx val="${rang}"/><c:order val="${rang}"/>` +
      `<c:tx><c:strRef><c:f>${feuilleFormule(feuille)}!${cellule(colonnes[2 + rang], entete)}</c:f>` +
      `<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${echapperXml(serie.nom)}</c:v></c:pt></c:strCache></c:strRef></c:tx>` +
      `<c:spPr><a:solidFill><a:srgbClr val="${serie.couleur}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>` +
      '<c:invertIfNegative val="0"/>' +
      categories +
      `<c:val><c:numRef><c:f>${plage(colonnes[2 + rang])}</c:f><c:numCache><c:formatCode>General</c:formatCode>` +
      `<c:ptCount val="${nombre}"/>${points(grille.map((l) => l[2 + rang]), false)}</c:numCache></c:numRef></c:val>` +
      '</c:ser>'
  ).join('');

  const rangTaux = 2 + SERIES_GRAPHE.length;
  const etiquettesTaux = grille.filter((l) => l[rangTaux] !== null).length <= TAUX_ECRITS_MAX;
  /* 110 % comme l'écran — mais un module dépassé (125 %) sortirait du papier, son
     pourcentage écrit par-dessus la légende : l'axe s'allonge alors jusqu'à lui. */
  const tauxMax = Math.max(0, ...grille.map((l) => l[rangTaux] ?? 0));
  const plafond = tauxMax > 110 ? Math.ceil(tauxMax / 10) * 10 + 10 : 110;
  const remplissage = `<a:solidFill><a:srgbClr val="${COURBE_TAUX.couleur}"/></a:solidFill>`;
  const courbe =
    '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' +
    `<c:ser><c:idx val="${rangTaux - 2}"/><c:order val="${rangTaux - 2}"/>` +
    `<c:tx><c:strRef><c:f>${feuilleFormule(feuille)}!${cellule(colonnes[rangTaux], entete)}</c:f>` +
    `<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${echapperXml(COURBE_TAUX.nom)}</c:v></c:pt></c:strCache></c:strRef></c:tx>` +
    `<c:spPr><a:ln w="28575" cap="rnd">${remplissage}<a:round/></a:ln></c:spPr>` +
    `<c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr>${remplissage}<a:ln><a:noFill/></a:ln></c:spPr></c:marker>` +
    (etiquettesTaux
      ? '<c:dLbls><c:numFmt formatCode="0&quot; %&quot;" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>' +
        '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="700" b="1">' +
        `${remplissage}<a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:endParaRPr lang="fr-FR"/></a:p></c:txPr>` +
        '<c:dLblPos val="t"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/>' +
        '<c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>'
      : '') +
    categories +
    `<c:val><c:numRef><c:f>${plage(colonnes[rangTaux])}</c:f><c:numCache><c:formatCode>General</c:formatCode>` +
    `<c:ptCount val="${nombre}"/>${points(grille.map((l) => l[rangTaux]), false)}</c:numCache></c:numRef></c:val>` +
    '<c:smooth val="0"/></c:ser>' +
    '<c:marker val="1"/><c:axId val="50010003"/><c:axId val="50010004"/></c:lineChart>';

  // Le second axe : ses catégories se confondent avec celles des bâtons (masqué), ses % à droite.
  const axesTaux =
    '<c:catAx><c:axId val="50010003"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/>' +
    '<c:axPos val="b"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' +
    '<c:crossAx val="50010004"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/>' +
    '<c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>' +
    `<c:valAx><c:axId val="50010004"/><c:scaling><c:orientation val="minMax"/><c:max val="${plafond}"/><c:min val="0"/></c:scaling>` +
    '<c:delete val="0"/><c:axPos val="r"/><c:numFmt formatCode="0&quot; %&quot;" sourceLinked="0"/>' +
    '<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' +
    `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${texteGraphe(800)}` +
    '<c:crossAx val="50010003"/><c:crosses val="max"/><c:crossBetween val="between"/></c:valAx>';

  const trait = (couleur) => `<c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="${couleur}"/></a:solidFill></a:ln></c:spPr>`;

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<c:date1904 val="0"/><c:lang val="fr-FR"/><c:roundedCorners val="0"/>' +
    '<c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/>' +
    '<c:barChart><c:barDir val="col"/><c:grouping val="stacked"/><c:varyColors val="0"/>' +
    xmlSeries +
    '<c:gapWidth val="12"/><c:overlap val="100"/><c:axId val="50010001"/><c:axId val="50010002"/></c:barChart>' +
    courbe +
    '<c:catAx><c:axId val="50010001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>' +
    '<c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/>' +
    `<c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${trait('D9D9D9')}` +
    texteGraphe(800) +
    '<c:crossAx val="50010002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/>' +
    '<c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>' +
    '<c:valAx><c:axId val="50010002"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/>' +
    '<c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E5E5E5"/></a:solidFill>' +
    '<a:prstDash val="dash"/></a:ln></c:spPr></c:majorGridlines>' +
    '<c:title><c:tx><c:rich><a:bodyPr rot="-5400000" vert="horz"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800" b="0"/></a:pPr>' +
    '<a:r><a:rPr lang="fr-FR" sz="800" b="0"><a:solidFill><a:srgbClr val="595959"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr>' +
    '<a:t>Heures</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>' +
    '<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/>' +
    `<c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${texteGraphe(800)}` +
    '<c:crossAx val="50010001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>' +
    axesTaux +
    '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>' +
    `<c:legend><c:legendPos val="t"/><c:overlay val="0"/>${texteGraphe(900)}</c:legend>` +
    // ⚠️ `plotVisOnly` À 0 : dans l'Excel, la grille vit dans des colonnes MASQUÉES — Excel n'en tracerait rien.
    '<c:plotVisOnly val="0"/><c:dispBlanksAs val="span"/></c:chart>' +
    '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>' +
    texteGraphe(900) +
    (classeurIncorpore ? '<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData>' : '') +
    '</c:chartSpace>'
  );
}
