import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { celluleTexteSimple, echapperXml } from './xmlCellules.js';
import { chargerCanevasTampon } from './canevasCache.js';
import { dateFr, nomFichierEmargement } from './exportEmargementTexte.js';
import { assemblerLigne, extraireLignes, extraireTableaux, remplacerBalise } from './xmlTableaux.js';

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
 * La cellule Taux : fond + texte de la couleur du palier, deux paragraphes
 * (pourcentage, puis heures). Sans avancement connu (aucune masse déclarée
 * pour ce groupe × module), la cellule reste nue — un pourcentage inventé
 * mentirait plus qu'une case vide.
 */
function celluleTaux(tcModele, { taux, prevu, pose, niveau }) {
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
  if (!paragraphes || paragraphes.length < 2) return tc;

  return tc
    .replace(paragraphes[0], construireParagraphe(`${taux}%`))
    .replace(paragraphes[1], construireParagraphe(`(${pose}h / ${prevu}h)`));
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
  zip.file('word/header1.xml', xmlEntete);

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
      return assemblerLigne(gabarit.avantPremierTc, construireLigne(gabarit.tcs, ligne));
    })
    .join('');

  const nouveauTableau = `${ligneEnteteXml}${lignesXml}`;
  const preambule = tableau.contenu.slice(0, tableau.contenu.indexOf(ligneEntete.avantPremierTc));
  const xmlFinal =
    xml.slice(0, tableau.debut) + preambule + nouveauTableau + '</w:tbl>' + xml.slice(tableau.fin);

  zip.file('word/document.xml', xmlFinal);

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
