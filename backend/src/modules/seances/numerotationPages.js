/**
 * ═══ LA NUMÉROTATION DES PAGES — « 1 / 2 » ═══ (2026-10-27, demandes du porteur :
 * l'emploi du temps journalier, puis l'en-tête d'épreuve CC / EFM.)
 *
 * Deux champs Word — PAGE et NUMPAGES — centrés en bas de page, que Word et
 * LibreOffice (donc le PDF) calculent eux-mêmes : un nombre écrit en dur serait
 * faux dès la deuxième page.
 *
 * ⚠️ UN PIED DE PAGE DÉJÀ PRÉSENT EST COMPLÉTÉ, PAS REMPLACÉ : le paragraphe de
 *    numérotation s'ajoute à la fin du pied de page de la section. Sans pied de
 *    page, on en crée un — et il faut alors tenir QUATRE endroits ensemble, sinon
 *    Word déclare le fichier endommagé : la partie, sa relation, son type de
 *    contenu, et la `w:footerReference` de la section (après la `w:headerReference`).
 */

const RELATION_PIED = 'rIdPiedNumerotation';
const PARTIE_PIED = 'footerNumerotation.xml';
const TYPE_PIED = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';

function paragrapheNumerotation(demiPoints) {
  const proprietes = `<w:rPr><w:sz w:val="${demiPoints}"/><w:szCs w:val="${demiPoints}"/></w:rPr>`;
  const champ = (instruction) =>
    `<w:fldSimple w:instr=" ${instruction} "><w:r>${proprietes}<w:t>1</w:t></w:r></w:fldSimple>`;
  return (
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${champ('PAGE')}` +
    `<w:r>${proprietes}<w:t xml:space="preserve"> / </w:t></w:r>${champ('NUMPAGES')}</w:p>`
  );
}

/**
 * @param {import('jszip')} zip — le document ouvert
 * @param {string} xmlDocument — `word/document.xml`, tel qu'il sera écrit
 * @param {{ taille?: number }} [options] — en demi-points (9 pt = 18)
 * @returns {Promise<string>} le `document.xml` à écrire
 */
export async function ajouterNumerotation(zip, xmlDocument, { taille = 18 } = {}) {
  const paragraphe = paragrapheNumerotation(taille);
  const relations = (await zip.file('word/_rels/document.xml.rels')?.async('string')) ?? '';

  // 1. La section a déjà un pied de page : on le complète.
  const existant = xmlDocument.match(/<w:footerReference\b[^>]*w:type="default"[^>]*r:id="([^"]+)"/)
    ?? xmlDocument.match(/<w:footerReference\b[^>]*r:id="([^"]+)"[^>]*w:type="default"/);
  if (existant) {
    const cible = relations.match(new RegExp(`Id="${existant[1]}"[^>]*Target="([^"]+)"`))?.[1]
      ?? relations.match(new RegExp(`Target="([^"]+)"[^>]*Id="${existant[1]}"`))?.[1];
    const fichier = cible && zip.file(`word/${cible.replace(/^\/?word\//, '')}`);
    if (fichier) {
      const pied = await fichier.async('string');
      if (!pied.includes('NUMPAGES')) zip.file(fichier.name, pied.replace('</w:ftr>', `${paragraphe}</w:ftr>`));
    }
    return xmlDocument;
  }

  // 2. Pas de pied de page : on en crée un, et on le branche.
  zip.file(
    `word/${PARTIE_PIED}`,
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `${paragraphe}</w:ftr>`
  );

  if (relations && !relations.includes(`Id="${RELATION_PIED}"`)) {
    zip.file(
      'word/_rels/document.xml.rels',
      relations.replace(
        '</Relationships>',
        `<Relationship Id="${RELATION_PIED}" Type="${TYPE_PIED}" Target="${PARTIE_PIED}"/></Relationships>`
      )
    );
  }

  const types = await zip.file('[Content_Types].xml')?.async('string');
  if (types && !types.includes(`/word/${PARTIE_PIED}`)) {
    zip.file(
      '[Content_Types].xml',
      types.replace(
        '</Types>',
        `<Override PartName="/word/${PARTIE_PIED}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`
      )
    );
  }

  const reference = `<w:footerReference w:type="default" r:id="${RELATION_PIED}"/>`;
  return /<w:headerReference\b[^>]*\/>/.test(xmlDocument)
    ? xmlDocument.replace(/(<w:headerReference\b[^>]*\/>)(?![\s\S]*<w:headerReference)/, `$1${reference}`)
    : xmlDocument.replace(/(<w:sectPr\b[^>]*>)/, `$1${reference}`);
}
