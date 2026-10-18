import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { taux } from 'shared/domain';
import { ENTETES_GRILLE, etiquetteDe, grilleDuGraphe, xmlGraphe } from './grapheBatons.js';

/**
 * ═══ LE RAPPORT D'AVANCEMENT EN EXCEL (2026-10-17, demande du porteur :
 * « ajoute aussi l'export Excel avec le graphe ») ═══
 *
 * UNE FEUILLE PAR SUJET — formateur ou groupe : titre, résumé, le graphe à
 * bâtons « Affecté / Réalisé », puis le tableau. Avec plusieurs sujets, une
 * feuille « Synthèse » ouvre le classeur : un sujet par ligne, et son graphe.
 *
 * ⚠️ EXCELJS NE SAIT PAS DESSINER DE GRAPHIQUE : le classeur est écrit par
 * lui, puis les graphiques sont AJOUTÉS au paquet (dessin, graphique,
 * relations, types) — le même graphique natif que le Word (`grapheBatons.js`),
 * aux couleurs de l'application. Ses données — la grille des piles affectées
 * et réalisées, présentiel et distanciel — sont écrites dans des colonnes
 * MASQUÉES à droite du tableau : les afficher permet de modifier le graphe.
 *
 * ⚠️ « RESTE » ET « TAUX » SONT DES FORMULES (avec leur résultat calculé) :
 * une heure corrigée à la main les met à jour.
 */

/** Les lignes réservées au graphe, entre le résumé et le tableau. */
const LIGNES_GRAPHE = 20;
/** La ligne (1 = première) où commence le graphe, sous titre et résumé. */
const LIGNE_GRAPHE = 6;

const BORDURE = { style: 'thin', color: { argb: 'FF000000' } };
const BORDURES = { top: BORDURE, left: BORDURE, bottom: BORDURE, right: BORDURE };

export async function construireXlsxRapport({ etablissement, type, libelles, informations, rapports }) {
  const classeur = new ExcelJS.Workbook();
  classeur.creator = 'EDT Pro';
  const graphes = []; // { feuille: rang 1…, nom, grille, entete, colonnes, largeur }
  const noms = new Set();

  if (rapports.length > 1) {
    const feuille = nouvelleFeuille(classeur, 'Synthèse', noms);
    entete(feuille, etablissement, informations, `${libelles.sujet}s : ${rapports.length}`, null);
    const lignes = rapports.map((r) => ({ module: r.sujet, ...r.total }));
    const colonnes = [{ entete: libelles.sujet, largeur: 34, valeur: (l) => l.module }, ...colonnesHeures()];
    const debut = LIGNE_GRAPHE + LIGNES_GRAPHE + 1;
    tableauFeuille(feuille, { colonnes, lignes, debut });
    graphes.push({
      feuille: classeur.worksheets.length,
      nom: feuille.name,
      ...ecrireGrille(feuille, grilleDuGraphe(lignes.map((l) => ({ ...l, etiquette: l.module }))), debut, colonnes.length + 2),
      // Jusqu'à la colonne vide qui sépare le tableau de la grille masquée : celle-ci réduirait le graphe à rien.
      largeur: colonnes.length + 1,
    });
  }

  for (const rapport of rapports) {
    const feuille = nouvelleFeuille(classeur, rapport.sujet, noms);
    const reste = Math.max(0, rapport.total.affecte - rapport.total.realise);
    entete(
      feuille,
      etablissement,
      informations,
      `${libelles.sujet} : ${rapport.sujet}`,
      [
        `Masse affectée : ${heures(rapport.total.affecte)} h`,
        `Réalisée : ${heures(rapport.total.realise)} h`,
        `Reste : ${heures(reste)} h`,
        `Taux d’avancement : ${pourcentage(taux(rapport.total.realise, rapport.total.affecte))}`,
        `${rapport.lignes.length} module(s)`,
      ].join('   —   ')
    );

    if (rapport.lignes.length === 0) {
      feuille.getCell(`A${LIGNE_GRAPHE}`).value = 'Aucun module dans la sélection.';
      continue;
    }

    const colonnes = [
      { entete: 'N°', largeur: 5, valeur: (_, i) => i + 1 },
      ...(type === 'formateur' ? [{ entete: libelles.complement, largeur: 14, valeur: (l) => l.complement }] : []),
      { entete: 'Module', largeur: 11, valeur: (l) => l.module },
      { entete: 'Intitulé', largeur: 46, valeur: (l) => l.intitule, enveloppe: true },
      ...(type === 'groupe' ? [{ entete: libelles.complement, largeur: 26, valeur: (l) => l.complement, enveloppe: true }] : []),
      ...colonnesHeures(),
    ];
    const debut = LIGNE_GRAPHE + LIGNES_GRAPHE + 1;
    tableauFeuille(feuille, { colonnes, lignes: rapport.lignes, debut, total: rapport.total });
    graphes.push({
      feuille: classeur.worksheets.length,
      nom: feuille.name,
      ...ecrireGrille(
        feuille,
        grilleDuGraphe(rapport.lignes.map((l) => ({ ...l, etiquette: etiquetteDe(type, l) }))),
        debut,
        colonnes.length + 2
      ),
      largeur: colonnes.length + 1,
    });
  }

  const tampon = Buffer.from(await classeur.xlsx.writeBuffer());
  return ajouterGraphes(tampon, graphes);
}

const heures = (valeur) => Number(valeur ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const pourcentage = (valeur) => (valeur === null ? '—' : `${heures(valeur)} %`);

/** Affecté, Réalisé, puis Reste et Taux EN FORMULES — leur résultat est déjà calculé. */
function colonnesHeures() {
  return [
    { entete: 'Affecté (h)', largeur: 12, valeur: (l) => l.affecte, centre: true },
    { entete: 'Réalisé (h)', largeur: 12, valeur: (l) => l.realise, centre: true },
    {
      entete: 'Reste (h)',
      largeur: 12,
      centre: true,
      valeur: (l, _i, ref) => ({ formula: `MAX(0,${ref.affecte}-${ref.realise})`, result: Math.max(0, l.affecte - l.realise) }),
    },
    {
      entete: 'Taux',
      largeur: 10,
      centre: true,
      format: '0.0%',
      valeur: (l, _i, ref) => ({
        formula: `IF(${ref.affecte}>0,${ref.realise}/${ref.affecte},"")`,
        result: l.affecte > 0 ? l.realise / l.affecte : '',
      }),
    },
  ];
}

/**
 * La grille du graphe, à partir de la colonne `depart` (1 = A) et de la ligne
 * `debut` — ses colonnes masquées. Rend où le graphe doit la lire.
 */
function ecrireGrille(feuille, grille, debut, depart) {
  const colonnes = ENTETES_GRILLE.map((_, rang) => feuille.getColumn(depart + rang));
  ENTETES_GRILLE.forEach((titre, rang) => {
    feuille.getRow(debut).getCell(depart + rang).value = titre;
  });
  grille.forEach((ligne, index) => {
    ligne.forEach((valeur, rang) => {
      if (valeur !== null && valeur !== '') feuille.getRow(debut + 1 + index).getCell(depart + rang).value = valeur;
    });
  });
  for (const colonne of colonnes) colonne.hidden = true;
  return { grille, entete: debut, colonnes: colonnes.map((c) => c.letter) };
}

/** Un nom de feuille admis par Excel : sans `[]:*?/\`, 31 caractères au plus, unique. */
function nouvelleFeuille(classeur, voulu, noms) {
  const base = String(voulu).replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Feuille';
  let nom = base;
  for (let n = 2; noms.has(nom.toLowerCase()); n += 1) nom = `${base.slice(0, 31 - ` (${n})`.length)} (${n})`;
  noms.add(nom.toLowerCase());
  return classeur.addWorksheet(nom, {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ showGridLines: false }],
  });
}

function entete(feuille, etablissement, informations, titre, resume) {
  feuille.getCell('A1').value = `Rapport d’avancement — ${etablissement?.nom ?? ''}`.trim();
  feuille.getCell('A1').font = { bold: true, size: 14 };
  feuille.getCell('A2').value = informations;
  feuille.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF595959' } };
  feuille.getCell('A3').value = titre;
  feuille.getCell('A3').font = { bold: true, size: 13, color: { argb: 'FF2F5597' } };
  if (resume) {
    feuille.getCell('A4').value = resume;
    feuille.getCell('A4').font = { bold: true, size: 10 };
  }
}

/** Le tableau à partir de la ligne `debut` ; rend le numéro de sa première ligne de données. */
function tableauFeuille(feuille, { colonnes, lignes, debut, total = null }) {
  colonnes.forEach((colonne, rang) => {
    const col = feuille.getColumn(rang + 1);
    col.width = colonne.largeur;
  });

  const ligneEntete = feuille.getRow(debut);
  colonnes.forEach((colonne, rang) => {
    const cellule = ligneEntete.getCell(rang + 1);
    cellule.value = colonne.entete;
    cellule.font = { bold: true, size: 10 };
    cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    cellule.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cellule.border = BORDURES;
  });

  const lettreDe = (entete) => feuille.getColumn(colonnes.findIndex((c) => c.entete === entete) + 1).letter;
  const ecrire = (numero, valeurs, { gras = false } = {}) => {
    const ligne = feuille.getRow(numero);
    valeurs.forEach((valeur, rang) => {
      const colonne = colonnes[rang];
      const cellule = ligne.getCell(rang + 1);
      cellule.value = valeur;
      cellule.font = { bold: gras, size: 10 };
      cellule.border = BORDURES;
      cellule.alignment = {
        vertical: 'middle',
        horizontal: colonne.centre || rang === 0 ? 'center' : 'left',
        wrapText: Boolean(colonne.enveloppe),
      };
      if (colonne.format) cellule.numFmt = colonne.format;
    });
  };

  lignes.forEach((ligne, index) => {
    const numero = debut + 1 + index;
    const ref = { affecte: `${lettreDe('Affecté (h)')}${numero}`, realise: `${lettreDe('Réalisé (h)')}${numero}` };
    ecrire(numero, colonnes.map((colonne) => colonne.valeur(ligne, index, ref)));
  });

  /*
   * ⚠️ LE TOTAL EST CELUI DU RAPPORT, pas la somme des lignes : une séance
   * synchrone mutualisée entre deux groupes figure sur leurs deux lignes, mais
   * n'a été donnée qu'une fois (`totalAvancement`).
   */
  if (total) {
    const numero = debut + 1 + lignes.length;
    const ref = { affecte: `${lettreDe('Affecté (h)')}${numero}`, realise: `${lettreDe('Réalisé (h)')}${numero}` };
    const valeurs = colonnes.map((colonne, rang) => {
      if (colonne.entete === 'Affecté (h)') return total.affecte;
      if (colonne.entete === 'Réalisé (h)') return total.realise;
      if (colonne.entete === 'Reste (h)' || colonne.entete === 'Taux') {
        return colonne.valeur({ affecte: total.affecte, realise: total.realise }, 0, ref);
      }
      return rang === 0 ? 'Total' : '';
    });
    ecrire(numero, valeurs, { gras: true });
    feuille.mergeCells(numero, 1, numero, colonnes.findIndex((c) => c.entete === 'Affecté (h)'));
  }

  return debut + 1;
}

/**
 * Ajoute au classeur écrit par ExcelJS un graphique par feuille de `graphes` :
 * le dessin (ancré sur les lignes réservées), le graphique, leurs relations et
 * leurs types de contenu.
 */
async function ajouterGraphes(tampon, graphes) {
  if (graphes.length === 0) return tampon;
  const zip = await JSZip.loadAsync(tampon);
  let types = await zip.file('[Content_Types].xml').async('string');

  for (const [rang, graphe] of graphes.entries()) {
    const numero = rang + 1;
    const cheminFeuille = `xl/worksheets/sheet${graphe.feuille}.xml`;
    const fichierFeuille = zip.file(cheminFeuille);
    if (!fichierFeuille) throw new Error(`Classeur illisible : ${cheminFeuille} absent`);

    zip.file(
      `xl/charts/chart${numero}.xml`,
      xmlGraphe(graphe.grille, {
        feuille: graphe.nom,
        entete: graphe.entete,
        colonnes: graphe.colonnes,
        classeurIncorpore: false,
      })
    );
    zip.file(`xl/drawings/drawing${numero}.xml`, xmlDessin(graphe.largeur));
    zip.file(
      `xl/drawings/_rels/drawing${numero}.xml.rels`,
      relations([['rId1', 'chart', `../charts/chart${numero}.xml`]])
    );

    // La feuille désigne son dessin : une relation, et `<drawing>` à sa place dans le schéma.
    const cheminRelations = `xl/worksheets/_rels/sheet${graphe.feuille}.xml.rels`;
    const relationDessin = `<Relationship Id="rIdGrapheRapport" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${numero}.xml"/>`;
    const existantes = zip.file(cheminRelations);
    zip.file(
      cheminRelations,
      existantes
        ? (await existantes.async('string')).replace('</Relationships>', `${relationDessin}</Relationships>`)
        : relations([]).replace('</Relationships>', `${relationDessin}</Relationships>`)
    );

    let xml = await fichierFeuille.async('string');
    if (!/<worksheet[^>]*xmlns:r=/.test(xml)) {
      xml = xml.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    }
    const suivants = ['<legacyDrawing', '<legacyDrawingHF', '<picture', '<oleObjects', '<controls', '<webPublishItems', '<tableParts', '<extLst', '</worksheet>'];
    const position = Math.min(...suivants.map((balise) => xml.indexOf(balise)).filter((i) => i >= 0));
    zip.file(cheminFeuille, `${xml.slice(0, position)}<drawing r:id="rIdGrapheRapport"/>${xml.slice(position)}`);

    types = types.replace(
      '</Types>',
      `<Override PartName="/xl/charts/chart${numero}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>` +
        `<Override PartName="/xl/drawings/drawing${numero}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`
    );
  }

  zip.file('[Content_Types].xml', types);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const TYPES_RELATION = {
  chart: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
};

function relations(liste) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    liste.map(([id, type, cible]) => `<Relationship Id="${id}" Type="${TYPES_RELATION[type]}" Target="${cible}"/>`).join('') +
    '</Relationships>'
  );
}

/** Le dessin d'une feuille : le graphique, des colonnes A à `largeur`, sur les lignes réservées. */
function xmlDessin(largeur) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<xdr:twoCellAnchor editAs="oneCell">' +
    `<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${LIGNE_GRAPHE - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>${largeur}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${LIGNE_GRAPHE - 1 + LIGNES_GRAPHE - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
    '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Graphique d’avancement"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
    '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
    '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>' +
    '</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>'
  );
}
