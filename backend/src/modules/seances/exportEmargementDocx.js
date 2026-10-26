import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { celluleTexteSimple, echapperXml } from './xmlCellules.js';
import { chargerCanevasTampon } from './canevasCache.js';
import { dateFr, nomFichierEmargement, lignesTaux } from './exportEmargementTexte.js';
import { assemblerLigne, extraireLignes, extraireTableaux, remplacerBalise, insecable } from './xmlTableaux.js';

/**
 * Le Word de l'émargement JOURNALIER — GREFFÉ dans le canevas transmis par
 * l'établissement (2026-09-24, demande du porteur : « je veux ajouter
 * l'emploi du temps journalier, voici le canvas »), suivant EXACTEMENT la
 * méthode de `exportGlobalDocx.js` : le fichier réel de l'établissement sert
 * de gabarit, seul le TEXTE des cellules change.
 *
 * ═══ COMMENT CE CANEVAS-CI EST FAIT ═══
 * Une simple LISTE, pas une grille : un tableau à 8 colonnes (Formateur,
 * Groupe, Module, Espace, Horaire, Taux, Absence, Émargement), une ligne par
 * BLOC de cours continu d'un formateur ce jour-là. Les deux dernières
 * colonnes restent VIERGES dans le fichier — c'est là que la signature et la
 * marque d'absence se posent à la main, à l'impression.
 *
 * ⚠️ DEUX GABARITS DE LIGNE, PAS UN SEUL : les lignes alternent un fond BLANC
 * et un fond GRIS CLAIR (`F7F7F8`, en zèbre, pour suivre une ligne d'un bout à
 * l'autre du tableau) — les deux premières lignes de données du canevas
 * portent chacune l'un des deux, et on les clone en alternance.
 *
 * ⚠️ LA COLONNE TAUX NE SUIT PAS LE ZÈBRE : sa couleur — rouge, orange ou
 * verte — dit le niveau d'avancement du module, la MÊME couleur qu'utilise
 * déjà la page Avancement (`niveauAvancement`) pour ce taux. Elle remplace
 * toujours le fond de la ligne, quel que soit son rang.
 *
 * ⚠️ LE JOUR VIT DANS DEUX ENDROITS : le titre de la page (`word/header1.xml`,
 * répété en haut de chaque page par Word) ET la date du corps du document —
 * les deux se remplacent, l'un comme l'autre.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHEMIN_CANEVAS = path.join(__dirname, 'canevas', 'emargementJournalier.docx');

const COULEURS_TAUX = {
  bas: { fond: 'FDE2E2', texte: 'B91C1C' },
  moyen: { fond: 'FEF3C7', texte: '92620A' },
  haut: { fond: 'D1FAE5', texte: '047857' },
};

/** Le seul `<w:tbl>` de ce canevas — une simple liste, pas une grille. */
function extraireTableau(xml) {
  return extraireTableaux(xml)[0] ?? null;
}

/**
 * La cellule Taux : fond + texte de la couleur du palier, une ligne par taux
 * (global, puis présentiel et synchrone). Sans avancement connu (aucune masse déclarée
 * pour ce groupe × module), la cellule reste nue — un pourcentage inventé
 * mentirait plus qu'une case vide.
 */
function celluleTaux(tcModele, ligne) {
  const { taux, niveau } = ligne;
  if (taux === null || taux === undefined) {
    const sansFond = tcModele.replace(/<w:shd[^/]*\/>/, '');
    const paragraphes = sansFond.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
    return paragraphes.reduce(
      (tc, paragraphe) => tc.replace(paragraphe, paragraphe.replace(/<w:r>[\s\S]*?<\/w:r>/, '')),
      sansFond
    );
  }

  const couleurs = COULEURS_TAUX[niveau] ?? COULEURS_TAUX.bas;
  const tc = tcModele.replace(/<w:shd[^/]*\/>/, `<w:shd w:val="clear" w:color="auto" w:fill="${couleurs.fond}"/>`);

  const construireParagraphe = (texte) =>
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:bCs/><w:color w:val="${couleurs.texte}"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr><w:t xml:space="preserve">${echapperXml(texte)}</w:t></w:r></w:p>`;

  const paragraphes = tc.match(/<w:p\b[\s\S]*?<\/w:p>/g);
  if (!paragraphes || paragraphes.length === 0) return tc;

  /*
   * ⚠️ UNE LIGNE PAR TAUX (2026-10-26, maquette du porteur) : « Global : 22%
   *    (30h / 135h) », puis « Présentiel : … » et « Synchrone : … ». Les
   *    paragraphes du canevas cèdent la place à ces lignes : le premier les
   *    reçoit toutes, les suivants sont retirés.
   */
  const lignes = lignesTaux(ligne).map(construireParagraphe).join('');
  return paragraphes.reduce(
    (cellule, paragraphe, index) => cellule.replace(paragraphe, index === 0 ? lignes : ''),
    tc
  );
}

/**
 * Tout le texte du tableau en 11 pt (2026-10-26, demande du porteur).
 *
 * ⚠️ SUR CHAQUE RUN, PAS SUR LE STYLE : les cellules du canevas portent leurs
 *    propres tailles, qui l'emporteraient sur un style. Word compte en
 *    DEMI-points : 11 pt = 22. La marque de paragraphe suit aussi, sans quoi
 *    une cellule vide (Absence, Émargement) garderait la hauteur d'avant.
 */
const TAILLE_TABLEAU = 22;
/** Le titre de la feuille (« Au Titre de l'année… », « Date : … ») en 14 pt (2026-10-26). */
const TAILLE_TITRE = 28;

function texteEnOnzePoints(xmlTableau) {
  return texteEnTaille(xmlTableau, TAILLE_TABLEAU);
}

/**
 * L'en-tête sans son dernier paragraphe s'il est VIDE (2026-10-27, demande du
 * porteur : « diminue l'espace au-dessus du titre »). Le canevas finit par une
 * ligne blanche sous le filet de séparation : elle repoussait tout le corps
 * d'une ligne entière.
 *
 * ⚠️ SEULEMENT S'IL NE PORTE RIEN — ni texte, ni image, ni forme : le logo est
 *    ancré dans un paragraphe vide lui aussi, et il ne doit pas disparaître.
 *    Un en-tête garde toujours au moins un paragraphe.
 */
function sansParagrapheVideFinal(xmlEntete) {
  const paragraphes = xmlEntete.match(/<w:p\b[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g) ?? [];
  if (paragraphes.length < 2) return xmlEntete;
  const dernier = paragraphes[paragraphes.length - 1];
  const vide = !/<w:t\b|<w:drawing|<w:pict|<w:object|mc:AlternateContent/.test(dernier);
  if (!vide) return xmlEntete;
  /*
   * ⚠️ ÉCRASÉ, PAS SUPPRIMÉ : ce paragraphe suit le TABLEAU de l'en-tête, et
   *    Word exige un paragraphe après un tableau — sans lui, il déclare le
   *    fichier endommagé (LibreOffice, plus tolérant, ne le dirait pas). On le
   *    garde donc, réduit à une hauteur d'un point.
   */
  const minuscule =
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>' +
    '<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>';
  const position = xmlEntete.lastIndexOf(dernier);
  return xmlEntete.slice(0, position) + minuscule + xmlEntete.slice(position + dernier.length);
}

/**
 * Le titre de l'en-tête centré sur la PAGE, et non dans sa colonne
 * (2026-10-27, demande du porteur : « centrer l'entête avec le titre »).
 *
 * L'en-tête du canevas est un tableau à deux colonnes : le logo (1 500 twips),
 * puis le titre et l'établissement, centrés dans le reste — donc décalés d'une
 * demi-largeur de logo vers la droite par rapport à « Au Titre de l'année ».
 * Un retrait à DROITE égal à la colonne du logo les ramène au centre de la
 * page ; le filet sous l'établissement devient symétrique.
 *
 * ⚠️ LA LARGEUR SE LIT DANS LE CANEVAS (première `gridCol`), jamais en dur.
 * ⚠️ L'ORDRE DES ENFANTS DE `w:pPr` EST IMPOSÉ PAR LE SCHÉMA : `w:ind` vient
 *    avant `w:jc` (et avant `w:rPr`) — ailleurs, Word refuse le fichier.
 */
function titreCentreSurLaPage(xmlEntete) {
  const largeurLogo = Number(xmlEntete.match(/<w:gridCol w:w="(\d+)"/)?.[1]);
  if (!largeurLogo) return xmlEntete;

  const cellules = [...xmlEntete.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)];
  if (cellules.length < 2) return xmlEntete;
  const { 0: colonneTitre, index } = cellules[1];

  const retrait = `<w:ind w:right="${largeurLogo}"/>`;
  const recentree = colonneTitre.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/g, (pPr, contenu) => {
    if (contenu.includes('<w:ind')) return pPr;
    const avant = ['<w:jc', '<w:rPr>'].map((balise) => contenu.indexOf(balise)).filter((i) => i >= 0);
    const position = avant.length ? Math.min(...avant) : contenu.length;
    return `<w:pPr>${contenu.slice(0, position)}${retrait}${contenu.slice(position)}</w:pPr>`;
  });

  return xmlEntete.slice(0, index) + recentree + xmlEntete.slice(index + colonneTitre.length);
}

/**
 * ═══ LA NUMÉROTATION DES PAGES — « 1 / 2 » ═══ (2026-10-27, demande du
 * porteur : « numérote les pages (numéro de page / nombre de pages) ».)
 * Le canevas n'a pas de pied de page : on en AJOUTE un, centré, fait de deux
 * champs Word — PAGE et NUMPAGES — que Word et LibreOffice (donc le PDF)
 * calculent eux-mêmes. Un nombre écrit en dur serait faux dès la 2ᵉ page.
 *
 * ⚠️ QUATRE ENDROITS À TENIR ENSEMBLE, sinon Word déclare le fichier endommagé :
 *    la partie `word/footer1.xml`, sa relation, son type de contenu, et la
 *    `w:footerReference` de la section (juste après la `w:headerReference`).
 */
const RELATION_PIED = 'rIdPiedDePage';
const champ = (instruction, valeur) =>
  `<w:fldSimple w:instr=" ${instruction} "><w:r><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>${valeur}</w:t></w:r></w:fldSimple>`;
const texte = (valeur) =>
  `<w:r><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t xml:space="preserve">${valeur}</w:t></w:r>`;
const PIED_DE_PAGE =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${champ('PAGE', '1')}${texte(' / ')}${champ('NUMPAGES', '1')}</w:p>` +
  '</w:ftr>';

async function ajouterNumerotation(zip, xmlDocument) {
  zip.file('word/footer1.xml', PIED_DE_PAGE);

  const fichierRelations = zip.file('word/_rels/document.xml.rels');
  if (fichierRelations) {
    const relations = await fichierRelations.async('string');
    if (!relations.includes(`Id="${RELATION_PIED}"`)) {
      zip.file(
        'word/_rels/document.xml.rels',
        relations.replace(
          '</Relationships>',
          `<Relationship Id="${RELATION_PIED}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`
        )
      );
    }
  }

  const fichierTypes = zip.file('[Content_Types].xml');
  if (fichierTypes) {
    const types = await fichierTypes.async('string');
    if (!types.includes('/word/footer1.xml')) {
      zip.file(
        '[Content_Types].xml',
        types.replace(
          '</Types>',
          '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'
        )
      );
    }
  }

  // La référence dans la section : après celle de l'en-tête, comme le veut le schéma.
  if (xmlDocument.includes('<w:footerReference')) return xmlDocument;
  const reference = `<w:footerReference w:type="default" r:id="${RELATION_PIED}"/>`;
  return /<w:headerReference\b[^>]*\/>/.test(xmlDocument)
    ? xmlDocument.replace(/(<w:headerReference\b[^>]*\/>)(?![\s\S]*<w:headerReference)/, `$1${reference}`)
    : xmlDocument.replace(/(<w:sectPr\b[^>]*>)/, `$1${reference}`);
}

/** Tous les runs d'un fragment XML à `demiPoints` (11 pt = 22, 14 pt = 28). */
function texteEnTaille(xmlFragment, demiPoints) {
  const taille = `<w:sz w:val="${demiPoints}"/><w:szCs w:val="${demiPoints}"/>`;
  const retailler = (rPr) =>
    rPr.replace(/<w:sz(?:Cs)?(?=[ \t/>])[^>]*\/>/g, '').replace('</w:rPr>', `${taille}</w:rPr>`);

  return xmlFragment
    // Les propriétés de run existantes (dans un run ou dans une marque de paragraphe).
    .replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, retailler)
    .replace(/<w:rPr\/>/g, `<w:rPr>${taille}</w:rPr>`)
    // Un run sans propriétés : on lui en donne. (`<w:rPr…` ne correspond pas : après « r », ni espace ni « > ».)
    .replace(/(<w:r(?:\s[^>]*)?>)(?!<w:rPr)/g, `$1<w:rPr>${taille}</w:rPr>`);
}

/**
 * La largeur des colonnes, en twips (dxa) — d'après la maquette du porteur
 * (2026-10-26) : le Module et le Taux s'élargissent, le Formateur et les
 * horaires se resserrent. ⚠️ LE TOTAL RESTE CELUI DU CANEVAS (15 138) : le
 * tableau garde sa largeur de page, en paysage.
 *
 *            Formateur Groupe Module Espace Horaire Taux  Absence Émargement
 */
const LARGEURS_COLONNES = [1606, 1716, 4153, 941, 908, 3156, 1085, 1573];

function appliquerLargeurs(xmlTableau) {
  const grille = `<w:tblGrid>${LARGEURS_COLONNES.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  return xmlTableau
    .replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/, grille)
    .replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (rangee) => {
      let colonne = 0;
      return rangee.replace(/<w:tcW\b[^>]*\/>/g, (largeur) => {
        const w = LARGEURS_COLONNES[colonne++];
        return w ? `<w:tcW w:w="${w}" w:type="dxa"/>` : largeur;
      });
    });
}

/** Une ligne de données — un bloc de cours d'un formateur. */
function construireLigne(gabaritTcs, ligne) {
  const neuves = [...gabaritTcs];
  neuves[0] = celluleTexteSimple(neuves[0], ligne.formateur);
  neuves[1] = celluleTexteSimple(neuves[1], ligne.groupe);
  // ⚠️ LE NOM COMPLET À CÔTÉ DU CODE (2026-09-25, demande du porteur) —
  // `moduleAffiche` (« M102 - Nom complet »), déjà résolu par
  // `exportEmargement.service.js` ; le seul code en repli si le module est
  // hors référentiel DRIF.
  neuves[2] = celluleTexteSimple(neuves[2], ligne.moduleAffiche ?? ligne.module);
  neuves[3] = celluleTexteSimple(neuves[3], ligne.salle);
  neuves[4] = celluleTexteSimple(neuves[4], `${ligne.debut.replace(':', 'h')} - ${ligne.fin.replace(':', 'h')}`);
  neuves[5] = celluleTaux(neuves[5], ligne);
  // neuves[6] (Absence) et neuves[7] (Émargement) restent VIERGES, tels quels.
  return neuves;
}

export async function construireDocxEmargement(donnees) {
  const { etablissement, jour, date, semaineLabel, lignes } = donnees;

  const tampon = await chargerCanevasTampon(CHEMIN_CANEVAS);
  const zip = await JSZip.loadAsync(tampon);

  const fichierDocument = zip.file('word/document.xml');
  const fichierHeader = zip.file('word/header1.xml');
  if (!fichierDocument || !fichierHeader) {
    throw new Error('Canevas Word illisible : document.xml ou header1.xml absent du modèle');
  }

  let xmlEntete = await fichierHeader.async('string');
  xmlEntete = remplacerBalise(
    xmlEntete,
    'Emploi du temps journalier - LUNDI',
    `Emploi du temps journalier - ${jour.toUpperCase()}`
  );
  xmlEntete = remplacerBalise(
    xmlEntete,
    'INSTITUT SPECIALISE DE TECHNOLOGIE APPLIQUEE SIDI HAJJAJ OUED HASSAR',
    echapperXml(etablissement?.nom)
  );
  zip.file('word/header1.xml', titreCentreSurLaPage(sansParagrapheVideFinal(xmlEntete)));

  let xml = await fichierDocument.async('string');
  xml = remplacerBalise(
    xml,
    "Au Titre de l'année 2026-2027",
    `Au Titre de l'année ${donnees.anneeScolaire}-${donnees.anneeScolaire + 1}`
  );
  xml = remplacerBalise(
    xml,
    'Date : 21/09/2026 (Semaine S4)',
    `Date : ${dateFr(date)} (Semaine ${semaineLabel})`
  );
  /*
   * ⚠️ LE TITRE EN 14 PT (2026-10-26, demande du porteur) : les deux lignes
   *    au-dessus du tableau, en 9 pt dans le canevas. Seuls LEURS paragraphes
   *    sont retaillés — repérés par leur texte, jamais par leur rang.
   */
  const debutTableau = xml.indexOf('<w:tbl>');
  xml =
    xml.slice(0, debutTableau).replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphe) =>
      /Au Titre de l'ann|Au Titre de l&apos;ann|Date : /.test(paragraphe)
        ? // ⚠️ ET SANS ESPACE AVANT (2026-10-27, demande du porteur : « diminue
          //    l'espace au-dessus du titre ») — l'en-tête en ménage déjà assez.
          texteEnTaille(paragraphe, TAILLE_TITRE).replace(/w:before="\d+"/, 'w:before="0"')
        : paragraphe
    ) + xml.slice(debutTableau);

  const tableau = extraireTableau(xml);
  if (!tableau) throw new Error('Canevas Word illisible : le tableau attendu est absent');

  const [ligneEntete, gabaritImpair, gabaritPair] = extraireLignes(tableau.contenu);
  if (!ligneEntete || !gabaritImpair || !gabaritPair) {
    throw new Error('Canevas Word illisible : les gabarits de ligne attendus sont absents');
  }

  const ligneEnteteXml = assemblerLigne(ligneEntete.avantPremierTc, ligneEntete.tcs);

  const lignesXml = lignes
    .map((ligne, index) => {
      const gabarit = index % 2 === 0 ? gabaritImpair : gabaritPair;
      // ⚠️ INSÉCABLE (2026-10-27) : une ligne trop haute pour le bas de page passe ENTIÈRE à la suivante.
      return assemblerLigne(insecable(gabarit.avantPremierTc), construireLigne(gabarit.tcs, ligne));
    })
    .join('');

  const nouveauTableau = texteEnOnzePoints(`${ligneEnteteXml}${lignesXml}`);
  const preambule = tableau.contenu.slice(0, tableau.contenu.indexOf(ligneEntete.avantPremierTc));
  const xmlFinal =
    xml.slice(0, tableau.debut) +
    appliquerLargeurs(preambule + nouveauTableau) +
    '</w:tbl>' +
    xml.slice(tableau.fin);

  zip.file('word/document.xml', await ajouterNumerotation(zip, xmlFinal));

  // ⚠️ MÊME SUBSTITUTION QUE L'EMPLOI GLOBAL : « Aptos », la police par défaut
  // du canevas, n'est presque jamais installée — voir `exportGlobalDocx.js`.
  const fichierStyles = zip.file('word/styles.xml');
  if (fichierStyles) {
    const stylesXml = await fichierStyles.async('string');
    zip.file('word/styles.xml', stylesXml.replaceAll('Aptos', 'Calibri'));
  }

  const tamponFinal = await zip.generateAsync({ type: 'nodebuffer' });

  return {
    tampon: tamponFinal,
    nomFichier: nomFichierEmargement(donnees, 'docx'),
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}
