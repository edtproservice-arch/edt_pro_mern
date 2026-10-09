import ExcelJS from 'exceljs';
import { largeurExcel, libelleSituation, nomFichierAchevement } from './exportAchevementTexte.js';

/**
 * L'Excel du détail « Achèvement des modules » : titre, établissement, résumé,
 * puis le tableau de la fenêtre — en-tête figé et filtre automatique, pour
 * retravailler la liste sans la recopier.
 */
/** Les semaines et les dates, courtes, se lisent mieux centrées. */
const CENTREES = new Set(['semestre', 'regional', 'semaineDebut', 'dateDebut', 'semaineFin', 'dateFin']);
const GRIS_ENTETE = 'FFF2F2F2';
const bordureFine = { style: 'thin', color: { argb: 'FF000000' } };
const bordureTout = { top: bordureFine, left: bordureFine, bottom: bordureFine, right: bordureFine };

export async function construireXlsxAchevement(donnees) {
  const { etablissement, anneeScolaire, resume, dateObservee, colonnes, lignes } = donnees;
  const nb = colonnes.length;

  const classeur = new ExcelJS.Workbook();
  const feuille = classeur.addWorksheet('Achèvement', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 5 }],
  });

  const ligneCentree = (numero, texte, police) => {
    feuille.mergeCells(numero, 1, numero, nb);
    const cellule = feuille.getCell(numero, 1);
    cellule.value = texte;
    cellule.font = police;
    cellule.alignment = { horizontal: 'center' };
  };

  ligneCentree(1, 'Achèvement des modules', { bold: true, size: 14 });
  ligneCentree(2, etablissement?.nom ?? '', { bold: true });
  ligneCentree(
    3,
    [
      `Année de Formation : ${anneeScolaire}-${anneeScolaire + 1}`,
      libelleSituation(dateObservee),
      resume,
    ]
      .filter(Boolean)
      .join('   —   '),
    {}
  );

  const entete = feuille.getRow(5);
  colonnes.forEach((colonne, rang) => {
    const cellule = entete.getCell(rang + 1);
    cellule.value = colonne.entete;
    cellule.font = { bold: true };
    cellule.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_ENTETE } };
    cellule.border = bordureTout;
    feuille.getColumn(rang + 1).width = largeurExcel(colonne.id);
  });

  lignes.forEach((ligne, index) => {
    const rangee = feuille.getRow(6 + index);
    colonnes.forEach((colonne, rang) => {
      const cellule = rangee.getCell(rang + 1);
      cellule.value = ligne[rang] ?? '';
      cellule.border = bordureTout;
      cellule.alignment = {
        vertical: 'middle',
        horizontal: CENTREES.has(colonne.id) ? 'center' : undefined,
        wrapText: colonne.id === 'intitule' || colonne.id === 'formateur',
      };
    });
  });

  feuille.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + lignes.length, column: nb } };

  return {
    tampon: Buffer.from(await classeur.xlsx.writeBuffer()),
    nomFichier: nomFichierAchevement('xlsx'),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
