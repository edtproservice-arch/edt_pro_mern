import { echapperXml } from '../seances/xmlCellules.js';

/**
 * Les briques des FORMULAIRES COMPOSÉS au style des autres documents
 * (2026-10-17) — la fiche du candidat fils d'agent, la demande de duplicata :
 * ils se greffent sur le canevas de l'attestation (son en-tête officiel), et
 * leur corps reprend la forme du formulaire de transfert — un titre encadré
 * sur fond clair, des parties encadrées, leur nom à la verticale à gauche.
 * Du XML Word, en twips, pour la largeur utile de ce canevas (A4, marges de
 * 850 twips).
 */

/** La largeur utile du canevas : A4, marges de 850 twips. */
export const LARGEUR_UTILE = 10206;
/** La colonne du nom de la partie, à la verticale — celle du formulaire de transfert. */
export const LARGEUR_LIBELLE = 1406;
export const LARGEUR_CONTENU = LARGEUR_UTILE - LARGEUR_LIBELLE;
export const LARGEUR_CASE = 280;
export const FOND = 'FAFAFA';
export const POINTILLES = '………………………………………………………………………………………';
export const CASE_VIDE = '☐';

export function run(texte, { taille = 21, gras = false, italique = false, souligne = false, couleur = '000000' } = {}) {
  return (
    '<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
    `${gras ? '<w:b/><w:bCs/>' : ''}${italique ? '<w:i/><w:iCs/>' : ''}${souligne ? '<w:u w:val="single"/>' : ''}` +
    `<w:color w:val="${couleur}"/><w:sz w:val="${taille}"/><w:szCs w:val="${taille}"/></w:rPr>` +
    `<w:t xml:space="preserve">${echapperXml(texte)}</w:t></w:r>`
  );
}

export function paragraphe(contenu, { alignement = null, avant = 0, apres = 110 } = {}) {
  return (
    `<w:p><w:pPr><w:spacing w:before="${avant}" w:after="${apres}" w:line="240" w:lineRule="auto"/>` +
    `${alignement ? `<w:jc w:val="${alignement}"/>` : ''}</w:pPr>${contenu}</w:p>`
  );
}

/** Un paragraphe d'un point : la fin obligée d'une cellule qui contient un tableau. */
export const PARAGRAPHE_MINUSCULE =
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>' +
  '<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>';
/** Un filet d'air de `hauteur` twips — un paragraphe vide ordinaire en ferait douze points. */
export const ESPACE = (hauteur) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${hauteur}" w:lineRule="exact"/></w:pPr></w:p>`;

export const bord = (cote, valeur, taille) => `<w:${cote} w:val="${valeur}" w:sz="${taille}" w:space="0" w:color="000000"/>`;
export const AUCUNE_BORDURE = `<w:tcBorders>${['top', 'left', 'bottom', 'right'].map((c) => bord(c, 'nil', 0)).join('')}</w:tcBorders>`;
export const CONTOUR = (taille = 6) => `<w:tcBorders>${['top', 'left', 'bottom', 'right'].map((c) => bord(c, 'single', taille)).join('')}</w:tcBorders>`;

export function cellule(contenu, largeur, { bordures = CONTOUR(), fusion = 1, vertical = 'top', marges = [120, 160], fond = null, sens = null } = {}) {
  const [hautBas, cotes] = marges;
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${largeur}" w:type="dxa"/>${fusion > 1 ? `<w:gridSpan w:val="${fusion}"/>` : ''}${bordures}` +
    (fond ? `<w:shd w:val="clear" w:color="auto" w:fill="${fond}"/>` : '') +
    `<w:tcMar><w:top w:w="${hautBas}" w:type="dxa"/><w:left w:w="${cotes}" w:type="dxa"/>` +
    `<w:bottom w:w="${hautBas}" w:type="dxa"/><w:right w:w="${cotes}" w:type="dxa"/></w:tcMar>` +
    `${sens ? `<w:textDirection w:val="${sens}"/>` : ''}<w:vAlign w:val="${vertical}"/></w:tcPr>${contenu}</w:tc>`
  );
}

export const rangee = (cellules, hauteur = null) =>
  `<w:tr><w:trPr><w:cantSplit/>${hauteur ? `<w:trHeight w:val="${hauteur}" w:hRule="atLeast"/>` : ''}</w:trPr>${cellules}</w:tr>`;

export function tableau(largeurs, rangees) {
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${largeurs.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${largeurs.map((l) => `<w:gridCol w:w="${l}"/>`).join('')}</w:tblGrid>${rangees}</w:tbl>`
  );
}

/** « Libellé : valeur » — la valeur en gras ; absente, les pointillés du formulaire. */
export const champ = (libelle, valeur) =>
  run(`${libelle} `) + (String(valeur ?? '').trim() ? run(String(valeur).trim(), { gras: true }) : run(POINTILLES, { couleur: '7F7F7F' }));

/** Une date « jj/mm/aaaa », ou ses pointillés. */
export const date = (valeur) =>
  String(valeur ?? '').trim() ? run(String(valeur).trim(), { gras: true }) : run('………. / ………. / ……….', { couleur: '7F7F7F' });

export const caracteres = (valeur) => [...String(valeur ?? '').replace(/\s+/g, '')];

/** Une ligne de cases, une par caractère : CEF, CNI, matricule — `nombre` au moins. */
export function cases(valeur, nombre) {
  const lettres = caracteres(valeur);
  const total = Math.max(nombre, lettres.length);
  return tableau(
    Array(total).fill(LARGEUR_CASE),
    rangee(
      Array.from({ length: total }, (_, i) =>
        cellule(paragraphe(run(lettres[i] ?? '', { gras: true, taille: 20 }), { alignement: 'center', apres: 0 }), LARGEUR_CASE, {
          bordures: CONTOUR(4),
          vertical: 'center',
          marges: [0, 0],
        })
      ).join(''),
      320
    )
  );
}

/**
 * Une ligne « libellé, cases, suite » : un tableau sans bordure, pour que les
 * cases restent sur la ligne de leur libellé. ⚠️ La cellule des cases FINIT
 * par un paragraphe : sans lui, la suite passait sous les cases.
 */
export function ligneAvecCases(libelle, valeur, nombre, suite = null, largeurLibelle = 700) {
  const largeurCases = Math.max(nombre, caracteres(valeur).length) * LARGEUR_CASE;
  const reste = LARGEUR_CONTENU - 2 * 200 - largeurLibelle - largeurCases;
  const sansBord = { bordures: AUCUNE_BORDURE, vertical: 'center', marges: [0, 0] };
  return (
    tableau(
      [largeurLibelle, largeurCases, reste],
      rangee(
        cellule(paragraphe(libelle, { apres: 0 }), largeurLibelle, sansBord) +
          cellule(cases(valeur, nombre) + PARAGRAPHE_MINUSCULE, largeurCases, sansBord) +
          cellule(paragraphe(suite ? run('     ') + suite : '', { apres: 0 }), reste, sansBord)
      )
    ) + ESPACE(110)
  );
}

/** Une partie encadrée : son nom à la verticale à gauche, son contenu à droite — la forme du transfert. */
export const partie = (nom, contenu) =>
  tableau(
    [LARGEUR_LIBELLE, LARGEUR_CONTENU],
    rangee(
      cellule(paragraphe(run(nom, { gras: true, taille: 24 }), { alignement: 'center', apres: 0 }), LARGEUR_LIBELLE, {
        sens: 'btLr',
        vertical: 'center',
        marges: [80, 80],
      }) + cellule(contenu, LARGEUR_CONTENU, { marges: [160, 200] })
    )
  );

/*
 * ═══ LES LIGNES À POINTS DE SUITE (2026-10-17) ═══ — partagées par la demande de
 * duplicata et le PV de réorientation. Des tabulations à points, pas des « … » :
 * elles vont exactement jusqu'au bord, quelle que soit la longueur du libellé.
 */

/** La largeur où l'on écrit, dans le cadre d'une partie (ses marges de 200 retirées). */
export const LARGEUR_ECRITURE = LARGEUR_CONTENU - 2 * 200;
export const MILIEU = Math.round(LARGEUR_ECRITURE / 2);
export const TAB = '<w:r><w:tab/></w:r>';

/** Un paragraphe dont les tabulations sont `taquets` : [position, alignement, points de suite ?]. */
export function ligne(contenu, taquets, { apres = 200 } = {}) {
  const tabs = taquets
    .map(([pos, val = 'left', points = false]) => `<w:tab w:val="${val}"${points ? ' w:leader="dot"' : ''} w:pos="${pos}"/>`)
    .join('');
  return (
    // Pas de `<w:tabs>` vide : Word le refuse.
    `<w:p><w:pPr>${tabs ? `<w:tabs>${tabs}</w:tabs>` : ''}<w:spacing w:before="0" w:after="${apres}" w:line="240" w:lineRule="auto"/></w:pPr>` +
    `${contenu}</w:p>`
  );
}

/*
 * ⚠️ REMPLI, UN CHAMP N'A PLUS DE POINTILLÉS (2026-10-17, demande du porteur) :
 * les points de suite ne servent qu'à écrire à la main. Vide, le champ garde
 * sa ligne de points ; rempli, sa valeur en gras, et rien après.
 */
export const rempli = (texte) => String(texte ?? '').trim() !== '';
export const valeur = (texte) => (rempli(texte) ? run(String(texte).trim(), { gras: true }) : '');

/** « Libellé : valeur », ou « Libellé : ………… » jusqu'au bord. */
export const champPlein = ([libelle, texte], options) =>
  rempli(texte)
    ? ligne(run(`${libelle} `) + valeur(texte), [], options)
    : ligne(run(`${libelle} `) + TAB, [[LARGEUR_ECRITURE, 'right', true]], options);

/**
 * Deux champs sur la ligne, le second à partir du milieu : `[libellé, valeur]`
 * chacun. La première tabulation mène au second champ — avec ses points
 * seulement si le premier est vide ; le second n'a de points que vide.
 */
export const deuxChamps = ([premier, texte1], [second, texte2]) =>
  ligne(
    run(`${premier} `) + valeur(texte1) + TAB + TAB + run(`${second} `) + valeur(texte2) + (rempli(texte2) ? '' : TAB),
    [[MILIEU - 200, 'left', !rempli(texte1)], [MILIEU], [LARGEUR_ECRITURE, 'right', true]]
  );

/** Une ligne de pointillés seule, pour écrire. */
export const lignePointillee = (apres = 200) => ligne(TAB, [[LARGEUR_ECRITURE, 'right', true]], { apres });
