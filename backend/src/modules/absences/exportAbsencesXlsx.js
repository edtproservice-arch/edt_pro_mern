import ExcelJS from 'exceljs';
import { dateFr, nomFichierAbsences, texteHeures } from './exportAbsencesTexte.js';

/**
 * L'Excel du rapport des absences — la même liste que le Word : une ligne
 * d'en-tête, puis une ligne par séance manquée, en zèbre.
 */

const GRIS_ENTETE = 'FFFAFAFA';
const ZEBRE = 'FFF2F2F2';

const bordureFine = { style: 'thin', color: { argb: 'FFCCCCCC' } };
const bordureTout = { top: bordureFine, left: bordureFine, bottom: bordureFine, right: bordureFine };

const ENTETES = ['Date', 'Semaine', 'Jour', 'Séance', 'Formateur', 'Groupe', 'Module', 'Observation', 'Rattrapage'];
const LARGEURS = [16, 10, 12, 9, 24, 14, 12, 30, 11];

export async function construireXlsxAbsences(donnees) {
  const { etablissement, genereLe, nombreSeances, heures, lignes } = donnees;

  const classeur = new ExcelJS.Workbook();
  const feuille = classeur.addWorksheet('Absences', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 4 }],
  });

  feuille.mergeCells(1, 1, 1, ENTETES.length);
  feuille.getCell(1, 1).value = 'Rapport des Absences';
  feuille.getCell(1, 1).font = { bold: true, size: 14 };
  feuille.getCell(1, 1).alignment = { horizontal: 'center' };

  feuille.mergeCells(2, 1, 2, ENTETES.length);
  feuille.getCell(2, 1).value = etablissement?.nom ?? '';
  feuille.getCell(2, 1).font = { bold: true };
  feuille.getCell(2, 1).alignment = { horizontal: 'center' };

  feuille.mergeCells(3, 1, 3, ENTETES.length);
  feuille.getCell(3, 1).value =
    `Généré le : ${dateFr(genereLe)} — Total des absences : ${nombreSeances} séance${nombreSeances > 1 ? 's' : ''} (${texteHeures(heures)} heures)`;
  feuille.getCell(3, 1).font = { bold: true };
  feuille.getCell(3, 1).alignment = { horizontal: 'center' };

  const ligneEntete = feuille.getRow(4);
  ENTETES.forEach((texte, index) => {
    const cellule = ligneEntete.getCell(index + 1);
    cellule.value = texte;
    cellule.font = { bold: true };
    cellule.alignment = { horizontal: 'center', vertical: 'middle' };
    cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_ENTETE } };
    cellule.border = bordureTout;
  });

  lignes.forEach((ligne, index) => {
    const rangee = feuille.getRow(5 + index);
    const zebre = index % 2 === 1;

    const valeurs = [
      ligne.dateAbsence,
      ligne.semaine,
      ligne.jour,
      ligne.seance,
      ligne.formateurNom,
      ligne.groupe,
      ligne.module,
      ligne.observation,
      ligne.dateRattrapage ? 'Oui' : 'Non',
    ];

    valeurs.forEach((valeur, colonne) => {
      const cellule = rangee.getCell(colonne + 1);
      cellule.value = valeur;
      cellule.alignment = { horizontal: colonne === 7 ? 'left' : 'center', vertical: 'middle', wrapText: true };
      cellule.border = bordureTout;
      if (zebre) cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRE } };
    });
  });

  LARGEURS.forEach((largeur, index) => {
    feuille.getColumn(index + 1).width = largeur;
  });

  const tampon = Buffer.from(await classeur.xlsx.writeBuffer());

  return {
    tampon,
    nomFichier: nomFichierAbsences('xlsx'),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
