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

/**
 * ═══ LE JOUR FÉRIÉ (2026-10-23, demande du porteur : « que les colonnes du jour
 * férié ne restent pas vides ») ═══ Les cases d'un jour férié deviennent UNE case
 * fusionnée — sur sa largeur (`gridSpan`) ET sur sa hauteur (`vMerge`) — teintée,
 * qui dit « JOUR FÉRIÉ » et son intitulé.
 *
 * @param {string[]} tcs — les cases d'origine, de gauche à droite, sur UNE ligne :
 *   leurs largeurs s'additionnent, la bordure gauche est celle de la première, la
 *   droite celle de la dernière.
 * @param {{ fusion: 'restart'|'continue'|null, texte?: string[], taille?: number }} options
 *   `fusion` : la première ligne de la case porte le texte (`restart`), les
 *   suivantes s'y fondent (`continue`) ; `null` sur une case d'une seule ligne.
 */
export const COULEURS_FERIE = { fond: 'FDE9D9', texte: '9A3412' };

export function celluleFeriee(tcs, { fusion = null, texte = [], taille = 14 } = {}) {
  const premiere = tcs[0];
  const derniere = tcs[tcs.length - 1];
  const nombre = (tc, motif) => Number(motif.exec(tc)?.[1] ?? 0);
  const largeur = tcs.reduce((somme, tc) => somme + nombre(tc, /<w:tcW w:w="(\d+)"/), 0);
  const colonnes = tcs.reduce((somme, tc) => somme + (nombre(tc, /<w:gridSpan w:val="(\d+)"/) || 1), 0);

  const bordures = /<w:tcBorders>([\s\S]*?)<\/w:tcBorders>/.exec(premiere)?.[1] ?? '';
  const droite = /<w:right [^>]*\/>/.exec(/<w:tcBorders>([\s\S]*?)<\/w:tcBorders>/.exec(derniere)?.[1] ?? '')?.[0];
  const borduresFusion = droite ? bordures.replace(/<w:right [^>]*\/>/, droite) : bordures;
  const marges = /<w:tcMar>[\s\S]*?<\/w:tcMar>/.exec(premiere)?.[0] ?? '';

  const tcPr =
    `<w:tcPr><w:tcW w:w="${largeur}" w:type="dxa"/>` +
    (colonnes > 1 ? `<w:gridSpan w:val="${colonnes}"/>` : '') +
    (fusion ? `<w:vMerge${fusion === 'restart' ? ' w:val="restart"' : ''}/>` : '') +
    (borduresFusion ? `<w:tcBorders>${borduresFusion}</w:tcBorders>` : '') +
    `<w:shd w:val="clear" w:color="auto" w:fill="${COULEURS_FERIE.fond}"/>${marges}<w:vAlign w:val="center"/></w:tcPr>`;

  const run = (ligne, gras) =>
    `<w:r><w:rPr>${gras ? '<w:b/><w:bCs/>' : ''}<w:color w:val="${COULEURS_FERIE.texte}"/><w:sz w:val="${taille}"/><w:szCs w:val="${taille}"/></w:rPr><w:t xml:space="preserve">${echapperXml(ligne)}</w:t></w:r>`;
  const ecrit = fusion !== 'continue' && texte.length > 0;
  const paragraphes = ecrit
    ? texte
        .filter((ligne) => String(ligne ?? '').trim() !== '')
        .map((ligne, index) => `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr>${run(ligne, index === 0)}</w:p>`)
        .join('')
    : '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr></w:p>';

  return `<w:tc>${tcPr}${paragraphes}</w:tc>`;
}

/** Le texte d'une case fériée : « JOUR FÉRIÉ », puis l'intitulé quand il est connu. */
export const texteFerie = (ferie) => ['JOUR FÉRIÉ', ferie?.intitule || ferie?.libelle || ''];
