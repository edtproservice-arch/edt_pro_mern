import ExcelJS from 'exceljs';
import { contenuLigne } from 'shared/domain';
import { JOURS } from 'shared/constants';
import { nomFichierExport, texteEntete } from './exportGlobalTexte.js';

/**
 * L'Excel de la « vue globale » — la même feuille que le Word, en tableur :
 * une ligne d'en-tête fusionnée, deux lignes de titres de colonnes (le jour,
 * puis l'heure du créneau), et trois lignes par sujet.
 */

const GRIS_ENTETE = 'FFEDEDED';
const VERT_DONNEES = 'FFE2F5E9';
// Les séances à distance (Teams) se distinguent en VIOLET, comme dans le
// canevas Word (2026-09-23, demande du porteur).
const VIOLET_DISTANCE = 'FFF0E4FA';

const bordureFine = { style: 'thin', color: { argb: 'FF999999' } };
const bordureTout = { top: bordureFine, left: bordureFine, bottom: bordureFine, right: bordureFine };

export async function construireXlsxGlobal(donnees) {
  const { entete, lignes, creneaux, jours, assemblees, libelleDuSujet, nomsFormateurs, horaireDuCreneau } = donnees;

  const classeur = new ExcelJS.Workbook();
  const feuille = classeur.addWorksheet('Emploi global', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 3 }],
  });

  const nbColonnesJours = JOURS.length * creneaux.length;
  const nbColonnes = 3 + nbColonnesJours;

  feuille.mergeCells(1, 1, 1, nbColonnes);
  const celluleTitre = feuille.getCell(1, 1);
  celluleTitre.value = texteEntete(donnees);
  celluleTitre.font = { bold: true, size: 11 };
  celluleTitre.alignment = { horizontal: 'center', vertical: 'middle' };
  feuille.getRow(1).height = 22;

  /* ── Ligne 2 : Émargement / Sujet / Type / les six jours fusionnés ── */
  const ligneJours = feuille.getRow(2);
  ligneJours.getCell(1).value = 'ÉMARGEMENT';
  ligneJours.getCell(2).value = entete.toUpperCase();
  ligneJours.getCell(3).value = 'TYPE';
  feuille.mergeCells(2, 1, 3, 1);
  feuille.mergeCells(2, 2, 3, 2);
  feuille.mergeCells(2, 3, 3, 3);

  JOURS.forEach((jour, index) => {
    const colonneDebut = 4 + index * creneaux.length;
    const colonneFin = colonneDebut + creneaux.length - 1;
    feuille.mergeCells(2, colonneDebut, 2, colonneFin);
    feuille.getCell(2, colonneDebut).value = jour.toUpperCase();
  });

  /* ── Ligne 3 : l'heure d'horloge de chaque créneau ── */
  const ligneCreneaux = feuille.getRow(3);
  JOURS.forEach((jour, indexJour) => {
    creneaux.forEach((creneau, indexCreneau) => {
      const colonne = 4 + indexJour * creneaux.length + indexCreneau;
      const { debut, fin } = horaireDuCreneau(jour, creneau);
      ligneCreneaux.getCell(colonne).value = `${debut.replace(':', 'h')}-${fin.replace(':', 'h')}`;
    });
  });

  for (let colonne = 1; colonne <= nbColonnes; colonne += 1) {
    for (let ligne = 2; ligne <= 3; ligne += 1) {
      const cellule = feuille.getCell(ligne, colonne);
      cellule.font = { bold: true, size: 9 };
      cellule.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_ENTETE } };
      cellule.border = bordureTout;
    }
  }

  /* ── Trois lignes par sujet ── */
  let ligneCourante = 4;
  for (const ligneSujet of assemblees) {
    const premiereLigne = ligneCourante;

    lignes.forEach((ligne, rang) => {
      const ligneExcel = feuille.getRow(ligneCourante + rang);
      ligneExcel.getCell(3).value = ligne.toUpperCase();
      ligneExcel.getCell(3).font = { size: 9 };
      ligneExcel.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
      ligneExcel.getCell(3).border = bordureTout;

      ligneSujet.cases.forEach((cellulePlanning, index) => {
        const colonne = 4 + index;
        const texte = contenuLigne(cellulePlanning.seances, ligne, nomsFormateurs);
        const aDistance = String(cellulePlanning.seances[0]?.salle ?? '').toUpperCase() === 'TEAMS';
        const cellule = ligneExcel.getCell(colonne);
        cellule.value = texte;
        cellule.font = { size: 9 };
        cellule.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cellule.border = bordureTout;
        if (texte) {
          cellule.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: aDistance ? VIOLET_DISTANCE : VERT_DONNEES },
          };
        }
      });
    });

    feuille.mergeCells(premiereLigne, 1, premiereLigne + lignes.length - 1, 1);
    feuille.mergeCells(premiereLigne, 2, premiereLigne + lignes.length - 1, 2);
    const celluleSujet = feuille.getCell(premiereLigne, 2);
    celluleSujet.value = `${libelleDuSujet(ligneSujet.sujet)}\n${ligneSujet.heures} h`;
    celluleSujet.font = { bold: true, size: 9 };
    celluleSujet.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    celluleSujet.border = bordureTout;
    feuille.getCell(premiereLigne, 1).border = bordureTout;

    ligneCourante += lignes.length;
  }

  feuille.getColumn(1).width = 6;
  feuille.getColumn(2).width = 20;
  feuille.getColumn(3).width = 6;
  for (let colonne = 4; colonne <= nbColonnes; colonne += 1) {
    feuille.getColumn(colonne).width = 10;
  }

  const tampon = Buffer.from(await classeur.xlsx.writeBuffer());

  return {
    tampon,
    nomFichier: nomFichierExport(donnees, 'xlsx'),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
