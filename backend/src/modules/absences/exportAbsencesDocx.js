import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { celluleTexteSimple, echapperXml } from '../seances/xmlCellules.js';
import { chargerCanevasTampon } from '../seances/canevasCache.js';
import { assemblerLigne, avecHauteurMinimale, extraireLignes, extraireTableaux, remplacerBalise } from '../seances/xmlTableaux.js';
import { dateFr, nomFichierAbsences, texteHeures } from './exportAbsencesTexte.js';

/**
 * Le Word du rapport des absences — GREFFÉ dans le canevas transmis par
 * l'établissement (2026-09-29, demande du porteur : « en absence je veux
 * ajouter qu'il être exporté en Word et PDF et Excel à l'aide de LibreOffice,
 * voici le canvas »), suivant EXACTEMENT la méthode des exports de la page
 * Édition : le fichier réel de l'établissement sert de gabarit, seul le
 * TEXTE des cellules change.
 *
 * ═══ COMMENT CE CANEVAS-CI EST FAIT ═══
 * Une simple LISTE, comme l'émargement : un tableau à 9 colonnes (Date,
 * Semaine, Jour, Séance, Formateur, Groupe, Module, Observation, Rattrapage),
 * une ligne par SÉANCE MANQUÉE — jamais fusionnée, chacune garde SON motif et
 * SON rattrapage, comme le registre à l'écran. Les deux premières lignes de
 * données du canevas alternent un fond BLANC et un fond GRIS CLAIR (`F2F2F2`,
 * en zèbre) : on les clone en alternance, comme pour l'émargement.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHEMIN_CANEVAS = path.join(__dirname, 'canevas', 'rapportAbsences.docx');

const HAUTEUR_LIGNE_NORMALE = 130;

/*
 * ⚠️⚠️ AUCUN `<w:rFonts>` EXPLICITE NULLE PART (2026-09-29, signalé par le
 * porteur : « le même problème que l'emploi du temps, fixé depuis la même
 * logique ») — LA vraie différence trouvée avec le canevas de l'émargement,
 * qui n'a JAMAIS ce problème : AUCUNE de ses lignes, dans `document.xml`
 * COMME `header1.xml`, ne déclare de police — tout hérite du seul défaut du
 * document (`docDefaults`, remplacé plus bas). CE canevas-ci, lui, écrit
 * « Calibri » EN DUR sur 479 lignes de `document.xml`, ET « Aptos » (jamais
 * remplacé jusqu'ici — le correctif plus bas ne touchait QUE `styles.xml`,
 * pas ce fichier-ci) sur les 7 lignes de `header1.xml`. Un document qui
 * réclame sa police par DEUX voies différentes (le défaut, et une déclaration
 * explicite du même nom) fait sous-ensembler LibreOffice deux fois — constaté
 * ici même via `doc.get_page_fonts()` : deux polices « Calibri » distinctes
 * incorporées au même PDF. On retire donc TOUTE déclaration explicite, dans
 * les deux fichiers, pour que tout hérite d'UNE SEULE source — exactement
 * comme l'émargement.
 */
const RFONTS_EXPLICITE = /<w:rFonts\b[^>]*\/>/g;
const sansRFontsExplicite = (xml) => xml.replace(RFONTS_EXPLICITE, '');

/** Une ligne de données — une séance manquée. */
function construireLigne(gabaritTcs, ligne) {
  const neuves = [...gabaritTcs];
  neuves[0] = celluleTexteSimple(neuves[0], ligne.dateAbsence);
  neuves[1] = celluleTexteSimple(neuves[1], ligne.semaine);
  neuves[2] = celluleTexteSimple(neuves[2], ligne.jour);
  neuves[3] = celluleTexteSimple(neuves[3], ligne.seance);
  neuves[4] = celluleTexteSimple(neuves[4], ligne.formateurNom);
  neuves[5] = celluleTexteSimple(neuves[5], ligne.groupe);
  neuves[6] = celluleTexteSimple(neuves[6], ligne.module);
  neuves[7] = celluleTexteSimple(neuves[7], ligne.observation);
  neuves[8] = celluleTexteSimple(neuves[8], ligne.dateRattrapage ? 'Oui' : 'Non');
  return neuves;
}

export async function construireDocxAbsences(donnees) {
  const { etablissement, genereLe, nombreSeances, heures, lignes } = donnees;

  const tampon = await chargerCanevasTampon(CHEMIN_CANEVAS);
  const zip = await JSZip.loadAsync(tampon);

  const fichierDocument = zip.file('word/document.xml');
  const fichierHeader = zip.file('word/header1.xml');
  if (!fichierDocument || !fichierHeader) {
    throw new Error('Canevas Word illisible : document.xml ou header1.xml absent du modèle');
  }

  let xmlEntete = await fichierHeader.async('string');
  xmlEntete = sansRFontsExplicite(xmlEntete);
  xmlEntete = remplacerBalise(
    xmlEntete,
    'INSTITUT SPECIALISE DE TECHNOLOGIE APPLIQUEE SIDI HAJJAJ OUED HASSAR',
    echapperXml(etablissement?.nom)
  );
  zip.file('word/header1.xml', xmlEntete);

  let xml = await fichierDocument.async('string');
  xml = sansRFontsExplicite(xml);
  xml = remplacerBalise(xml, ' 27/09/2026', ` ${dateFr(genereLe)}`);
  xml = remplacerBalise(
    xml,
    ' 58 séances (145 heures)',
    ` ${nombreSeances} séance${nombreSeances > 1 ? 's' : ''} (${texteHeures(heures)} heures)`
  );

  const [tableau] = extraireTableaux(xml);
  if (!tableau) throw new Error('Canevas Word illisible : le tableau attendu est absent');

  const [ligneEntete, gabaritImpair, gabaritPair] = extraireLignes(tableau.contenu);
  if (!ligneEntete || !gabaritImpair || !gabaritPair) {
    throw new Error('Canevas Word illisible : les gabarits de ligne attendus sont absents');
  }

  const ligneEnteteXml = assemblerLigne(ligneEntete.avantPremierTc, ligneEntete.tcs);

  const lignesXml = lignes
    .map((ligne, index) => {
      const gabarit = index % 2 === 0 ? gabaritImpair : gabaritPair;
      return assemblerLigne(
        avecHauteurMinimale(gabarit.avantPremierTc, HAUTEUR_LIGNE_NORMALE),
        construireLigne(gabarit.tcs, ligne)
      );
    })
    .join('');

  const nouveauTableau = `${ligneEnteteXml}${lignesXml}`;
  const preambule = tableau.contenu.slice(0, tableau.contenu.indexOf(ligneEntete.avantPremierTc));
  const xmlFinal =
    xml.slice(0, tableau.debut) + preambule + nouveauTableau + '</w:tbl>' + xml.slice(tableau.fin);

  zip.file('word/document.xml', xmlFinal);

  // ⚠️ LA SEULE SOURCE DE POLICE QUI RESTE, maintenant que le corps et
  // l'en-tête n'en déclarent plus aucune — voir le commentaire en tête de
  // fichier. Même règle que `exportGlobalDocx.js` pour « Aptos » ; « Times New
  // Roman » (le défaut d'origine de CE canevas-ci) suit pour la même raison.
  const fichierStyles = zip.file('word/styles.xml');
  if (fichierStyles) {
    const stylesXml = await fichierStyles.async('string');
    zip.file('word/styles.xml', stylesXml.replaceAll('Aptos', 'Calibri').replaceAll('Times New Roman', 'Calibri'));
  }

  const tamponFinal = await zip.generateAsync({ type: 'nodebuffer' });

  return {
    tampon: tamponFinal,
    nomFichier: nomFichierAbsences('docx'),
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}
