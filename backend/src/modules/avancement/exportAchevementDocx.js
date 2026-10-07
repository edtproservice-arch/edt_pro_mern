import JSZip from 'jszip';
import { echapperXml } from '../seances/xmlCellules.js';
import { chargerCanevasTampon } from '../seances/canevasCache.js';
import { remplacerBalise } from '../seances/xmlTableaux.js';
import { CHEMIN_CANEVAS_AFFECTATION } from '../base/exportAffectationFormateurDocx.js';
import { largeursColonnes, libelleSituation, nomFichierAchevement } from './exportAchevementTexte.js';

/**
 * Le Word du détail « Achèvement des modules » (2026-10-07, demande du porteur).
 *
 * ═══ L'EN-TÊTE DU CANEVAS D'AFFECTATION, LE CORPS CONSTRUIT ═══ Aucun canevas
 * n'a été transmis pour ce document : on reprend l'en-tête officiel de
 * `affectationFormateur.docx` — logo OFPPT, titre, nom de l'établissement —
 * pour que les documents de l'établissement se ressemblent, et on écrit le
 * corps : une ligne d'informations, puis un tableau dont les colonnes sont
 * celles de la fenêtre.
 *
 * ⚠️ EN PAYSAGE : neuf ou dix colonnes ne tiennent pas en portrait sans rendre
 * l'intitulé du module illisible. L'en-tête est élargi d'autant.
 */

const TITRE_CANEVAS = 'Affectation Annuelle Formateur';
const ETABLISSEMENT_CANEVAS = 'INSTITUT SPECIALISE DE TECHNOLOGIE APPLIQUEE SIDI HAJJAJ OUED HASSAR';

/** A4 paysage, marges de 850 twips de part et d'autre (celles du canevas). */
const LARGEUR_PAGE = 16838;
const HAUTEUR_PAGE = 11906;
const LARGEUR_UTILE = LARGEUR_PAGE - 2 * 850;

const BORDURES =
  '<w:tcBorders>' +
  ['top', 'left', 'bottom', 'right']
    .map((cote) => `<w:${cote} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
    .join('') +
  '</w:tcBorders>';
const MARGES =
  '<w:tcMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar>';

function run(texte, { gras = false, taille = 16 } = {}) {
  return (
    '<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
    (gras ? '<w:b/><w:bCs/>' : '') +
    `<w:color w:val="000000"/><w:sz w:val="${taille}"/><w:szCs w:val="${taille}"/></w:rPr>` +
    `<w:t xml:space="preserve">${echapperXml(texte)}</w:t></w:r>`
  );
}

function paragraphe(texte, { gras = false, taille = 18, centre = false, apres = 80 } = {}) {
  return (
    `<w:p><w:pPr><w:spacing w:before="0" w:after="${apres}"/>${centre ? '<w:jc w:val="center"/>' : ''}</w:pPr>` +
    run(texte, { gras, taille }) +
    '</w:p>'
  );
}

function cellule(texte, largeur, { entete = false, centre = false } = {}) {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${largeur}" w:type="dxa"/>${BORDURES}` +
    (entete ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : '') +
    `${MARGES}<w:vAlign w:val="center"/></w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/>${centre ? '<w:jc w:val="center"/>' : ''}</w:pPr>` +
    run(texte, { gras: entete }) +
    '</w:p></w:tc>'
  );
}

function tableau(colonnes, lignes) {
  const largeurs = largeursColonnes(colonnes, LARGEUR_UTILE);
  const centrees = new Set(['semestre', 'regional', 'debut', 'fin', 'source', 'affecte', 'realise', 'taux', 'statut']);

  const grille = largeurs.map((largeur) => `<w:gridCol w:w="${largeur}"/>`).join('');
  // `tblHeader` : la ligne d'en-tête se répète en haut de chaque page.
  const entete =
    '<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' +
    colonnes.map((colonne, rang) => cellule(colonne.entete, largeurs[rang], { entete: true, centre: true })).join('') +
    '</w:tr>';
  const corps = lignes
    .map(
      (ligne) =>
        '<w:tr><w:trPr><w:cantSplit/></w:trPr>' +
        colonnes
          .map((colonne, rang) => cellule(ligne[rang] ?? '', largeurs[rang], { centre: centrees.has(colonne.id) }))
          .join('') +
        '</w:tr>'
    )
    .join('');

  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${LARGEUR_UTILE}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    '<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${grille}</w:tblGrid>${entete}${corps}</w:tbl>`
  );
}

/** L'en-tête du canevas, élargi à la page paysage et retitré. */
function entetePaysage(xml, etablissement) {
  const portrait = 10206;
  const celluleTitre = 8706;
  const elargi = LARGEUR_UTILE - portrait;

  let resultat = xml
    .replaceAll('Aptos', 'Calibri')
    .replace(`<w:tblW w:w="${portrait}"`, `<w:tblW w:w="${LARGEUR_UTILE}"`)
    .replace(`<w:gridCol w:w="${celluleTitre}"/>`, `<w:gridCol w:w="${celluleTitre + elargi}"/>`)
    .replace(`<w:tcW w:w="${celluleTitre}"`, `<w:tcW w:w="${celluleTitre + elargi}"`);
  resultat = remplacerBalise(resultat, TITRE_CANEVAS, 'Achèvement des modules');
  return remplacerBalise(resultat, ETABLISSEMENT_CANEVAS, echapperXml(etablissement?.nom ?? ''));
}

export async function construireDocxAchevement(donnees) {
  const { etablissement, anneeScolaire, resume, dateObservee, colonnes, lignes } = donnees;

  const zip = await JSZip.loadAsync(await chargerCanevasTampon(CHEMIN_CANEVAS_AFFECTATION));
  const fichierDocument = zip.file('word/document.xml');
  const fichierEntete = zip.file('word/header1.xml');
  if (!fichierDocument || !fichierEntete) {
    throw new Error('Canevas Word illisible : document.xml ou header1.xml absent du modèle');
  }

  zip.file('word/header1.xml', entetePaysage(await fichierEntete.async('string'), etablissement));
  const fichierStyles = zip.file('word/styles.xml');
  if (fichierStyles) {
    zip.file('word/styles.xml', (await fichierStyles.async('string')).replaceAll('Aptos', 'Calibri'));
  }

  const xml = await fichierDocument.async('string');
  const debutCorps = xml.indexOf('<w:body>') + '<w:body>'.length;
  const debutSectPr = xml.lastIndexOf('<w:sectPr');
  if (debutSectPr <= debutCorps) throw new Error('Canevas Word illisible : la mise en page (sectPr) est absente');

  const sectPr = xml
    .slice(debutSectPr, xml.indexOf('</w:body>'))
    .replace(/<w:pgSz\b[^>]*\/>/, `<w:pgSz w:w="${LARGEUR_PAGE}" w:h="${HAUTEUR_PAGE}" w:orient="landscape"/>`);

  const informations = [
    `Année de Formation : ${anneeScolaire}-${anneeScolaire + 1}`,
    libelleSituation(dateObservee),
  ]
    .filter(Boolean)
    .join('   —   ');

  const corps =
    paragraphe(informations, { centre: true }) +
    paragraphe(resume, { gras: true, centre: true, apres: 160 }) +
    tableau(colonnes, lignes) +
    '<w:p/>';

  zip.file('word/document.xml', xml.slice(0, debutCorps) + corps + sectPr + '</w:body></w:document>');

  return {
    tampon: await zip.generateAsync({ type: 'nodebuffer' }),
    nomFichier: nomFichierAchevement('docx'),
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}
