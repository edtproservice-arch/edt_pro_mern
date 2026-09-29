/**
 * Découpage et reconstruction de `<w:tbl>` OOXML, communs aux documents
 * greffés dans un canevas (« emploi global », « émargement », « emploi
 * individuel »). ← extrait de `exportGlobalDocx.js` puis `exportEmargementDocx.js`
 * (2026-09-24) : la même paire d'expressions régulières s'y recopiait déjà
 * deux fois, et un troisième canevas en aurait fait une troisième divergence
 * possible sur un détail d'échappement.
 */

export function remplacerBalise(xml, ancien, nouveau) {
  return xml.includes(ancien) ? xml.replace(ancien, nouveau) : xml;
}

/** Les `<w:tbl>` du document, avec leurs bornes — jamais imbriqués en OOXML. */
export function extraireTableaux(xml) {
  const tableaux = [];
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
  let correspondance;
  while ((correspondance = re.exec(xml))) {
    tableaux.push({
      debut: correspondance.index,
      fin: correspondance.index + correspondance[0].length,
      contenu: correspondance[0],
    });
  }
  return tableaux;
}

/** Les `<w:tr>` d'un tableau — pas imbriqués non plus, un découpage plat suffit. */
export function extraireLignes(xmlTableau) {
  const lignes = [];
  const re = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g;
  let correspondance;
  while ((correspondance = re.exec(xmlTableau))) {
    const complet = correspondance[0];
    const premierTc = complet.indexOf('<w:tc>');
    lignes.push({ avantPremierTc: complet.slice(0, premierTc), tcs: extraireCellules(complet.slice(premierTc)) });
  }
  return lignes;
}

/** Les `<w:tc>` d'une ligne. */
export function extraireCellules(xmlDepuisPremierTc) {
  const cellules = [];
  const re = /<w:tc>[\s\S]*?<\/w:tc>/g;
  let correspondance;
  while ((correspondance = re.exec(xmlDepuisPremierTc))) cellules.push(correspondance[0]);
  return cellules;
}

export const assemblerLigne = (avantPremierTc, tcs) => `${avantPremierTc}${tcs.join('')}</w:tr>`;

/**
 * Fixe la hauteur MINIMALE d'une ligne — le défaut pour un texte sur une
 * seule ligne, et qui s'agrandit tout seul si le texte en demande deux.
 * ← 2026-09-24, demande du porteur : « je veux le height de la ligne être
 *   adaptable selon le texte — une seule ligne, hauteur normale ; deux
 *   lignes, la hauteur s'agrandit ».
 *
 * ═══ ⚠️ `atLeast`, PAS `exact` ═══ Un réglage EXACT ne bouge jamais : il
 * garantit la page unique, mais rogne toute ligne dont le texte a vraiment
 * besoin de deux lignes. `atLeast` sert la même valeur comme PLANCHER — les
 * deux moteurs l'appliquent tel quel sur une ligne, et la laissent grandir
 * seulement quand le contenu l'exige.
 *
 * ⚠️ `<w:cantSplit/>` RESTE (2026-09-24, signalé par le porteur : « parfois un
 * formateur n'affiche que son prénom ») — sans elle, un moteur à court de
 * place en fin de page peut couper une ligne EN PLEIN MILIEU de son contenu
 * plutôt que la pousser en entier sur la page suivante.
 */
export function avecHauteurMinimale(avantPremierTc, twips) {
  const proprietes = `<w:cantSplit/><w:trHeight w:val="${twips}" w:hRule="atLeast"/>`;
  if (avantPremierTc.includes('<w:trPr>')) {
    return avantPremierTc.replace('<w:trPr>', `<w:trPr>${proprietes}`);
  }
  const finOuverture = avantPremierTc.indexOf('>') + 1;
  return `${avantPremierTc.slice(0, finOuverture)}<w:trPr>${proprietes}</w:trPr>${avantPremierTc.slice(finOuverture)}`;
}
