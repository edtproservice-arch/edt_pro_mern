import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { badRequest } from '../../lib/httpError.js';
import { chargerCanevasTampon } from '../seances/canevasCache.js';
import { convertirDocxEnPdf } from '../seances/libreOffice.js';

/**
 * Les formulaires d'examen VIERGES de la carte « Examen » (2026-10-11, demande
 * du porteur : « en exam en document ajoute ces documents », treize canevas
 * transmis, puis « avec le logo »).
 *
 * ═══ DES FORMULAIRES NATIONAUX, REMPLIS À LA MAIN ═══ Enveloppes, PV de
 * fraude, accusés de réception, fiches d'examens pratiques… : chacun porte des
 * lignes pointillées que la commission d'examen remplit le jour même (session,
 * épreuve, salle, surveillants). On les sert donc TELS QUELS, en Word ou en PDF.
 *
 * ═══ LE LOGO OFPPT, FLOTTANT DANS LA MARGE HAUTE ═══ Les canevas transmis
 * n'ont ni en-tête ni logo, et leurs pages sont pleines (le PV de report des
 * notes porte soixante lignes). Un en-tête classique pousserait le contenu et
 * ferait déborder certaines pages sur une seconde. Le logo est donc ANCRÉ à la
 * page, à gauche, sans habillage, centré sur la hauteur du cadre de titre
 * (2026-10-12) : il ne déplace rien, et le cadre — en retrait — ne passe pas
 * dessous. Voir `hauteurDuLogo` ; et `alignerLignesASaisir` pour les « : …… ».
 *
 * ⚠️ « APTOS » → « CALIBRI », comme les autres canevas : Aptos n'existe pas sur
 * le serveur et LibreOffice la remplaçait par une police plus grasse en PDF.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOSSIER = path.join(__dirname, 'canevas', 'examen');

/** clé → nom de fichier téléchargé. Le canevas est `canevas/examen/<clé>.docx`. */
export const FORMULAIRES_EXAMEN = {
  'accuse-copies-corriger': 'Accuse_Reception_Copies_Corriger',
  'accuse-depot-retrait': 'Accuse_Reception_Depot_Retrait',
  'cr-conseil-discipline': 'CR_Conseil_Discipline',
  'enveloppe-a': 'Enveloppe_A',
  'enveloppe-b': 'Enveloppe_B',
  'enveloppe-c': 'Enveloppe_C',
  'presence-surveillants': 'Feuille_Presence_Surveillants',
  'deroulement-pratiques': 'Fiche_Deroulement_Examens_Pratiques',
  'preparation-pratiques': 'Fiche_Preparation_Examens_Pratiques',
  'pv-fraude-correction': 'PV_Fraude_Correction',
  'pv-fraude-deroulement': 'PV_Fraude_Deroulement',
  'pv-ouverture-enveloppes': 'PV_Ouverture_Enveloppes',
  'pv-report-notes': 'PV_Report_Notes',
};

/** 1 twip = 635 EMU. */
const EMU_PAR_TWIP = 635;

/**
 * Le logo des autres canevas : 485 × 551 px, recadré de 10,4 % en bas (son
 * ombre portée) — ici à ~1,8 cm de large (2026-10-12, « agrandi un peu ») : il
 * tient encore à gauche du cadre de titre de chacun des treize canevas.
 */
const LARGEUR_LOGO = 650000;
const HAUTEUR_LOGO = Math.round((LARGEUR_LOGO * 713105) / 704850);
/** Repli quand le cadre du titre ne se lit pas : en haut de la page. */
const HAUT_LOGO_PAR_DEFAUT = 150000;

const RELATION_ENTETE = 'rIdEnteteLogo';
const RELATION_IMAGE = 'rIdLogoOfppt';

function enteteAvecLogo(gauche, haut) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
    ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    // Un paragraphe d'UN point : vide, il prendrait une ligne de texte, et Word
    // repousserait le corps de la page sous l'en-tête — le titre descendrait.
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>' +
    '<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251659264"' +
    ' behindDoc="0" locked="1" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${gauche}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${haut}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${LARGEUR_LOGO}" cy="${HAUTEUR_LOGO}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    '<wp:wrapNone/><wp:docPr id="9001" name="Logo OFPPT"/><wp:cNvGraphicFramePr/>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="logo-ofppt.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill><a:blip r:embed="${RELATION_IMAGE}"/><a:srcRect b="10417"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${LARGEUR_LOGO}" cy="${HAUTEUR_LOGO}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
    '</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p></w:hdr>'
  );
}

/**
 * ═══ LE LOGO SUR LA LIGNE DU TITRE (2026-10-12, demande du porteur) ═══ Chaque
 * formulaire s'ouvre sur un TABLEAU : le cadre du titre, sur sa première ligne.
 * Le logo est centré verticalement sur ce cadre — dont on estime la hauteur :
 * marges de la cellule, puis chaque paragraphe (espacements, et une ligne de
 * texte à ~1,22 fois la taille de sa police, celle de Calibri).
 *
 * @returns {number} le haut du logo, en EMU depuis le haut de la page
 */
function hauteurDuLogo(documentXml) {
  const corps = documentXml.slice(documentXml.indexOf('<w:body>'));
  const haut = Number(documentXml.match(/<w:pgMar\b[^>]*w:top="(\d+)"/)?.[1] ?? 750);
  if (!corps.startsWith('<w:body><w:tbl>')) return HAUT_LOGO_PAR_DEFAUT;

  const rangee = corps.match(/<w:tr\b[\s\S]*?<\/w:tr>/)?.[0];
  if (!rangee) return HAUT_LOGO_PAR_DEFAUT;
  // La cellule du titre : celle qui porte du texte.
  const cellule = (rangee.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).find((tc) => /<w:t[\s>]/.test(tc)) ?? '';

  const margesCellule = cellule.match(/<w:tcMar>[\s\S]*?<\/w:tcMar>/)?.[0] ?? '';
  const marge = (cote) => Number(margesCellule.match(new RegExp(`<w:${cote} w:w="(\\d+)"`))?.[1] ?? 0);
  let hauteur = marge('top') + marge('bottom');

  for (const paragraphe of cellule.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? []) {
    const taille = Number(paragraphe.match(/<w:sz w:val="(\d+)"/)?.[1] ?? 19);
    const avant = Number(paragraphe.match(/<w:spacing\b[^>]*w:before="(\d+)"/)?.[1] ?? 0);
    const apres = Number(paragraphe.match(/<w:spacing\b[^>]*w:after="(\d+)"/)?.[1] ?? 0);
    hauteur += avant + apres + taille * 12.2;
  }

  const centre = (haut + hauteur / 2) * EMU_PAR_TWIP;
  return Math.max(50000, Math.round(centre - HAUTEUR_LOGO / 2));
}

/**
 * ═══ LES « LIBELLÉ : ………… » ALIGNÉS (2026-10-12, demande du porteur) ═══
 * Les canevas alignaient leurs deux-points avec des ESPACES et des tabulations
 * en nombre variable : en police proportionnelle, chaque ligne tombait ailleurs.
 * Chaque ligne « libellé, blancs, deux-points, pointillés » est réécrite en
 * « libellé, UNE tabulation, : …… », et toutes les lignes d'un même bloc
 * (paragraphes consécutifs) reçoivent le MÊME arrêt de tabulation, posé après
 * le plus long de leurs libellés.
 */
const LIGNE_A_SAISIR = /^(.*?\S)[ \t]+:\s*([.…]{3}[\s\S]*)$/u;

/** Un libellé de champ, pas une phrase : court, et sans tabulation (« … Formation ⇥ Session : »). */
const estLibelle = (libelle) => libelle.length <= 60 && !libelle.includes('\t');

/** Le texte d'un paragraphe, tabulations comprises, et les propriétés de son premier et dernier run. */
function lireParagraphe(paragraphe) {
  const runs = paragraphe.match(/<w:r\b[\s\S]*?<\/w:r>/g) ?? [];
  const texte = runs
    .map((run) =>
      (run.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|<w:tab\/>/g) ?? [])
        .map((morceau) => (morceau === '<w:tab/>' ? '\t' : morceau.replace(/<[^>]+>/g, '')))
        .join('')
    )
    .join('');
  const proprietes = (run) => run?.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '';
  return { texte, rprLibelle: proprietes(runs[0]), rprValeur: proprietes(runs.at(-1)) };
}

/** Largeur estimée d'un libellé, en twips — gras, ~0,62 em par caractère. */
const largeurLibelle = (libelle, taille) => libelle.length * taille * 6.2;

const echapper = (texte) =>
  String(texte).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Les éléments qui SUIVENT `<w:tabs>` dans un `<w:pPr>` (ordre du schéma OOXML) :
 * la tabulation s'insère avant le premier présent, jamais dans le `<w:rPr>`.
 */
const APRES_TABS = /<w:(?:suppressAutoHyphens|kinsoku|wordWrap|overflowPunct|topLinePunct|autoSpaceDE|autoSpaceDN|bidi|adjustRightInd|snapToGrid|spacing|ind|contextualSpacing|mirrorIndents|suppressOverlap|jc|textDirection|textAlignment|textboxTightWrap|outlineLvl|divId|cnfStyle|rPr|sectPr|pPrChange)\b/;

function avecTabulation(ppr, tabs) {
  const position = ppr.search(APRES_TABS);
  const fin = position >= 0 ? position : ppr.lastIndexOf('</w:pPr>');
  return ppr.slice(0, fin) + tabs + ppr.slice(fin);
}

function alignerLignesASaisir(documentXml) {
  const lignes = [];

  /*
   * ⚠️ HORS TABLEAU SEULEMENT, ET ALIGNÉES À GAUCHE : dans une cellule étroite
   * (le PV de report des notes) ou sur un « Session : … » calé à droite, une
   * tabulation renvoyait les pointillés à la ligne et faisait déborder la page.
   */
  const tableaux = [...documentXml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map((t) => [t.index, t.index + t[0].length]);
  const dansUnTableau = (position) => tableaux.some(([debut, fin]) => position > debut && position < fin);

  for (const correspondance of documentXml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const paragraphe = correspondance[0];
    if (/<w:drawing/.test(paragraphe) || dansUnTableau(correspondance.index)) continue;
    if (/<w:jc w:val="(?:center|right|end)"/.test(paragraphe)) continue;
    const { texte, rprLibelle, rprValeur } = lireParagraphe(paragraphe);
    const trouve = texte.replace(/ /g, ' ').match(LIGNE_A_SAISIR);
    if (!trouve || !estLibelle(trouve[1].trim())) continue;

    const taille = Number(rprLibelle.match(/<w:sz w:val="(\d+)"/)?.[1] ?? 19);
    const libelle = trouve[1].trim();
    lignes.push({
      debut: correspondance.index,
      fin: correspondance.index + paragraphe.length,
      paragraphe,
      libelle,
      valeur: trouve[2],
      rprLibelle,
      rprValeur,
      largeur: largeurLibelle(libelle, taille),
    });
  }
  if (lignes.length === 0) return documentXml;

  // Les blocs : des lignes consécutives, sans autre paragraphe ni tableau entre elles.
  const blocs = [];
  for (const ligne of lignes) {
    const precedent = blocs.at(-1)?.at(-1);
    const entre = precedent ? documentXml.slice(precedent.fin, ligne.debut) : null;
    if (precedent && !/<w:p\b/.test(entre) && !/<w:tbl>/.test(entre)) blocs.at(-1).push(ligne);
    else blocs.push([ligne]);
  }

  const run = (rpr, contenu) => `<w:r>${rpr}${contenu}</w:r>`;
  const texte = (valeur) => `<w:t xml:space="preserve">${echapper(valeur)}</w:t>`;

  let resultat = '';
  let curseur = 0;
  for (const bloc of blocs) {
    const arret = Math.ceil((Math.max(...bloc.map((l) => l.largeur)) + 300) / 250) * 250;
    const tabs = `<w:tabs><w:tab w:val="left" w:pos="${arret}"/></w:tabs>`;

    for (const ligne of bloc) {
      const ouverture = ligne.paragraphe.match(/^<w:p\b[^>]*>/)[0];
      let ppr = ligne.paragraphe.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '<w:pPr></w:pPr>';
      ppr = avecTabulation(ppr.replace(/<w:tabs>[\s\S]*?<\/w:tabs>/, ''), tabs);

      const nouveau =
        ouverture +
        ppr +
        run(ligne.rprLibelle, texte(ligne.libelle)) +
        run(ligne.rprLibelle, '<w:tab/>') +
        run(ligne.rprValeur, texte(`:  ${ligne.valeur}`)) +
        '</w:p>';
      resultat += documentXml.slice(curseur, ligne.debut) + nouveau;
      curseur = ligne.fin;
    }
  }
  return resultat + documentXml.slice(curseur);
}

/** Greffe l'en-tête au logo dans le paquet Word : partie, relations, types, référence. */
async function ajouterLogo(zip) {
  const logo = await chargerCanevasTampon(path.join(DOSSIER, 'logo-ofppt.png'));

  let documentXml = await zip.file('word/document.xml').async('string');
  const marge = Number(documentXml.match(/<w:pgMar\b[^>]*w:left="(\d+)"/)?.[1] ?? 750);

  zip.file('word/media/logo-ofppt.png', logo);
  zip.file('word/headerLogo.xml', enteteAvecLogo(marge * EMU_PAR_TWIP, hauteurDuLogo(documentXml)));
  zip.file(
    'word/_rels/headerLogo.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="${RELATION_IMAGE}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo-ofppt.png"/>` +
      '</Relationships>'
  );

  const rels = await zip.file('word/_rels/document.xml.rels').async('string');
  zip.file(
    'word/_rels/document.xml.rels',
    rels.replace(
      '</Relationships>',
      `<Relationship Id="${RELATION_ENTETE}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="headerLogo.xml"/></Relationships>`
    )
  );

  let types = await zip.file('[Content_Types].xml').async('string');
  if (!/Extension="png"/i.test(types)) {
    types = types.replace('<Default Extension="xml"', '<Default Extension="png" ContentType="image/png"/><Default Extension="xml"');
  }
  types = types.replace(
    '</Types>',
    '<Override PartName="/word/headerLogo.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
  );
  zip.file('[Content_Types].xml', types);

  // La référence d'en-tête se place en TÊTE du `sectPr` (ordre imposé par le schéma).
  documentXml = documentXml.replace(
    /<w:sectPr\b([^>]*)>/g,
    /*
     * PREMIÈRE PAGE SEULEMENT (`titlePg`) : le logo est calé sur le titre, qui
     * n'existe qu'en page 1 — ailleurs, il tomberait sur le contenu.
     */
    (ouverture) => `${ouverture}<w:headerReference w:type="first" r:id="${RELATION_ENTETE}"/>`
  );
  // `<w:titlePg/>` active l'en-tête de première page ; il précède `<w:docGrid>` dans le schéma.
  documentXml = documentXml.replace(/(<w:docGrid\b|<\/w:sectPr>)/, '<w:titlePg/>$1');
  /*
   * ⚠️ L'EN-TÊTE COLLÉ AU BORD (2026-10-12, signalé par le porteur sur la fiche
   * de déroulement et l'accusé de dépôt) : à 708 twips du haut, l'en-tête
   * finissait SOUS la marge haute de ces canevas (426 et 650) — Word faisait
   * alors descendre tout le corps, et le titre passait sous le logo, qui ne
   * suivait pas. À 100 twips, l'en-tête tient dans la marge.
   */
  documentXml = documentXml.replace(/(<w:pgMar\b[^>]*w:header=")\d+"/, '$1100"');
  zip.file('word/document.xml', documentXml);
}

/**
 * ⚠️ LE PARAGRAPHE VIDE QUI SUIT LE DERNIER TABLEAU (Word en impose un) faisait
 * déborder trois canevas sur une seconde page BLANCHE — le logo la rendait
 * visible. Réduit à un point de haut, il tient sur la première.
 */
async function reduireParagrapheFinal(zip) {
  const xml = await zip.file('word/document.xml').async('string');
  const finTableau = xml.lastIndexOf('</w:tbl>');
  const sectPr = xml.lastIndexOf('<w:sectPr');
  if (finTableau < 0 || sectPr < finTableau) return;

  const queue = xml.slice(finTableau + '</w:tbl>'.length, sectPr);
  // Seulement s'il n'y a QUE des paragraphes vides entre le tableau et la mise en page.
  if (/<w:t[\s>]/.test(queue) || /<w:drawing/.test(queue)) return;

  const minuscule =
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>' +
    '<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>';
  zip.file(
    'word/document.xml',
    xml.slice(0, finTableau + '</w:tbl>'.length) + minuscule + xml.slice(sectPr)
  );
}

export async function construireFormulaireExamen(cle, format) {
  const nom = FORMULAIRES_EXAMEN[cle];
  if (!nom) throw badRequest(`Formulaire d’examen inconnu : « ${cle} »`, { code: 'FORMULAIRE_INCONNU' });

  const zip = await JSZip.loadAsync(await chargerCanevasTampon(path.join(DOSSIER, `${cle}.docx`)));
  await ajouterLogo(zip);

  await reduireParagrapheFinal(zip);
  const documentXml = await zip.file('word/document.xml').async('string');
  zip.file('word/document.xml', alignerLignesASaisir(documentXml));

  for (const partie of ['word/styles.xml', 'word/document.xml']) {
    const fichier = zip.file(partie);
    if (fichier) zip.file(partie, (await fichier.async('string')).replaceAll('Aptos', 'Calibri'));
  }

  const docx = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  if (format === 'pdf') {
    return { tampon: await convertirDocxEnPdf(docx), nomFichier: `${nom}.pdf`, contentType: 'application/pdf' };
  }
  return {
    tampon: docx,
    nomFichier: `${nom}.docx`,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}
