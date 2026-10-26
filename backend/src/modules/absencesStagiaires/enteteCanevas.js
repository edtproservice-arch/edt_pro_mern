// La colonne du logo dans l'en-tête : le logo (1 170 twips) y tient — voir plus bas.
const COLONNE_LOGO = 1350;

/**
 * ═══ LES TITRES DE L'EN-TÊTE, CENTRÉS SUR LA PAGE (2026-10-26, demande du porteur) ═══
 * Dans l'en-tête du canevas de la fiche de réclamation, « مكتب التكوين المهني وإنعاش الشغل » et
 * « Office de la Formation… » sont centrés dans LEUR colonne, à droite du logo : décalés vers la
 * droite de la page. Un retrait négatif de la largeur du logo, côté logo, étend leur paragraphe
 * sous la colonne du logo : ils se centrent alors sur toute la largeur du tableau.
 *
 * ⚠️ WORD COUPE CE QUI DÉBORDE DE LA CELLULE : centré sur la page, le titre doit rester dans
 *    la sienne. « Office de la Formation… » en Calibri gras 13 pt (PV de sanction) fait 7 330
 *    twips : centré sur 10 206, il commence à 1 438 — la colonne du logo, de 1 600, le coupait
 *    (« ffice »). Elle passe à 1 350 : le logo (1 170 twips) y tient, et le titre aussi.
 * ⚠️ Le paragraphe arabe (`w:bidi`) lit ses retraits à l'envers : son côté gauche est sa FIN.
 *
 * @param {string} entete — `word/header1.xml`
 * @param {{ logoADroite?: boolean }} options — la version arabe met le logo à droite (`w:bidiVisual`)
 */
export function centrerTitresEntete(enteteBrut, { logoADroite = false } = {}) {
  const colonnes = [...enteteBrut.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
  if (colonnes.length < 2) return enteteBrut;
  const [logo, titres] = colonnes;

  // La colonne du logo ramenée à `COLONNE_LOGO`, celle des titres élargie d'autant.
  const largeurLogo = Math.min(logo, COLONNE_LOGO);
  const entete = enteteBrut
    .replace(`<w:gridCol w:w="${logo}"/><w:gridCol w:w="${titres}"/>`, `<w:gridCol w:w="${largeurLogo}"/><w:gridCol w:w="${titres + logo - largeurLogo}"/>`)
    .replace(`<w:tcW w:w="${logo}" w:type="dxa"/>`, `<w:tcW w:w="${largeurLogo}" w:type="dxa"/>`)
    .replace(`<w:tcW w:w="${titres}" w:type="dxa"/>`, `<w:tcW w:w="${titres + logo - largeurLogo}" w:type="dxa"/>`);

  // La cellule des titres : la seconde du tableau d'en-tête.
  const debutTableau = entete.indexOf('<w:tbl>');
  const premiere = entete.indexOf('</w:tc>', debutTableau) + '</w:tc>'.length;
  const fin = entete.indexOf('</w:tc>', premiere);
  if (debutTableau < 0 || premiere < '</w:tc>'.length || fin < 0) return entete;

  const cellule = entete.slice(premiere, fin).replace(/<w:pPr>((?:(?!<\/w:pPr>).)*?)<w:jc /gs, (_t, avant) => {
    const rtl = avant.includes('<w:bidi/>');
    // Le côté du logo, en sens de lecture du paragraphe : à gauche « left », à droite « right » ;
    // un paragraphe arabe inverse les deux.
    const cote = logoADroite !== rtl ? 'right' : 'left';
    return `<w:pPr>${avant}<w:ind w:${cote}="-${largeurLogo}"/><w:jc `;
  });
  return entete.slice(0, premiere) + cellule + entete.slice(fin);
}
