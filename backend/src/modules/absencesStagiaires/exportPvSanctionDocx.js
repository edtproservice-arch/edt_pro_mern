import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { echapperXml } from '../seances/xmlCellules.js';
import { centrerTitresEntete } from './enteteCanevas.js';

/**
 * ═══ LE PV D'UNE SANCTION D'ASSIDUITÉ (2026-10-26, demande du porteur) ═══
 * Mise en garde (1ère, 2ème), avertissement (1er, 2ème), blâme — en FRANÇAIS ou en
 * ARABE, au choix, en Word ou en PDF.
 *
 * ═══ ⚠️ LE STYLE DES AUTRES DOCUMENTS, LEUR EN-TÊTE MÊME ═══ (« je veux qu'il soit
 * avec le même style que les autres documents, même en-tête ».) Le paquet Word part
 * du canevas de la fiche de réclamation : son EN-TÊTE DE PAGE (logo OFPPT, « مكتب
 * التكوين المهني وإنعاش الشغل / Office de la Formation Professionnelle… »), ses
 * styles, ses marges. Seul le CORPS est composé ici, dans la même écriture : CFP / EFP
 * en tête, titre dans un cadre, Calibri, libellés en gras, sections soulignées.
 *
 * Le TEXTE est celui du canevas transmis (`تنبيه ـ اندار ـ توبيخ.docx`) ; sa mise en
 * page — cadres flottants, pointillés — ne tenait pas d'un logiciel à l'autre.
 *
 * ⚠️ LA VERSION ARABE : le logo arabe remplace celui de l'en-tête, `w:bidi` sur chaque
 *    paragraphe, `w:bidiVisual` sur chaque tableau (la première cellule passe à droite),
 *    `w:rtl` sur chaque passage arabe.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CANEVAS_ENTETE = path.join(__dirname, 'canevas', 'ficheReclamation.docx');
/*
 * Le logo arabe posé sur l'ombre du logo français (2026-10-26) : même cadre (485 × 551 px), même
 * ombre portée — il prend la place de l'autre sans changer ses dimensions dans l'en-tête.
 */
const LOGO_ARABE = path.join(__dirname, 'canevas', 'logoOfpptArOmbre.png');

// Les marges du canevas : 850 twips de chaque côté → 11 906 − 1 700 = 10 206 de large.
const LARGEUR = 10206;

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

/**
 * « 12,5 » : la virgule française, aussi dans le texte arabe (c'est l'usage des PV). Un texte
 * passe tel quel — les pointillés d'un PV vierge.
 */
const nombre = (valeur) =>
  typeof valeur === 'string' ? valeur : String(Math.round(Number(valeur) * 100) / 100).replace('.', ',');

/* Ce qui se remplit à la main sur un PV VIERGE (page Documents, 2026-10-26). */
const A_REMPLIR = '……';
const A_REMPLIR_LONG = '……………………………………………………';

const TEXTES = {
  fr: {
    date: (d) => `Le ${d}`,
    titres: { 'mise-en-garde': 'MISE EN GARDE', avertissement: 'AVERTISSEMENT', blame: 'BLÂME' },
    annee: (a) => `ANNÉE DE FORMATION : ${a}-${a + 1}`,
    preambule: (heures) =>
      'Conformément aux dispositions du règlement intérieur des établissements de la formation ' +
      `professionnelle, et compte tenu de ses absences répétées et non justifiées (${nombre(heures)} heure(s)), ` +
      'il est adressé au (à la) stagiaire :',
    champs: ['Nom et prénom', 'N° d’inscription (CEF)', 'Filière', 'Niveau de formation', 'Année de formation', 'Groupe'],
    decision: 'Décision :',
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
      'mise-en-garde': ['Signature du (de la) stagiaire :', 'Le Surveillant général :'],
      avertissement: ['Signature du (de la) stagiaire :', 'Le Surveillant général :', 'Le Directeur de l’établissement :'],
      blame: ['Signature du (de la) stagiaire :', 'La Commission de gestion pédagogique :'],
    },
  },
  ar: {
    date: (d) => `التاريخ : ${d}`,
    titres: { 'mise-en-garde': 'تنبيه', avertissement: 'إنذار', blame: 'توبيخ' },
    sousTitres: { 'mise-en-garde': 'Mise en garde', avertissement: 'Avertissement', blame: 'Blâme' },
    // Les chiffres gardent leur ordre dans un texte arabe : « 2026-2027 », comme en français.
    annee: (a) => `السنة التكوينية : ${a}-${a + 1}`,
    preambule: (heures) =>
      'طبقا لمقتضيات القانون الداخلي لمؤسسات التكوين المهني، وتبعا للغياب المتكرر وغير المبرر ' +
      `(${nombre(heures)} ساعة)، يوجه للمتدرب(ة) :`,
    champs: ['الاسم الكامل', 'رقم التسجيل', 'الشعبة', 'مستوى التكوين', 'السنة التكوينية', 'الفوج'],
    decision: 'القرار :',
    decisions: {
      'mise-en-garde': (p) => `تنبيه كتابي يسجل بملفه مع خصم ${nombre(p)} نقطة من نقطة المواظبة والسلوك.`,
      avertissement: (p) => `إنذار كتابي يسجل بملفه مع خصم ${nombre(p)} نقطة من نقطة المواظبة والسلوك.`,
      blame: () =>
        'توبيخ كتابي يسجل بملفه مع عرضه على المجلس التأديبي وتطبيق جميع الإجراءات المترتبة عن هذه العقوبة التأديبية.',
    },
    signatures: {
      'mise-en-garde': ['إمضاء المتدرب(ة) :', 'مسير شؤون المتدربين :'],
      avertissement: ['إمضاء المتدرب(ة) :', 'مسير شؤون المتدربين :', 'مدير المؤسسة :'],
      blame: ['إمضاء المتدرب(ة) :', 'لجنة التدبير والتسيير البيداغوجي :'],
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

/**
 * Un passage de texte — Calibri comme le canevas, Arial pour l'écriture arabe.
 *
 * ⚠️ `rtl` : un passage SANS lettre arabe (des espaces, une case ☒) dans un paragraphe arabe.
 *    Non marqué `w:rtl`, Word le range avec le texte latin voisin et déplace ses espaces au bord
 *    de la ligne : « تنبيه(Mise en garde) », « ☒ الأول☐ الثاني » collés (2026-10-26).
 *    LibreOffice, lui, les laissait en place.
 */
function run(texte, { taille = 22, gras = false, souligne = false, italique = false, symbole = false, rtl = false } = {}) {
  const arabe = ARABE.test(texte) || rtl;
  const police = symbole
    ? '<w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol" w:cs="Segoe UI Symbol"/>'
    : '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/>';
  return (
    `<w:r><w:rPr>${police}${gras ? '<w:b/><w:bCs/>' : ''}${italique ? '<w:i/><w:iCs/>' : ''}` +
    `${souligne ? '<w:u w:val="single"/>' : ''}<w:sz w:val="${taille}"/><w:szCs w:val="${taille + (arabe ? 4 : 0)}"/>` +
    `${arabe ? '<w:rtl/>' : ''}</w:rPr><w:t xml:space="preserve">${echapperXml(texte)}</w:t></w:r>`
  );
}

function paragraphe(contenu, { rtl, alignement = 'debut', avant = 0, apres = 100, interligne = 276 } = {}) {
  // `debut` : le côté où l'on commence à lire — rien à préciser, c'est le défaut de chaque sens.
  const jc = { centre: '<w:jc w:val="center"/>', justifie: '<w:jc w:val="both"/>', fin: `<w:jc w:val="${rtl ? 'left' : 'right'}"/>` }[alignement] ?? '';
  return (
    `<w:p><w:pPr><w:spacing w:before="${avant}" w:after="${apres}" w:line="${interligne}" w:lineRule="auto"/>` +
    `${rtl ? '<w:bidi/>' : ''}${jc}</w:pPr>${contenu}</w:p>`
  );
}

const bordures = (valeur, taille = 8) =>
  ['top', 'left', 'bottom', 'right']
    .map((cote) => `<w:${cote} w:val="${valeur}" w:sz="${taille}" w:space="0" w:color="000000"/>`)
    .join('');

function cellule(contenu, largeur, { bord = 'nil', alignement = 'top', marge = 60 } = {}) {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${largeur}" w:type="dxa"/><w:tcBorders>${bordures(bord)}</w:tcBorders>` +
    `<w:tcMar><w:top w:w="${marge}" w:type="dxa"/><w:left w:w="120" w:type="dxa"/>` +
    `<w:bottom w:w="${marge}" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar>` +
    `<w:vAlign w:val="${alignement}"/></w:tcPr>${contenu}</w:tc>`
  );
}

const ligne = (cellules, hauteur = null) =>
  `<w:tr><w:trPr><w:cantSplit/>${hauteur ? `<w:trHeight w:val="${hauteur}" w:hRule="atLeast"/>` : ''}</w:trPr>${cellules}</w:tr>`;

function tableau(largeurs, lignes, { rtl, bord = 'nil' } = {}) {
  return (
    `<w:tbl><w:tblPr>${rtl ? '<w:bidiVisual/>' : ''}<w:tblW w:w="${largeurs.reduce((a, b) => a + b, 0)}" w:type="dxa"/>` +
    `<w:tblBorders>${bordures(bord)}<w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>` +
    '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${largeurs.map((l) => `<w:gridCol w:w="${l}"/>`).join('')}</w:tblGrid>${lignes}</w:tbl>`
  );
}

const VIDE = (hauteur = 120) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${hauteur}" w:lineRule="exact"/></w:pPr></w:p>`;
const SAUT_DE_PAGE = '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>';

/** La page d'UN PV — le corps seul : l'en-tête de page est celui du canevas. */
function page(pv) {
  const { langue } = pv;
  // Vierge : personne n'est nommé, rien n'est coché — la page se remplit à la main.
  const vierge = Boolean(pv.vierge);
  const t = TEXTES[langue];
  const rtl = langue === 'ar';
  const { type, rang } = typeDuPalier(pv.palier);
  const p = (contenu, options = {}) => paragraphe(contenu, { rtl, ...options });

  // ── La date, du côté où l'on finit de lire — « CFP / EFP » sont dans l'en-tête de page ──
  const ouverture = p(run(t.date(vierge ? `${A_REMPLIR} / ${A_REMPLIR} / ${A_REMPLIR}` : pv.date), { taille: 20 }), {
    alignement: 'fin',
    apres: 0,
  });

  // ── Le titre dans son cadre, comme le PV du conseil ; les cases du rang en dessous ──
  const titre =
    p(
      run(t.titres[type], { taille: rtl ? 32 : 28, gras: true }) +
        (rtl ? run('  ', { taille: 22, rtl }) + run(`(${t.sousTitres[type]})`, { taille: 22, gras: true }) : ''),
      { alignement: 'centre', apres: rang === null ? 0 : 40 }
    ) +
    (rang === null
      ? ''
      : p(
          RANGS[langue][type]
            .map(
              (libelle, index) =>
                run(index === rang && !vierge ? '☒' : '☐', { taille: 24, symbole: true, rtl }) + run(` ${libelle}`, { taille: 22, gras: true, rtl })
            )
            .join(run('              ', { rtl })),
          { alignement: 'centre', apres: 0 }
        ));
  const cadre = tableau([LARGEUR], ligne(cellule(titre, LARGEUR, { bord: 'single', alignement: 'center', marge: 100 })), {
    rtl,
    bord: 'single',
  });

  // ── L'identité : « Libellé : valeur », une ligne chacune, comme les autres PV ──
  const valeurs = vierge
    ? t.champs.map(() => A_REMPLIR_LONG)
    : [
        pv.nom,
        pv.matricule,
        pv.filiere || '—',
        NIVEAUX[pv.niveau]?.[langue] ?? (pv.niveau || '—'),
        pv.anneeFormation ? ANNEES[langue](pv.anneeFormation) : '—',
        pv.groupe,
      ];
  const identite = t.champs
    .map((champ, index) => p(run(`${champ} : `, { taille: 22 }) + run(String(valeurs[index] ?? ''), { taille: 22, gras: true }), { apres: 60 }))
    .join('');

  // ── Les signatures : une colonne par signataire, la place de signer en dessous ──
  const signataires = t.signatures[type];
  const largeurSignature = Math.floor(LARGEUR / signataires.length);
  const signatures = tableau(
    signataires.map(() => largeurSignature),
    ligne(
      signataires
        .map((qui) => cellule(p(run(qui, { taille: 21, gras: true, souligne: true }), { alignement: 'centre', apres: 0 }), largeurSignature))
        .join(''),
      1600
    ),
    { rtl }
  );

  return (
    VIDE(60) +
    ouverture +
    VIDE(280) +
    cadre +
    p(run(t.annee(pv.anneeScolaire), { taille: 18, gras: true }), { alignement: 'centre', avant: 60, apres: 280 }) +
    p(run(t.preambule(vierge ? A_REMPLIR : pv.heures), { taille: 22 }), { alignement: 'justifie', apres: 180, interligne: 320 }) +
    identite +
    p(run(t.decision, { taille: 22, gras: true, souligne: true }), { avant: 240, apres: 80 }) +
    p(run(t.decisions[type](vierge ? A_REMPLIR : pv.points), { taille: 23, gras: true }), { alignement: 'justifie', apres: 480, interligne: 320 }) +
    signatures
  );
}

/**
 * Les PV, une page chacun — tous dans la même langue (le logo de l'en-tête en dépend).
 *
 * @param {Array<{ langue: 'fr'|'ar', palier: number, complexe: string, efp: string, anneeScolaire: number,
 *   date: string, heures: number, points: number, nom: string, matricule: string, filiere: string,
 *   niveau: string, anneeFormation: number|null, groupe: string }>} pvs
 * @returns {Promise<Buffer>}
 */
export async function construireDocxPvSanctions(pvs) {
  const langue = pvs[0]?.langue ?? 'fr';
  const zip = await JSZip.loadAsync(await readFile(CANEVAS_ENTETE));

  // Le corps du canevas est remplacé ; son en-tête de page et sa mise en page (sectPr) restent.
  const xml = await zip.file('word/document.xml').async('string');
  const debutCorps = xml.indexOf('<w:body>') + '<w:body>'.length;
  const debutSectPr = xml.lastIndexOf('<w:sectPr');
  if (debutSectPr <= debutCorps) throw new Error('Canevas Word illisible : la mise en page (sectPr) est absente');
  zip.file(
    'word/document.xml',
    xml.slice(0, debutCorps) + pvs.map(page).join(SAUT_DE_PAGE) + xml.slice(debutSectPr)
  );

  /*
   * ⚠️ « CFP : … / EFP : … » SONT DANS L'EN-TÊTE DU CANEVAS, avec ses valeurs d'exemple —
   *    remplacées ici comme pour la fiche de réclamation (`remplacementsDocument`). Les
   *    écrire aussi dans le corps les faisait figurer deux fois.
   */
  const pv0 = pvs[0] ?? {};
  const remplacer = (texteXml, exemple, valeur) =>
    texteXml.replace(
      new RegExp(`(<w:t[^>]*>)${exemple}(</w:t>)`, 'g'),
      (_t, ouverture, fermeture) => `<w:t xml:space="preserve">${echapperXml(valeur)}${fermeture}`
    );
  const enteteBrut = await zip.file('word/header1.xml').async('string');
  /*
   * Le texte de l'en-tête un peu plus grand, dans les deux langues (2026-10-26, demande du
   * porteur) : « مكتب التكوين… » 15 → 17 pt, « Office de la Formation… » 12 → 13 pt,
   * « CFP / EFP » 10,5 → 11,5 pt.
   */
  const agrandir = (texteXml, avant, apres) =>
    texteXml.replace(
      new RegExp(`<w:sz w:val="${avant}"/><w:szCs w:val="${avant}"/>`, 'g'),
      `<w:sz w:val="${apres}"/><w:szCs w:val="${apres}"/>`
    );
  const entete = [
    [30, 34],
    [24, 26],
    [21, 23],
  ].reduce(
    (texteXml, [avant, apres]) => agrandir(texteXml, avant, apres),
    remplacer(remplacer(enteteBrut, 'CF MEDIOUNA ', `${pv0.complexe ?? ''} `), 'CFMMS TIT MELLIL', pv0.efp ?? '')
  );
  // Les titres centrés sur la page, pas dans leur colonne (2026-10-26) — voir `centrerTitresEntete`.
  zip.file('word/header1.xml', centrerTitresEntete(entete, { logoADroite: langue === 'ar' }));

  /*
   * ⚠️ LA VERSION ARABE PORTE LE LOGO ARABE (demande du porteur) — à la place de celui de
   *    l'en-tête, et À DROITE (2026-10-26) : `w:bidiVisual` passe la première cellule du
   *    tableau d'en-tête, celle du logo, de l'autre côté.
   */
  if (langue === 'ar') {
    const relations = await zip.file('word/_rels/header1.xml.rels').async('string');
    const cible = /Target="(media\/[^"]+)"/.exec(relations)?.[1];
    if (cible) zip.file(`word/${cible}`, await readFile(LOGO_ARABE));
    zip.file(
      'word/header1.xml',
      centrerTitresEntete(entete, { logoADroite: true }).replace('<w:tblPr>', '<w:tblPr><w:bidiVisual/>')
    );
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}
