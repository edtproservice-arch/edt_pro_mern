import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { echapperXml } from '../seances/xmlCellules.js';

/**
 * ═══ LE PV D'UNE SANCTION D'ASSIDUITÉ (2026-10-26, demande du porteur) ═══
 * Mise en garde (1ère, 2ème), avertissement (1er, 2ème), blâme — en FRANÇAIS ou en
 * ARABE, au choix. Composé ici plutôt que rempli dans le canevas transmis
 * (`تنبيه ـ اندار ـ توبيخ.docx`) : ses cadres flottants et ses pointillés se
 * déplaçaient d'un logiciel à l'autre, et sa ponctuation s'inversait au PDF
 * (« :التاريخ »). Le TEXTE est celui du canevas ; la mise en page est neuve :
 *
 *   [logo]  Royaume du Maroc                        (en arabe : miroir, logo à droite)
 *           Office de la Formation Professionnelle…
 *           Nom de l'établissement
 *   ┌───────────────────────────────────────┐
 *   │           MISE EN GARDE               │
 *   │        ☒ 1ère        ☐ 2ème           │
 *   └───────────────────────────────────────┘
 *                                    Date : 26/10/2026
 *   Conformément au règlement intérieur … (12,5 heures) …
 *   ┌──────────────────┬──────────────────────┐
 *   │ Nom et prénom    │ ALAOUI Yassine        │  … filière, niveau, année, groupe
 *   └──────────────────┴──────────────────────┘
 *   ┃ Une mise en garde écrite, versée à son dossier … ┃
 *   Signature du stagiaire   Le Surveillant général   (Le Directeur)
 *
 * ⚠️ L'ARABE : `w:bidi` sur chaque paragraphe, `w:bidiVisual` sur chaque tableau
 *    (la première cellule passe à DROITE), `w:rtl` sur chaque passage arabe. Un nom
 *    ou un code latin dans un paragraphe arabe garde son sens de lecture — c'est
 *    l'algorithme bidirectionnel qui les place.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGOS = {
  fr: path.join(__dirname, 'canevas', 'logoOfppt.png'),
  ar: path.join(__dirname, 'canevas', 'logoOfpptAr.png'),
};

// A4, marges de 2 cm : 11 906 − 2 × 1 134 = 9 638 twips de large.
const LARGEUR = 9638;
const COULEURS = { texte: '111827', doux: '4B5563', bordure: '9CA3AF', fond: 'F3F4F6', accent: '1F3A68' };

/* ─────────────────────────── Les textes, par langue ─────────────────────────── */

const RANGS = {
  fr: { 'mise-en-garde': ['1ère', '2ème'], avertissement: ['1er', '2ème'] },
  ar: { 'mise-en-garde': ['الأول', 'الثاني'], avertissement: ['الأول', 'الثاني'] },
};

const NIVEAUX = {
  TS: { fr: 'Technicien spécialisé', ar: 'تقني متخصص' },
  T: { fr: 'Technicien', ar: 'تقني' },
  Q: { fr: 'Qualification', ar: 'تأهيل' },
  S: { fr: 'Spécialisation', ar: 'تخصص' },
};

const ANNEES = {
  fr: (n) => (n === 1 ? '1ère année' : `${n}ème année`),
  ar: (n) => ['', 'السنة الأولى', 'السنة الثانية', 'السنة الثالثة'][n] ?? `السنة ${n}`,
};

/** « 12,5 » : la virgule française, aussi dans le texte arabe (c'est l'usage des PV). */
const nombre = (valeur) => String(Math.round(Number(valeur) * 100) / 100).replace('.', ',');

const TEXTES = {
  fr: {
    entete: ['ROYAUME DU MAROC', 'Office de la Formation Professionnelle et de la Promotion du Travail'],
    titres: { 'mise-en-garde': 'MISE EN GARDE', avertissement: 'AVERTISSEMENT', blame: 'BLÂME' },
    annee: (a) => `Année de formation ${a}-${a + 1}`,
    date: (d) => `Date : ${d}`,
    preambule: (heures) =>
      'Conformément aux dispositions du règlement intérieur des établissements de la formation ' +
      `professionnelle, et compte tenu de ses absences répétées et non justifiées (${nombre(heures)} heure(s)), ` +
      'il est adressé au (à la) stagiaire :',
    champs: ['Nom et prénom', 'N° d’inscription', 'Filière', 'Niveau de formation', 'Année de formation', 'Groupe'],
    decisions: {
      'mise-en-garde': (p) =>
        `Une mise en garde écrite, versée à son dossier, avec retrait de ${nombre(p)} point(s) de la note d’assiduité et de comportement.`,
      avertissement: (p) =>
        `Un avertissement écrit, versé à son dossier, avec retrait de ${nombre(p)} point(s) de la note d’assiduité et de comportement.`,
      blame: () =>
        'Un blâme écrit, versé à son dossier, avec présentation devant le conseil de discipline et application de ' +
        'toutes les mesures découlant de cette sanction disciplinaire.',
    },
    signatures: {
      'mise-en-garde': ['Signature du (de la) stagiaire', 'Le Surveillant général'],
      avertissement: ['Signature du (de la) stagiaire', 'Le Surveillant général', 'Le Directeur de l’établissement'],
      blame: ['Signature du (de la) stagiaire', 'La Commission de gestion pédagogique'],
    },
  },
  ar: {
    entete: ['المملكة المغربية', 'مكتب التكوين المهني وإنعاش الشغل'],
    titres: { 'mise-en-garde': 'تنبيه', avertissement: 'إنذار', blame: 'توبيخ' },
    sousTitres: { 'mise-en-garde': 'Mise en garde', avertissement: 'Avertissement', blame: 'Blâme' },
    // Les chiffres gardent leur ordre dans un texte arabe : « 2026-2027 », comme en français.
    annee: (a) => `السنة التكوينية ${a}-${a + 1}`,
    date: (d) => `التاريخ : ${d}`,
    preambule: (heures) =>
      'طبقا لمقتضيات القانون الداخلي لمؤسسات التكوين المهني، وتبعا للغياب المتكرر وغير المبرر ' +
      `(${nombre(heures)} ساعة)، يوجه للمتدرب(ة) :`,
    champs: ['الاسم الكامل', 'رقم التسجيل', 'الشعبة', 'مستوى التكوين', 'السنة التكوينية', 'الفوج'],
    decisions: {
      'mise-en-garde': (p) => `تنبيه كتابي يسجل بملفه مع خصم ${nombre(p)} نقطة من نقطة المواظبة والسلوك.`,
      avertissement: (p) => `إنذار كتابي يسجل بملفه مع خصم ${nombre(p)} نقطة من نقطة المواظبة والسلوك.`,
      blame: () =>
        'توبيخ كتابي يسجل بملفه مع عرضه على المجلس التأديبي وتطبيق جميع الإجراءات المترتبة عن هذه العقوبة التأديبية.',
    },
    signatures: {
      'mise-en-garde': ['إمضاء المتدرب(ة)', 'مسير شؤون المتدربين'],
      avertissement: ['إمضاء المتدرب(ة)', 'مسير شؤون المتدربين', 'مدير المؤسسة'],
      blame: ['إمضاء المتدرب(ة)', 'لجنة التدبير والتسيير البيداغوجي'],
    },
  },
};

/** Le palier de la grille (points retirés, 1 à 5) → le type de PV et son rang. */
export function typeDuPalier(palier) {
  if (palier === 1 || palier === 2) return { type: 'mise-en-garde', rang: palier - 1 };
  if (palier === 3 || palier === 4) return { type: 'avertissement', rang: palier - 3 };
  if (palier === 5) return { type: 'blame', rang: null };
  return null;
}

/* ─────────────────────────────── Le XML Word ─────────────────────────────── */

const ARABE = /[؀-ۿ]/;

function run(texte, { taille = 22, gras = false, couleur = COULEURS.texte, symbole = false, souligne = false } = {}) {
  const arabe = ARABE.test(texte);
  const police = symbole
    ? '<w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol" w:cs="Segoe UI Symbol"/>'
    : '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/>';
  return (
    `<w:r><w:rPr>${police}${gras ? '<w:b/><w:bCs/>' : ''}${souligne ? '<w:u w:val="single"/>' : ''}` +
    `<w:color w:val="${couleur}"/><w:sz w:val="${taille}"/><w:szCs w:val="${taille + (arabe ? 4 : 0)}"/>` +
    `${arabe ? '<w:rtl/>' : ''}</w:rPr><w:t xml:space="preserve">${echapperXml(texte)}</w:t></w:r>`
  );
}

function paragraphe(contenu, { rtl, centre = false, avant = 0, apres = 120, interligne = 276, cadre = false } = {}) {
  return (
    '<w:p><w:pPr>' +
    (cadre
      ? `<w:pBdr><w:top w:val="single" w:sz="6" w:space="6" w:color="${COULEURS.accent}"/>` +
        // Le filet épais du côté où l'on COMMENCE à lire : à gauche en français, à droite en arabe.
        `<w:left w:val="single" w:sz="${rtl ? 6 : 24}" w:space="8" w:color="${COULEURS.accent}"/>` +
        `<w:bottom w:val="single" w:sz="6" w:space="6" w:color="${COULEURS.accent}"/>` +
        `<w:right w:val="single" w:sz="${rtl ? 24 : 6}" w:space="8" w:color="${COULEURS.accent}"/></w:pBdr>` +
        `<w:shd w:val="clear" w:color="auto" w:fill="${COULEURS.fond}"/>`
      : '') +
    `<w:spacing w:before="${avant}" w:after="${apres}" w:line="${interligne}" w:lineRule="auto"/>` +
    `${rtl ? '<w:bidi/>' : ''}${centre ? '<w:jc w:val="center"/>' : '<w:jc w:val="both"/>'}` +
    `</w:pPr>${contenu}</w:p>`
  );
}

const bordures = (valeur, couleur = COULEURS.bordure, taille = 6) =>
  ['top', 'left', 'bottom', 'right']
    .map((cote) => `<w:${cote} w:val="${valeur}" w:sz="${taille}" w:space="0" w:color="${couleur}"/>`)
    .join('');

function cellule(contenu, largeur, { fond = null, bord = 'nil', alignement = 'center', marge = 100 } = {}) {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${largeur}" w:type="dxa"/><w:tcBorders>${bordures(bord)}</w:tcBorders>` +
    (fond ? `<w:shd w:val="clear" w:color="auto" w:fill="${fond}"/>` : '') +
    `<w:tcMar><w:top w:w="${marge}" w:type="dxa"/><w:left w:w="140" w:type="dxa"/>` +
    `<w:bottom w:w="${marge}" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tcMar>` +
    `<w:vAlign w:val="${alignement}"/></w:tcPr>${contenu}</w:tc>`
  );
}

const ligne = (cellules, hauteur = null) =>
  `<w:tr><w:trPr><w:cantSplit/>${hauteur ? `<w:trHeight w:val="${hauteur}" w:hRule="atLeast"/>` : ''}</w:trPr>${cellules}</w:tr>`;

function tableau(largeurs, lignes, { rtl, bord = 'nil', centre = true } = {}) {
  return (
    `<w:tbl><w:tblPr>${rtl ? '<w:bidiVisual/>' : ''}<w:tblW w:w="${largeurs.reduce((a, b) => a + b, 0)}" w:type="dxa"/>` +
    `${centre ? '<w:jc w:val="center"/>' : ''}<w:tblBorders>${bordures(bord)}` +
    `<w:insideH w:val="${bord}" w:sz="6" w:space="0" w:color="${COULEURS.bordure}"/>` +
    `<w:insideV w:val="${bord}" w:sz="6" w:space="0" w:color="${COULEURS.bordure}"/></w:tblBorders>` +
    '<w:tblLayout w:type="fixed"/></w:tblPr>' +
    `<w:tblGrid>${largeurs.map((l) => `<w:gridCol w:w="${l}"/>`).join('')}</w:tblGrid>${lignes}</w:tbl>`
  );
}

function logo(rId, idDessin, tailleMm) {
  const emu = Math.round(tailleMm * 36000);
  return (
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${emu}" cy="${emu}"/><wp:docPr id="${idDessin}" name="Logo ${idDessin}"/>` +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:nvPicPr><pic:cNvPr id="${idDessin}" name="Logo ${idDessin}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu}" cy="${emu}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r>'
  );
}

const ESPACE = (hauteur) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${hauteur}" w:lineRule="exact"/></w:pPr></w:p>`;
const SAUT_DE_PAGE = '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>';

/** La page d'UN PV. */
function page(pv, idDessin) {
  const { langue } = pv;
  const t = TEXTES[langue];
  const rtl = langue === 'ar';
  const { type, rang } = typeDuPalier(pv.palier);
  const p = (contenu, options = {}) => paragraphe(contenu, { rtl, ...options });

  // ── L'en-tête : logo | Royaume, Office, établissement ──
  const lignesEntete = [...t.entete, pv.etablissement]
    .map((texte, index) => p(run(texte, { taille: index === 2 ? 22 : 20, gras: true, couleur: index === 2 ? COULEURS.accent : COULEURS.texte }), { apres: 20, interligne: 240 }))
    .join('');
  const entete = tableau(
    [2000, LARGEUR - 2000],
    ligne(cellule(p(logo('rIdLogo', idDessin, 28), { centre: true, apres: 0 }), 2000) + cellule(lignesEntete, LARGEUR - 2000)),
    { rtl }
  );

  // ── Le titre encadré, et les cases du rang ──
  const titre =
    p(run(t.titres[type], { taille: 40, gras: true, couleur: COULEURS.accent }) +
      (rtl ? run(`  (${t.sousTitres[type]})`, { taille: 24, couleur: COULEURS.doux }) : ''), { centre: true, apres: rang === null ? 0 : 60 }) +
    (rang === null
      ? ''
      : p(
          RANGS[langue][type]
            .map((libelle, index) =>
              run(index === rang ? '☒' : '☐', { taille: 26, symbole: true }) + run(`  ${libelle}`, { taille: 24, gras: true })
            )
            .join(run('            ')),
          { centre: true, apres: 0 }
        ));
  const cadreTitre = tableau([6400], ligne(cellule(titre, 6400, { fond: COULEURS.fond, bord: 'single', marge: 160 })), {
    rtl,
    bord: 'single',
  });

  // ── L'identité du stagiaire ──
  const valeurs = [
    pv.nom,
    pv.matricule,
    pv.filiere || '—',
    NIVEAUX[pv.niveau]?.[langue] ?? (pv.niveau || '—'),
    pv.anneeFormation ? ANNEES[langue](pv.anneeFormation) : '—',
    pv.groupe,
  ];
  const identite = tableau(
    [3000, LARGEUR - 3000],
    t.champs
      .map((champ, index) =>
        ligne(
          cellule(p(run(champ, { taille: 21, gras: true, couleur: COULEURS.doux }), { apres: 0 }), 3000, { fond: COULEURS.fond, bord: 'single', marge: 70 }) +
            cellule(p(run(String(valeurs[index] ?? ''), { taille: 22, gras: index === 0 }), { apres: 0 }), LARGEUR - 3000, { bord: 'single', marge: 70 })
        )
      )
      .join(''),
    { rtl, bord: 'single' }
  );

  // ── Les signatures : une colonne par signataire, la place de signer en dessous ──
  const signataires = t.signatures[type];
  const largeurSignature = Math.floor(LARGEUR / signataires.length);
  const signatures = tableau(
    signataires.map(() => largeurSignature),
    ligne(
      signataires
        .map((qui) => cellule(p(run(qui, { taille: 21, gras: true, souligne: true }), { centre: true, apres: 0 }), largeurSignature, { alignement: 'top' }))
        .join(''),
      1700
    ),
    { rtl }
  );

  return (
    entete +
    ESPACE(240) +
    cadreTitre +
    p(run(t.annee(pv.anneeScolaire), { taille: 20, couleur: COULEURS.doux }), { centre: true, avant: 80, apres: 240 }) +
    p(run(t.date(pv.date), { taille: 22, gras: true }), { apres: 160 }) +
    p(run(t.preambule(pv.heures), { taille: 23 }), { apres: 200, interligne: 320 }) +
    identite +
    ESPACE(300) +
    p(run(t.decisions[type](pv.points), { taille: 24, gras: true }), { cadre: true, apres: 480, interligne: 320 }) +
    signatures
  );
}

const ESPACES_DE_NOMS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

/**
 * Les PV, une page chacun — tous dans la même langue (le logo en dépend).
 *
 * @param {Array<{ langue: 'fr'|'ar', palier: number, etablissement: string, anneeScolaire: number,
 *   date: string, heures: number, points: number, nom: string, matricule: string, filiere: string,
 *   niveau: string, anneeFormation: number|null, groupe: string }>} pvs
 * @returns {Promise<Buffer>}
 */
export async function construireDocxPvSanctions(pvs) {
  const langue = pvs[0]?.langue ?? 'fr';
  const zip = new JSZip();
  zip.file('word/media/logo.png', await readFile(LOGOS[langue]));

  const corps =
    pvs.map((pv, index) => page(pv, index + 1)).join(SAUT_DE_PAGE) +
    '<w:p/>' +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="850" w:right="1134" w:bottom="850" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/>' +
    `${langue === 'ar' ? '<w:bidi/>' : ''}</w:sectPr>`;

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
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>' +
      '</Relationships>'
  );
  zip.file(
    'word/styles.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults>' +
      '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="26"/>' +
      `<w:lang w:val="fr-FR" w:bidi="ar-MA"/></w:rPr></w:rPrDefault>` +
      '<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
      '</w:docDefaults></w:styles>'
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${ESPACES_DE_NOMS}><w:body>${corps}</w:body></w:document>`
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}
