import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { celluleTexteSimple, echapperXml } from '../seances/xmlCellules.js';
import { chargerCanevasTampon } from '../seances/canevasCache.js';
import { assemblerLigne, extraireLignes, extraireTableaux, remplacerBalise } from '../seances/xmlTableaux.js';
import { nomFichierAffectation, texteHeures } from './exportAffectationFormateurTexte.js';

/**
 * Le Word de l'affectation annuelle d'un formateur — GREFFÉ dans le canevas
 * transmis (2026-10-01), suivant la méthode des autres exports du projet : le
 * fichier réel sert de gabarit, seul le TEXTE des cellules change.
 *
 * ═══ COMMENT CE CANEVAS EST FAIT ═══
 * Trois paragraphes (Année de Formation, Formateur, « Affectations
 * Présentiel »), puis TROIS tableaux :
 *   1. Présentiel — en-tête (Groupe / Module / Masse Horaire), lignes de
 *      données identiques, puis « Total Présentiel : » (deux colonnes fusionnées) ;
 *   2. Synchrone — la même forme, « Fusion Groupe » en première colonne ;
 *   3. les signatures (Formateur / Directeur), laissées telles quelles.
 * Entre les deux derniers, le paragraphe « TOTAL GLOBAL : … Heures ».
 *
 * ⚠️ UNE SEULE LIGNE-GABARIT PAR TABLEAU, LA PREMIÈRE DE DONNÉES : les autres
 * lignes de l'exemplaire (ABDELHAK CHARKAOUI) sont jetées, et la première est
 * clonée autant de fois qu'il y a d'affectations.
 *
 * ⚠️ LE LOGO DU CANEVAS TRANSMIS A ÉTÉ REMPLACÉ par le nouveau logo OFPPT, le
 * même que les six autres canevas (commit « nouveau logo OFPPT dans les
 * canevas Word ») — mêmes dimensions et même recadrage, rien d'autre à régler.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CHEMIN_CANEVAS_AFFECTATION = path.join(__dirname, 'canevas', 'affectationFormateur.docx');

/** Les textes de l'exemplaire, remplacés tels quels. */
const EXEMPLE = {
  etablissement: 'INSTITUT SPECIALISE DE TECHNOLOGIE APPLIQUEE SIDI HAJJAJ OUED HASSAR',
  annee: 'Année de Formation : 2026-2027',
  formateur: 'Formateur : ABDELHAK CHARKAOUI',
  totalGlobal: 'TOTAL GLOBAL : 1062.50 Heures',
};

/** Remplit un tableau d'affectations : en-tête gardé, données clonées, total réécrit. */
function remplirTableau(xmlTableau, lignes, total) {
  const rangees = extraireLignes(xmlTableau);
  const [entete, gabarit] = rangees;
  const ligneTotal = rangees.at(-1);
  if (!entete || !gabarit || rangees.length < 3) {
    throw new Error('Canevas Word illisible : un tableau d’affectations a changé de forme');
  }

  const donnees = lignes
    .map((ligne) =>
      assemblerLigne(gabarit.avantPremierTc, [
        celluleTexteSimple(gabarit.tcs[0], ligne.groupe),
        celluleTexteSimple(gabarit.tcs[1], ligne.module),
        celluleTexteSimple(gabarit.tcs[2], texteHeures(ligne.heures)),
      ])
    )
    .join('');

  const totalTcs = [...ligneTotal.tcs];
  totalTcs[totalTcs.length - 1] = celluleTexteSimple(totalTcs.at(-1), texteHeures(total));

  const debutEntete = xmlTableau.indexOf(entete.avantPremierTc);
  return (
    xmlTableau.slice(0, debutEntete) +
    assemblerLigne(entete.avantPremierTc, entete.tcs) +
    donnees +
    assemblerLigne(ligneTotal.avantPremierTc, totalTcs) +
    '</w:tbl>'
  );
}

export async function construireDocxAffectationFormateur(donnees) {
  const { etablissement, anneeScolaire, formateur, presentiel, synchrone } = donnees;

  const zip = await JSZip.loadAsync(await chargerCanevasTampon(CHEMIN_CANEVAS_AFFECTATION));
  const fichierDocument = zip.file('word/document.xml');
  const fichierEntete = zip.file('word/header1.xml');
  if (!fichierDocument || !fichierEntete) {
    throw new Error('Canevas Word illisible : document.xml ou header1.xml absent du modèle');
  }

  /*
   * ⚠️ « APTOS » → « CALIBRI » (2026-10-01, signalé par le porteur : « en PDF le
   * texte gras ») — le titre et le nom de l'établissement du canevas sont en
   * Aptos, qui n'existe pas sur le serveur : LibreOffice la remplaçait par une
   * police plus large et plus grasse. Calibri, elle, a son équivalent métrique
   * (Carlito), comme pour les autres canevas (`exportGlobalDocx.js`).
   *
   * Elle est aussi plus ÉTROITE qu'Aptos : dans Word, un nom d'établissement
   * long (« … BEN M'SIK CASABLANCA ») débordait à gauche de sa case, et son
   * « I » initial disparaissait.
   */
  const entete = (await fichierEntete.async('string')).replaceAll('Aptos', 'Calibri');
  zip.file(
    'word/header1.xml',
    remplacerBalise(entete, EXEMPLE.etablissement, echapperXml(etablissement?.nom ?? ''))
  );
  const fichierStyles = zip.file('word/styles.xml');
  if (fichierStyles) {
    zip.file('word/styles.xml', (await fichierStyles.async('string')).replaceAll('Aptos', 'Calibri'));
  }

  let xml = await fichierDocument.async('string');
  xml = remplacerBalise(xml, EXEMPLE.annee, `Année de Formation : ${anneeScolaire}-${anneeScolaire + 1}`);
  xml = remplacerBalise(xml, EXEMPLE.formateur, `Formateur : ${echapperXml(formateur)}`);
  xml = remplacerBalise(xml, EXEMPLE.totalGlobal, `TOTAL GLOBAL : ${texteHeures(donnees.totalGlobal)} Heures`);

  const [tablePresentiel, tableSynchrone] = extraireTableaux(xml);
  if (!tablePresentiel || !tableSynchrone) {
    throw new Error('Canevas Word illisible : les tableaux d’affectations sont absents');
  }

  // Du DERNIER au premier : remplacer le premier décalerait les bornes du second.
  xml =
    xml.slice(0, tableSynchrone.debut) +
    remplirTableau(tableSynchrone.contenu, synchrone, donnees.totalSynchrone) +
    xml.slice(tableSynchrone.fin);
  xml =
    xml.slice(0, tablePresentiel.debut) +
    remplirTableau(tablePresentiel.contenu, presentiel, donnees.totalPresentiel) +
    xml.slice(tablePresentiel.fin);

  zip.file('word/document.xml', xml);

  return {
    tampon: await zip.generateAsync({ type: 'nodebuffer' }),
    nomFichier: nomFichierAffectation(formateur, 'docx'),
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}
