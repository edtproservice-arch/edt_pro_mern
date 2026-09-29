/**
 * Petites manipulations de cellules `<w:tc>` OOXML, communes aux deux
 * documents greffés dans un canevas (« emploi global », « émargement »).
 * ← extrait de `exportGlobalDocx.js` (2026-09-24) quand un second canevas en
 * a eu besoin — deux copies auraient fini par diverger sur un détail
 * d'échappement.
 */

export const echapperXml = (texte) =>
  String(texte ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/*
 * ⚠️⚠️ `<w:t` EST UN PRÉFIXE DE PLEIN D'AUTRES BALISES — `<w:tcW>`, `<w:tcPr>`,
 * `<w:tcMar>`, `<w:top>`, `<w:tcBorders>` en sont TOUTES, et une détection
 * naïve (`/<w:t[^>]*>/`) les prend pour un run de texte présent. La vraie
 * balise est suivie d'un espace, d'un `>` ou d'un `/` — jamais d'une AUTRE
 * lettre — d'où le `(?:\s[^>]*)?` ci-dessous plutôt qu'un `[^>]*` sans garde.
 */
const BALISE_TEXTE = /<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/;
const PRESENCE_TEXTE = /<w:t(?:\s[^>]*)?>/;

/**
 * Remplace le texte du PREMIER (et souvent seul) run d'une cellule.
 *
 * ⚠️ UNE COLONNE VIDE DANS LE CANEVAS N'A PARFOIS AUCUN `<w:t>` DU TOUT
 * (2026-09-29, constaté sur la colonne « Observation » du rapport d'absences,
 * auto-fermante : `<w:p .../>`) — le remplacement ci-dessus ne trouve alors
 * rien à remplacer et échoue SILENCIEUSEMENT, le texte demandé n'apparaissant
 * jamais. On y insère un run tout neuf dans ce cas, plutôt que de supposer
 * qu'un paragraphe porte toujours déjà le sien.
 */
export function celluleTexteSimple(tcModele, texte) {
  if (PRESENCE_TEXTE.test(tcModele)) {
    return tcModele.replace(BALISE_TEXTE, `<w:t xml:space="preserve">${echapperXml(texte)}</w:t>`);
  }

  // Rien à écrire, rien dans le gabarit : on laisse le paragraphe vide tel quel.
  const valeur = String(texte ?? '');
  if (valeur === '') return tcModele;

  const run = `<w:r><w:t xml:space="preserve">${echapperXml(valeur)}</w:t></w:r>`;
  if (/<w:p\b[^>]*\/>/.test(tcModele)) {
    return tcModele.replace(/<w:p\b([^>]*)\/>/, (_correspondance, attributs) => `<w:p${attributs}>${run}</w:p>`);
  }
  return tcModele.replace('</w:p>', `${run}</w:p>`);
}

/** Une cellule à DEUX paragraphes — chacun son texte (nom+prénom, horaires début/fin…). */
export function celluleDeuxParagraphes(tcModele, texteLigne1, texteLigne2) {
  const paragraphes = tcModele.match(/<w:p\b[\s\S]*?<\/w:p>/g);
  if (!paragraphes || paragraphes.length < 2) return tcModele;

  const remplacerTexte = (paragraphe, texte) =>
    paragraphe.replace(/<w:t[^>]*>[^<]*<\/w:t>/, `<w:t xml:space="preserve">${echapperXml(texte)}</w:t>`);

  return tcModele
    .replace(paragraphes[0], remplacerTexte(paragraphes[0], texteLigne1))
    .replace(paragraphes[1], remplacerTexte(paragraphes[1], texteLigne2));
}

/**
 * Une case de planning : fond + texte de couleur si occupée, cellule nue
 * sinon — VERT pour un cours en salle, VIOLET pour un cours à distance
 * (Teams), les deux couleurs relevées dans le canevas transmis (2026-09-23,
 * demande du porteur : « pour les séances Teams il faut qu'elles soient en
 * violet »). ← extrait de `exportGlobalDocx.js` quand `exportIndividuelDocx.js`
 * en a eu besoin à son tour.
 */
export const COULEURS = {
  presentiel: { fond: 'E2F5E9', texte: '1B7A3D' },
  distance: { fond: 'F0E4FA', texte: '6B21A8' },
};

/**
 * @param {string} tcModele
 * @param {string} texte
 * @param {boolean} aDistance
 * @param {number} [taille] Taille du texte en DEMI-POINTS (8 = 4 pt, le défaut
 *   — nécessaire à la vue GLOBALE pour tenir 24 colonnes sur une page. Un
 *   canevas moins dense, comme l'emploi INDIVIDUEL/détaillé à 4 colonnes,
 *   passe une valeur plus grande — demande du porteur, 2026-09-24 : « il faut
 *   agrandir la taille du texte ».
 */
export function celluleDonnee(tcModele, texte, aDistance, taille = 8) {
  const remplie = Boolean(texte && String(texte).trim() !== '');
  const couleurs = aDistance ? COULEURS.distance : COULEURS.presentiel;

  let tc = tcModele.replace(/<w:shd[^/]*\/>/, '');
  if (remplie) {
    tc = tc.replace('<w:tcMar>', `<w:shd w:val="clear" w:color="auto" w:fill="${couleurs.fond}"/><w:tcMar>`);
  }

  const paragraphe = remplie
    ? `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:bCs/><w:color w:val="${couleurs.texte}"/><w:sz w:val="${taille}"/><w:szCs w:val="${taille}"/></w:rPr><w:t xml:space="preserve">${echapperXml(texte)}</w:t></w:r></w:p>`
    : `<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>`;

  return tc.replace(/<w:p\b[\s\S]*?<\/w:p>/, paragraphe);
}
