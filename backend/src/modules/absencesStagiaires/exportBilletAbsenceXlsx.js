import ExcelJS from 'exceljs';
import { dateCourte, nomFichierBillets } from './exportBilletAbsenceTexte.js';

/**
 * L'Excel des billets d'excuse — un TABLEAU, pas les quatre cases à découper
 * du Word/PDF : une case à cocher et une ligne « Visa GS » à signer n'ont pas
 * d'équivalent utile en tableur. Une ligne par billet, pour GARDER TRACE de
 * ce qui a été délivré plutôt que pour être imprimée et coupée.
 */

const GRIS_ENTETE = 'FFFAFAFA';
const ENTETES = ['Nom', 'Prénom', 'Filière', 'Groupe', 'Type', 'Date', 'Visa GS'];
const LARGEURS = [18, 18, 26, 12, 10, 12, 16];

const bordureFine = { style: 'thin', color: { argb: 'FFCCCCCC' } };
const bordureTout = { top: bordureFine, left: bordureFine, bottom: bordureFine, right: bordureFine };

export async function construireXlsxBilletsAbsence(donnees) {
  const { billets } = donnees;

  const classeur = new ExcelJS.Workbook();
  const feuille = classeur.addWorksheet('Billets d’excuse', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const ligneEntete = feuille.getRow(1);
  ENTETES.forEach((texte, index) => {
    const cellule = ligneEntete.getCell(index + 1);
    cellule.value = texte;
    cellule.font = { bold: true };
    cellule.alignment = { horizontal: 'center', vertical: 'middle' };
    cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_ENTETE } };
    cellule.border = bordureTout;
  });

  billets.forEach((billet, index) => {
    const rangee = feuille.getRow(2 + index);
    const valeurs = [
      billet.nom,
      billet.prenom,
      billet.filiere,
      billet.groupe,
      billet.type === 'retard' ? 'Retard' : 'Absence',
      dateCourte(billet.date),
      '',
    ];
    valeurs.forEach((valeur, colonne) => {
      const cellule = rangee.getCell(colonne + 1);
      cellule.value = valeur;
      cellule.alignment = { horizontal: colonne === 6 ? 'left' : 'center', vertical: 'middle' };
      cellule.border = bordureTout;
    });
  });

  LARGEURS.forEach((largeur, index) => {
    feuille.getColumn(index + 1).width = largeur;
  });

  const tampon = Buffer.from(await classeur.xlsx.writeBuffer());

  return {
    tampon,
    nomFichier: nomFichierBillets(billets, 'xlsx'),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
