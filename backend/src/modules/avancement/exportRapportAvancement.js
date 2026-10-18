import ExcelJS from 'exceljs';
import { taux } from 'shared/domain';
import { Etablissement } from '../../models/Etablissement.js';
import { ENTETES_GRILLE, etiquetteDe, grilleDuGraphe, xmlGraphe } from './grapheBatons.js';
import { construireXlsxRapport } from './exportRapportAvancementXlsx.js';
import { convertirDocxEnPdf } from '../seances/libreOffice.js';
import { LARGEUR_UTILE_PAYSAGE, SAUT_DE_PAGE, construireDocxPaysage, paragraphe, tableau } from './exportAchevementDocx.js';
import { libelleSituation } from './exportAchevementTexte.js';

/**
 * ═══ LE RAPPORT D'AVANCEMENT (2026-10-17, demande du porteur : « un rapport
 * d'avancement selon formateur / groupe filtré, qui contient un graphe bâtonné
 * et un tableau ») ═══
 *
 * UNE PAGE PAR SUJET CHOISI — un formateur ou un groupe : son résumé (masse
 * affectée, réalisée, reste, taux), un graphe à bâtons « Affecté / Réalisé »
 * par module, puis le tableau des mêmes modules.
 *
 * ⚠️ L'ÉCRAN ENVOIE SES LIGNES DÉJÀ AGRÉGÉES — la même agrégation que le
 * graphe de la page (`agregerAvancement`), et le total de `totalAvancement`,
 * qui ne compte qu'une fois une séance synchrone mutualisée. Le serveur ne fait
 * que la mise en page, comme pour l'achèvement des modules.
 *
 * ⚠️ UN VRAI GRAPHIQUE WORD, pas une image : il se modifie dans Word (ses
 * données sont dans un classeur incorporé), et LibreOffice le dessine pour le
 * PDF depuis les valeurs mises en cache dans le graphique lui-même.
 */

const LIBELLES = {
  formateur: { sujet: 'Formateur', complement: 'Groupe' },
  groupe: { sujet: 'Groupe', complement: 'Formateur(s)' },
};

const FACES = {
  edtpro: 'eDTpro — séances posées dans l’emploi du temps',
  enote: 'E-note — heures déclarées dans le système national',
};

/** « 12,5 » — une décimale au plus, à la française. */
const heures = (valeur) => Number(valeur ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const pourcentage = (valeur) => (valeur === null ? '—' : `${heures(valeur)} %`);

/** Le graphe : 24 cm × 7,5 cm (en EMU, 360 000 par cm). */
const LARGEUR_GRAPHE = 24 * 360000;
const HAUTEUR_GRAPHE = Math.round(7.5 * 360000);

export async function construireRapportAvancement({ etablissementId, anneeScolaire, format, ...contenu }) {
  const etablissement = await Etablissement.findById(etablissementId).select('nom').lean();
  if (format === 'xlsx') {
    return {
      tampon: await construireXlsxRapport({
        etablissement: etablissement ?? {},
        type: contenu.type,
        rapports: contenu.rapports,
        libelles: LIBELLES[contenu.type],
        informations: informationsDu({ anneeScolaire, ...contenu }),
      }),
      nomFichier: `${nomFichier(contenu)}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
  const docx = await construireDocxRapport({ etablissement: etablissement ?? {}, anneeScolaire, ...contenu });
  const nom = nomFichier(contenu);

  if (format === 'docx') {
    return {
      tampon: docx,
      nomFichier: `${nom}.docx`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  return { tampon: await convertirDocxEnPdf(docx), nomFichier: `${nom}.pdf`, contentType: 'application/pdf' };
}

function nomFichier({ type, rapports }) {
  const base = `Rapport_avancement_${LIBELLES[type].sujet}`;
  if (rapports.length !== 1) return `${base}s_${rapports.length}`;
  return `${base}_${rapports[0].sujet}`.replace(/[^\p{L}\p{N}_-]+/gu, '_');
}

/** La ligne d'informations sous l'en-tête : l'année, la face, la date observée. */
const informationsDu = ({ anneeScolaire, face, dateObservee }) =>
  [`Année de Formation : ${anneeScolaire}-${anneeScolaire + 1}`, FACES[face] ?? null, libelleSituation(dateObservee)]
    .filter(Boolean)
    .join('   —   ');

export async function construireDocxRapport({ etablissement, anneeScolaire, type, face, dateObservee, rapports }) {
  const libelles = LIBELLES[type];
  const informations = informationsDu({ anneeScolaire, face, dateObservee });

  const colonnes = [
    { id: 'numero', entete: 'N°' },
    ...(type === 'formateur' ? [{ id: 'complement', entete: libelles.complement }] : []),
    { id: 'module', entete: 'Module' },
    { id: 'intitule', entete: 'Intitulé' },
    ...(type === 'groupe' ? [{ id: 'complement', entete: libelles.complement }] : []),
    { id: 'affecte', entete: 'Affecté (h)' },
    { id: 'realise', entete: 'Réalisé (h)' },
    { id: 'reste', entete: 'Reste (h)' },
    { id: 'taux', entete: 'Taux' },
  ];
  const POIDS = { numero: 3, complement: type === 'groupe' ? 16 : 9, module: 7, intitule: 30, affecte: 7, realise: 7, reste: 7, taux: 6 };
  const somme = colonnes.reduce((total, c) => total + POIDS[c.id], 0);
  const largeurs = colonnes.map((c) => Math.floor((POIDS[c.id] / somme) * LARGEUR_UTILE_PAYSAGE));
  const centrees = new Set(['numero', 'module', 'affecte', 'realise', 'reste', 'taux', ...(type === 'formateur' ? ['complement'] : [])]);

  const pages = rapports.map((rapport, rang) => {
    const reste = Math.max(0, rapport.total.affecte - rapport.total.realise);
    const resume = [
      `Masse affectée : ${heures(rapport.total.affecte)} h`,
      `Réalisée : ${heures(rapport.total.realise)} h`,
      `Reste : ${heures(reste)} h`,
      `Taux d’avancement : ${pourcentage(taux(rapport.total.realise, rapport.total.affecte))}`,
    ].join('   —   ');

    const lignes = rapport.lignes.map((ligne, index) =>
      colonnes.map(({ id }) => {
        if (id === 'numero') return String(index + 1);
        if (id === 'affecte') return heures(ligne.affecte);
        if (id === 'realise') return heures(ligne.realise);
        if (id === 'reste') return heures(Math.max(0, ligne.affecte - ligne.realise));
        if (id === 'taux') return pourcentage(taux(ligne.realise, ligne.affecte));
        return String(ligne[id] ?? '');
      })
    );

    return (
      (rang === 0 ? '' : SAUT_DE_PAGE) +
      paragraphe(informations, { centre: true, apres: 60 }) +
      paragraphe(`${libelles.sujet} : ${rapport.sujet}`, { gras: true, taille: 26, centre: true, apres: 40 }) +
      paragraphe(
        `${resume}   —   ${rapport.lignes.length} module(s)`,
        { gras: true, centre: true, apres: 120 }
      ) +
      (rapport.lignes.length > 0 ? grapheEnLigne(rang + 1) : '') +
      tableau(colonnes, lignes, { largeurs, centrees })
    );
  });

  return construireDocxPaysage({
    etablissement,
    titre: 'Rapport d’avancement',
    corps: pages.join('') + '<w:p/>',
    enteteCompact: true,
    completer: (zip) => ajouterGraphes(zip, rapports, type),
  });
}

/** La référence du graphique `numero` dans les relations du document. */
const relationGraphe = (numero) => `rIdRapportGraphe${numero}`;

/** Le paragraphe qui porte le graphique `numero`, centré. */
function grapheEnLigne(numero) {
  return (
    '<w:p><w:pPr><w:spacing w:before="0" w:after="120"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${LARGEUR_GRAPHE}" cy="${HAUTEUR_GRAPHE}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    `<wp:docPr id="${9000 + numero}" name="Graphique ${numero}"/><wp:cNvGraphicFramePr/>` +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
    '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ' +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${relationGraphe(numero)}"/>` +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
  );
}

/** Ajoute au paquet Word un graphique (et son classeur) par rapport qui a des lignes. */
async function ajouterGraphes(zip, rapports, type) {
  const avecLignes = rapports.map((rapport, rang) => ({ rapport, numero: rang + 1 })).filter(({ rapport }) => rapport.lignes.length > 0);
  if (avecLignes.length === 0) return;

  const cheminRelations = 'word/_rels/document.xml.rels';
  let relations = await zip.file(cheminRelations).async('string');
  let types = await zip.file('[Content_Types].xml').async('string');
  if (!types.includes('Extension="xlsx"')) {
    types = types.replace(
      '<Default ',
      '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/><Default '
    );
  }

  for (const { rapport, numero } of avecLignes) {
    const grille = grilleDuGraphe(rapport.lignes.map((ligne) => ({ ...ligne, etiquette: etiquetteDe(type, ligne) })));

    zip.file(`word/charts/chart${numero}.xml`, xmlGraphe(grille));
    zip.file(
      `word/charts/_rels/chart${numero}.xml.rels`,
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" ' +
        `Target="../embeddings/Classeur_graphique${numero}.xlsx"/></Relationships>`
    );
    zip.file(`word/embeddings/Classeur_graphique${numero}.xlsx`, await classeurGraphe(grille));

    relations = relations.replace(
      '</Relationships>',
      `<Relationship Id="${relationGraphe(numero)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart${numero}.xml"/></Relationships>`
    );
    types = types.replace(
      '</Types>',
      `<Override PartName="/word/charts/chart${numero}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`
    );
  }

  zip.file(cheminRelations, relations);
  zip.file('[Content_Types].xml', types);
}

/** Les données du graphique, dans le classeur que Word ouvre pour les modifier. */
async function classeurGraphe(grille) {
  const classeur = new ExcelJS.Workbook();
  const feuille = classeur.addWorksheet('Feuil1');
  feuille.addRow(ENTETES_GRILLE);
  for (const ligne of grille) feuille.addRow(ligne);
  feuille.getColumn(1).width = 24;
  return Buffer.from(await classeur.xlsx.writeBuffer());
}
