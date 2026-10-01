import ExcelJS from 'exceljs';
import { nomFichierAffectation } from './exportAffectationFormateurTexte.js';

/**
 * L'Excel de l'affectation annuelle d'un formateur — la même page que le Word :
 * titre, établissement, année, formateur, puis les tableaux Présentiel et
 * Synchrone avec leur total, le total global et les signatures.
 *
 * ⚠️ LES HEURES SONT DES NOMBRES, PAS DU TEXTE (format `0.00`) : le fichier se
 * retravaille, et un « 45.00 » en texte ne se somme pas.
 */

const GRIS_ENTETE = 'FFFAFAFA';
const bordureFine = { style: 'thin', color: { argb: 'FF000000' } };
const bordureTout = { top: bordureFine, left: bordureFine, bottom: bordureFine, right: bordureFine };

function ligneCentree(feuille, numero, texte, police = { bold: true }) {
  feuille.mergeCells(numero, 1, numero, 3);
  const cellule = feuille.getCell(numero, 1);
  cellule.value = texte;
  cellule.font = police;
  cellule.alignment = { horizontal: 'center', vertical: 'middle' };
}

/** Un tableau d'affectations, à partir de la ligne `debut` ; rend la ligne qui suit. */
function tableau(feuille, debut, { titre, entetePremiere, lignes, total, libelleTotal }) {
  feuille.getCell(debut, 1).value = titre;
  feuille.getCell(debut, 1).font = { bold: true, size: 12 };

  const entete = feuille.getRow(debut + 1);
  [entetePremiere, 'Module', 'Masse Horaire (H)'].forEach((texte, index) => {
    const cellule = entete.getCell(index + 1);
    cellule.value = texte;
    cellule.font = { bold: true };
    cellule.alignment = { horizontal: 'center', vertical: 'middle' };
    cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_ENTETE } };
    cellule.border = bordureTout;
  });

  lignes.forEach((ligne, index) => {
    const rangee = feuille.getRow(debut + 2 + index);
    rangee.getCell(1).value = ligne.groupe;
    rangee.getCell(2).value = ligne.module;
    rangee.getCell(3).value = ligne.heures;
    rangee.getCell(3).numFmt = '0.00';
    [1, 2, 3].forEach((colonne) => {
      const cellule = rangee.getCell(colonne);
      cellule.border = bordureTout;
      cellule.alignment = { horizontal: colonne === 2 ? 'left' : 'center', vertical: 'middle', wrapText: colonne === 2 };
    });
  });

  const numeroTotal = debut + 2 + lignes.length;
  feuille.mergeCells(numeroTotal, 1, numeroTotal, 2);
  const libelle = feuille.getCell(numeroTotal, 1);
  libelle.value = libelleTotal;
  libelle.alignment = { horizontal: 'right' };
  const valeur = feuille.getCell(numeroTotal, 3);
  valeur.value = total;
  valeur.numFmt = '0.00';
  valeur.alignment = { horizontal: 'center' };
  [1, 2, 3].forEach((colonne) => {
    const cellule = feuille.getCell(numeroTotal, colonne);
    cellule.font = { bold: true };
    cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_ENTETE } };
    cellule.border = bordureTout;
  });

  return numeroTotal + 2;
}

export async function construireXlsxAffectationFormateur(donnees) {
  const { etablissement, anneeScolaire, formateur, presentiel, synchrone } = donnees;

  const classeur = new ExcelJS.Workbook();
  const feuille = classeur.addWorksheet('Affectation', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ligneCentree(feuille, 1, 'Affectation Annuelle Formateur', { bold: true, size: 14 });
  ligneCentree(feuille, 2, etablissement?.nom ?? '');
  feuille.getCell(4, 1).value = `Année de Formation : ${anneeScolaire}-${anneeScolaire + 1}`;
  feuille.getCell(5, 1).value = `Formateur : ${formateur}`;
  feuille.getCell(5, 1).font = { bold: true };

  let suivante = tableau(feuille, 7, {
    titre: 'Affectations Présentiel',
    entetePremiere: 'Groupe',
    lignes: presentiel,
    total: donnees.totalPresentiel,
    libelleTotal: 'Total Présentiel :',
  });
  suivante = tableau(feuille, suivante, {
    titre: 'Affectations Synchrone',
    entetePremiere: 'Fusion Groupe',
    lignes: synchrone,
    total: donnees.totalSynchrone,
    libelleTotal: 'Total Synchrone :',
  });

  ligneCentree(feuille, suivante, `TOTAL GLOBAL : ${donnees.totalGlobal.toFixed(2)} Heures`, { bold: true, size: 12 });

  feuille.getCell(suivante + 2, 1).value = 'Formateur :';
  feuille.getCell(suivante + 2, 3).value = 'Directeur :';
  feuille.getCell(suivante + 2, 1).font = { bold: true };
  feuille.getCell(suivante + 2, 3).font = { bold: true };

  feuille.getColumn(1).width = 24;
  feuille.getColumn(2).width = 60;
  feuille.getColumn(3).width = 18;

  return {
    tampon: Buffer.from(await classeur.xlsx.writeBuffer()),
    nomFichier: nomFichierAffectation(formateur, 'xlsx'),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
