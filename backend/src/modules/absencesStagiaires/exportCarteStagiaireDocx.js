import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { echapperXml } from '../seances/xmlCellules.js';

/**
 * ═══ LE BADGE STAGIAIRE (2026-10-11) ═══ Composé ici, d'après le canevas
 * transmis par le porteur (le 2e, après une première proposition) :
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ [logo] BADGE STAGIAIRE                 [QR]  │  bandeau bleu
 *   │        2026-2027                              │
 *   ├────────────┬──────────────────────────────────┤
 *   │            │ NOM & PRÉNOM                     │
 *   │   Photo    │ ABBAOUI WALID       (nom arabe)  │
 *   │ (à coller) │ FILIÈRE                          │
 *   │            │ Développement Digital …          │
 *   │            │ GROUPE        MATRICULE          │
 *   │            │ DEVOWFS201    2006113000155      │
 *   ├────────────┴──────────────────────────────────┤  filet vert
 *   │        NOM COMPLET DE L'ÉTABLISSEMENT (vert)   │
 *   └──────────────────────────────────────────────┘
 *
 * Format carte bancaire (CR80, 85,6 × 54 mm), DIX PAR PAGE A4 (2 × 5) à découper.
 *
 * ⚠️ LA PHOTO EST UN CADRE À COLLER (décision du porteur, 2026-10-11) : aucune
 * photo n'est enregistrée dans l'application.
 *
 * ⚠️ HAUTEURS EXACTES (`hRule="exact"`) et paragraphes de fin réduits à 1 pt :
 * dix cartes remplissent la page au millimètre près, et le moindre paragraphe
 * de taille normale ferait naître une page blanche (le défaut corrigé sur le
 * formulaire de transfert).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHEMIN_LOGO = path.join(__dirname, 'canevas', 'logoOfppt.png');

// 1 mm = 56,7 twips ; 1 mm = 36 000 EMU (les dimensions des images).
const MM = 56.7;
const EMU_MM = 36000;

const LARGEUR_CARTE = Math.round(85.6 * MM); // 4854
const HAUTEUR_CARTE = Math.round(54 * MM); // 3062
const HAUTEUR_BANDEAU = 880;
const HAUTEUR_PIED = 470;
const HAUTEUR_CORPS = HAUTEUR_CARTE - HAUTEUR_BANDEAU - HAUTEUR_PIED;
const ECART_COLONNES = 560;
const ECART_LIGNES = 110;
const CARTES_PAR_PAGE = 10;

/*
 * ⚠️ UNE GRILLE DE QUATRE COLONNES pour trois rangées différentes :
 *   bandeau = logo | titre (2 colonnes) | QR
 *   corps   = photo (2 colonnes) | identité (2 colonnes)
 *   pied    = les 4
 * Sans grille commune, Word recalcule les largeurs à sa façon et les zones se décalent.
 */
const LARGEUR_LOGO = 700;
const LARGEUR_PHOTO = 1500;
const LARGEUR_QR = 930;
const GRILLE = [
  LARGEUR_LOGO,
  LARGEUR_PHOTO - LARGEUR_LOGO,
  LARGEUR_CARTE - LARGEUR_PHOTO - LARGEUR_QR,
  LARGEUR_QR,
];

const COULEURS = {
  bandeau: '1F5FAD', // bleu
  pied: '1E9E5A', // vert
  valeur: '111827',
  libelle: '8A94A6',
  bordure: 'C7CDD6',
  cadrePhoto: 'B8BFCA',
};

const PARAGRAPHE_MINUSCULE =
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>' +
  '<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>';
const SAUT_DE_PAGE =
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>' +
  '<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr>' +
  '<w:r><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr><w:br w:type="page"/></w:r></w:p>';

function run(texte, { taille = 13, gras = false, couleur = COULEURS.valeur, majuscules = false, arabe = false } = {}) {
  // ⚠️ L'ARABE : `w:rtl` pour l'ordre des lettres, et la taille en `szCs` — Word la lit là pour l'écriture complexe.
  const police = arabe
    ? '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>'
    : '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>';
  return (
    `<w:r><w:rPr>${police}${gras ? '<w:b/><w:bCs/>' : ''}` +
    `${majuscules ? '<w:caps/>' : ''}<w:color w:val="${couleur}"/><w:sz w:val="${taille}"/><w:szCs w:val="${taille}"/>` +
    `${arabe ? '<w:rtl/>' : ''}</w:rPr>` +
    `<w:t xml:space="preserve">${echapperXml(texte)}</w:t></w:r>`
  );
}

function paragraphe(contenu, { centre = false, droite = false, apres = 0, tabulation = null, filetHaut = null } = {}) {
  return (
    '<w:p><w:pPr>' +
    // `filetHaut` : le trait vert au-dessus du nom de l'établissement.
    (filetHaut ? `<w:pBdr><w:top w:val="single" w:sz="8" w:space="2" w:color="${filetHaut}"/></w:pBdr>` : '') +
    (tabulation ? `<w:tabs><w:tab w:val="left" w:pos="${tabulation}"/></w:tabs>` : '') +
    `<w:spacing w:before="0" w:after="${apres}" w:line="240" w:lineRule="auto"/>` +
    `${centre ? '<w:jc w:val="center"/>' : droite ? '<w:jc w:val="right"/>' : ''}</w:pPr>${contenu}</w:p>`
  );
}

const bordures = (valeur, couleur = COULEURS.bordure, taille = 6) =>
  ['top', 'left', 'bottom', 'right']
    .map((cote) => `<w:${cote} w:val="${valeur}" w:sz="${taille}" w:space="0" w:color="${couleur}"/>`)
    .join('');

function cellule(contenu, largeur, { fond, alignement = 'center', marges = 60, fusion = 1, contour = false } = {}) {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${largeur}" w:type="dxa"/>${fusion > 1 ? `<w:gridSpan w:val="${fusion}"/>` : ''}` +
    // `contour` : le trait fin autour d'une carte — le guide de découpe.
    `<w:tcBorders>${contour ? bordures('single', COULEURS.bordure, 4) : bordures('nil')}</w:tcBorders>` +
    (fond ? `<w:shd w:val="clear" w:color="auto" w:fill="${fond}"/>` : '') +
    `<w:tcMar><w:top w:w="${marges}" w:type="dxa"/><w:left w:w="${marges + 20}" w:type="dxa"/>` +
    `<w:bottom w:w="${marges}" w:type="dxa"/><w:right w:w="${marges + 20}" w:type="dxa"/></w:tcMar>` +
    `<w:vAlign w:val="${alignement}"/></w:tcPr>${contenu}</w:tc>`
  );
}

const ligne = (hauteur, cellules) =>
  `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${hauteur}" w:hRule="exact"/></w:trPr>${cellules}</w:tr>`;

function tableau(largeurs, lignes, { bordure = 'nil', couleur = COULEURS.bordure, centre = false } = {}) {
  const total = largeurs.reduce((a, b) => a + b, 0);
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/>${centre ? '<w:jc w:val="center"/>' : ''}` +
    `<w:tblBorders>${bordures(bordure, couleur)}<w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>` +
    '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${largeurs.map((l) => `<w:gridCol w:w="${l}"/>`).join('')}</w:tblGrid>${lignes}</w:tbl>`
  );
}

/** Une image EN LIGNE, référencée par sa relation `rId`. */
function image(rId, idDessin, largeurMm, hauteurMm, nom) {
  const cx = Math.round(largeurMm * EMU_MM);
  const cy = Math.round(hauteurMm * EMU_MM);
  return (
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${idDessin}" name="${nom}"/>` +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:nvPicPr><pic:cNvPr id="${idDessin}" name="${nom}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r>'
  );
}

/**
 * Un libellé de champ, gris (« NOM & PRÉNOM », « FILIÈRE »…). ⚠️ ÉCRIT EN
 * CAPITALES, pas mis en capitales par Word (`w:caps`) : la transformation de
 * Word perdait les accents (« PRENOM », « FILIERE »).
 */
const libelle = (texte) => run(texte, { taille: 10, couleur: COULEURS.libelle });
const TAB = '<w:r><w:tab/></w:r>';
// Un peu d'air sous le bandeau, avant « NOM & PRÉNOM ».
const PARAGRAPHE_ESPACE =
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="80" w:lineRule="exact"/>' +
  '<w:rPr><w:sz w:val="4"/></w:rPr></w:pPr></w:p>';

/**
 * Un badge. `carte` : { nomComplet, nomArabe, matricule, groupe, filiere,
 * etablissement, annee, qr: { rId } | null }.
 */
function construireCarte(carte, ids) {
  const bandeau = ligne(
    HAUTEUR_BANDEAU,
    cellule(paragraphe(image('rIdLogo', ids.suivant(), 10, 11.4, 'Logo OFPPT'), { centre: true }), LARGEUR_LOGO, {
      fond: COULEURS.bandeau,
      marges: 20,
    }) +
      cellule(
        paragraphe(run('Badge stagiaire', { taille: 20, gras: true, couleur: 'FFFFFF', majuscules: true }), { apres: 20 }) +
          paragraphe(run(carte.annee, { taille: 13, gras: true, couleur: 'FFFFFF' })),
        GRILLE[1] + GRILLE[2],
        { fond: COULEURS.bandeau, marges: 30, fusion: 2 }
      ) +
      cellule(
        carte.qr
          ? paragraphe(image(carte.qr.rId, ids.suivant(), 13, 13, `QR ${carte.matricule}`), { centre: true })
          : // Sans compte, le QR ne mènerait nulle part : on le dit plutôt que d'imprimer un code mort.
            paragraphe(run('Compte non créé', { taille: 9, couleur: 'DBEAFE' }), { centre: true }),
        LARGEUR_QR,
        { fond: COULEURS.bandeau, marges: 20 }
      )
  );

  // Le cadre photo : un petit tableau au trait fin, « Photo » au centre.
  const cadrePhoto = tableau(
    [1250],
    ligne(
      1560,
      `<w:tc><w:tcPr><w:tcW w:w="1250" w:type="dxa"/><w:tcBorders>${bordures('single', COULEURS.cadrePhoto, 6)}</w:tcBorders>` +
        '<w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/><w:vAlign w:val="center"/></w:tcPr>' +
        paragraphe(run('Photo', { taille: 11, gras: true, couleur: COULEURS.libelle }), { centre: true }) +
        '</w:tc>'
    ),
    { centre: true }
  );

  // Groupe et matricule côte à côte : une tabulation, à mi-largeur de la zone d'identité.
  const milieu = 1250;
  const identite =
    PARAGRAPHE_ESPACE +
    paragraphe(libelle('NOM & PRÉNOM')) +
    paragraphe(run(carte.nomComplet, { taille: 18, gras: true }), { apres: carte.nomArabe ? 0 : 70 }) +
    (carte.nomArabe
      ? paragraphe(run(carte.nomArabe, { taille: 18, gras: true, arabe: true }), { droite: true, apres: 40 })
      : '') +
    paragraphe(libelle('FILIÈRE')) +
    paragraphe(run(carte.filiere || '—', { taille: 13, gras: true }), { apres: 70 }) +
    paragraphe(libelle('GROUPE') + TAB + libelle('MATRICULE'), { tabulation: milieu }) +
    paragraphe(run(carte.groupe, { taille: 14, gras: true }) + TAB + run(carte.matricule, { taille: 14, gras: true }), {
      tabulation: milieu,
    });

  const corps = ligne(
    HAUTEUR_CORPS,
    cellule(cadrePhoto + PARAGRAPHE_MINUSCULE, LARGEUR_PHOTO, { marges: 40, fusion: 2 }) +
      cellule(identite, GRILLE[2] + GRILLE[3], { marges: 70, fusion: 2, alignement: 'top' })
  );

  // Le pied : un filet vert, puis le nom de l'établissement en vert.
  const pied = ligne(
    HAUTEUR_PIED,
    `<w:tc><w:tcPr><w:tcW w:w="${LARGEUR_CARTE}" w:type="dxa"/><w:gridSpan w:val="4"/>` +
      `<w:tcBorders>${bordures('nil')}</w:tcBorders>` +
      '<w:tcMar><w:left w:w="140" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tcMar>' +
      '<w:vAlign w:val="top"/></w:tcPr>' +
      paragraphe(run(carte.etablissement, { taille: 10, gras: true, couleur: COULEURS.pied, majuscules: true }), {
        centre: true,
        filetHaut: COULEURS.pied,
      }) +
      '</w:tc>'
  );

  return tableau(GRILLE, bandeau + corps + pied, { bordure: 'single', couleur: COULEURS.bordure });
}

/** Une page : jusqu'à dix cartes, deux par rangée. */
function construirePage(cartes, ids) {
  const rangees = [];
  for (let i = 0; i < cartes.length; i += 2) {
    const gauche = construireCarte(cartes[i], ids) + PARAGRAPHE_MINUSCULE;
    const droite = cartes[i + 1] ? construireCarte(cartes[i + 1], ids) + PARAGRAPHE_MINUSCULE : PARAGRAPHE_MINUSCULE;
    if (rangees.length > 0) {
      // L'écart entre deux rangées de cartes : une ligne vide de hauteur exacte.
      rangees.push(ligne(ECART_LIGNES, cellule(PARAGRAPHE_MINUSCULE, LARGEUR_CARTE) + cellule(PARAGRAPHE_MINUSCULE, ECART_COLONNES) + cellule(PARAGRAPHE_MINUSCULE, LARGEUR_CARTE)));
    }
    rangees.push(
      ligne(
        HAUTEUR_CARTE,
        cellule(gauche, LARGEUR_CARTE, { marges: 0, alignement: 'top', contour: true }) +
          cellule(PARAGRAPHE_MINUSCULE, ECART_COLONNES, { marges: 0 }) +
          cellule(droite, LARGEUR_CARTE, { marges: 0, alignement: 'top', contour: Boolean(cartes[i + 1]) })
      )
    );
  }
  return tableau([LARGEUR_CARTE, ECART_COLONNES, LARGEUR_CARTE], rangees.join(''), { centre: true });
}

const ESPACES_DE_NOMS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

/**
 * @param {Array} cartes — voir `construireCarte` ; `qrPng` : le PNG du QR, ou null
 * @returns {Promise<Buffer>} le .docx
 */
export async function construireDocxCartes(cartes) {
  const zip = new JSZip();
  const relations = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>',
  ];
  zip.file('word/media/logo.png', await readFile(CHEMIN_LOGO));

  const avecQr = cartes.map((carte, index) => {
    if (!carte.qrPng) return { ...carte, qr: null };
    const rId = `rIdQr${index + 1}`;
    zip.file(`word/media/qr${index + 1}.png`, carte.qrPng);
    relations.push(
      `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/qr${index + 1}.png"/>`
    );
    return { ...carte, qr: { rId } };
  });

  let compteur = 0;
  const ids = { suivant: () => (compteur += 1) };
  const pages = [];
  for (let i = 0; i < avecQr.length; i += CARTES_PAR_PAGE) pages.push(construirePage(avecQr.slice(i, i + CARTES_PAR_PAGE), ids));

  // Marges : la page centrée sur ses dix cartes (2 × 85,6 mm de large, 5 × 54 mm de haut).
  const margeCote = Math.floor((11906 - 2 * LARGEUR_CARTE - ECART_COLONNES) / 2);
  /*
   * ⚠️ UN PARAGRAPHE D'UN POINT AVANT LE PREMIER TABLEAU : LibreOffice — qui fait
   * le PDF — perdait le bandeau de la toute première carte quand le document
   * s'ouvrait directement sur un tableau (constaté au rendu, 2026-10-11 ; les
   * pages suivantes, elles, étaient justes).
   */
  const corps =
    PARAGRAPHE_MINUSCULE +
    pages.join(SAUT_DE_PAGE) +
    PARAGRAPHE_MINUSCULE +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="300" w:right="${margeCote}" w:bottom="200" w:left="${margeCote}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;

  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>'
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>'
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations.join('')}</Relationships>`
  );
  zip.file(
    'word/styles.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults>' +
      '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="14"/><w:szCs w:val="14"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
      '</w:docDefaults></w:styles>'
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${ESPACES_DE_NOMS}><w:body>${corps}</w:body></w:document>`
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}
