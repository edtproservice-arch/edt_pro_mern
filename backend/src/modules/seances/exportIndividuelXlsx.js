import ExcelJS from 'exceljs';
import { contenuLigne } from 'shared/domain';
import { JOURS } from 'shared/constants';
import { dateFr } from './exportGlobalTexte.js';
import { nomFichierIndividuel } from './exportIndividuelTexte.js';

/**
 * L'Excel de la vue détaillée — UN ONGLET PAR SUJET (2026-09-24, demande du
 * porteur : le même bouton Imprimer télécharge « le détaillé selon le
 * filtre », donc tous les sujets actuellement affichés). Chaque onglet reprend
 * la grille Jour × (lignes de l'axe) × créneaux, avec la même coloration
 * verte/violette (présentiel/Teams) que « l'emploi global ».
 */

const GRIS_ENTETE = 'FFFAFAFA';
const VERT_DONNEES = 'FFE2F5E9';
const VIOLET_DISTANCE = 'FFF0E4FA';

const bordureFine = { style: 'thin', color: { argb: 'FF999999' } };
const bordureTout = { top: bordureFine, left: bordureFine, bottom: bordureFine, right: bordureFine };

/** Le nom d'un onglet Excel : 31 caractères au plus, aucun des sept signes interdits. */
function nomFeuille(libelle, dejaPris) {
  const propre = String(libelle ?? '').replace(/[[\]*/\\?:]/g, ' ').trim().slice(0, 31) || 'Sujet';
  if (!dejaPris.has(propre)) {
    dejaPris.add(propre);
    return propre;
  }
  let compteur = 2;
  let candidat;
  do {
    const suffixe = ` (${compteur})`;
    candidat = `${propre.slice(0, 31 - suffixe.length)}${suffixe}`;
    compteur += 1;
  } while (dejaPris.has(candidat));
  dejaPris.add(candidat);
  return candidat;
}

function remplirFeuille(feuille, { entete, lignes, creneaux, page, nomsFormateurs, horaireDuCreneau, anneeScolaire, semaineDebut }) {
  const nbColonnes = 2 + creneaux.length;
  const milieu = Math.ceil(nbColonnes / 2);

  feuille.mergeCells(1, 1, 1, nbColonnes);
  feuille.getCell(1, 1).value = 'Emploi du Temps Détaillé';
  feuille.getCell(1, 1).font = { bold: true, size: 13 };
  feuille.getCell(1, 1).alignment = { horizontal: 'center' };

  feuille.mergeCells(2, 1, 2, nbColonnes);
  feuille.getCell(2, 1).value = `Au titre de l'année ${anneeScolaire}-${anneeScolaire + 1}`;
  feuille.getCell(2, 1).font = { bold: true };
  feuille.getCell(2, 1).alignment = { horizontal: 'center' };

  feuille.mergeCells(3, 1, 3, milieu);
  feuille.getCell(3, 1).value = `Masse Horaire : ${page.heures.toFixed(2)} H`;
  feuille.getCell(3, 1).alignment = { horizontal: 'left' };

  feuille.mergeCells(3, milieu + 1, 3, nbColonnes);
  const celluleSujet = feuille.getCell(3, milieu + 1);
  celluleSujet.value = `${entete} : ${page.libelle}   À partir du : ${dateFr(semaineDebut)}`;
  celluleSujet.font = { bold: true };
  celluleSujet.alignment = { horizontal: 'right' };

  // ⚠️ UNE SEULE LIGNE D'EN-TÊTE POUR LES 6 JOURS — voir `exportIndividuelDocx.js`.
  const ligneEntete = feuille.getRow(4);
  ligneEntete.getCell(1).value = 'Jour';
  creneaux.forEach((creneau, index) => {
    const { debut, fin } = horaireDuCreneau('Lundi', creneau);
    ligneEntete.getCell(3 + index).value = `${debut.replace(':', 'h')}-${fin.replace(':', 'h')}`;
  });
  for (let colonne = 1; colonne <= nbColonnes; colonne += 1) {
    const cellule = ligneEntete.getCell(colonne);
    cellule.font = { bold: true, size: 9 };
    cellule.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_ENTETE } };
    cellule.border = bordureTout;
  }

  let ligneCourante = 5;
  for (const jour of JOURS) {
    const casesJour = page.cases.filter((c) => c.jour === jour);
    const premiereLigne = ligneCourante;

    lignes.forEach((ligneNom, rang) => {
      const ligneExcel = feuille.getRow(ligneCourante + rang);
      ligneExcel.getCell(2).value = ligneNom;
      ligneExcel.getCell(2).font = { size: 9 };
      ligneExcel.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      ligneExcel.getCell(2).border = bordureTout;

      casesJour.forEach((caseCreneau, index) => {
        const colonne = 3 + index;
        const texte = contenuLigne(caseCreneau.seances, ligneNom, nomsFormateurs);
        const aDistance = String(caseCreneau.seances[0]?.salle ?? '').toUpperCase() === 'TEAMS';
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
    const celluleJour = feuille.getCell(premiereLigne, 1);
    celluleJour.value = jour;
    celluleJour.font = { bold: true, size: 9 };
    celluleJour.alignment = { horizontal: 'center', vertical: 'middle' };
    celluleJour.border = bordureTout;

    ligneCourante += lignes.length;
  }

  feuille.getColumn(1).width = 10;
  feuille.getColumn(2).width = 10;
  for (let colonne = 3; colonne <= nbColonnes; colonne += 1) {
    feuille.getColumn(colonne).width = 16;
  }
}

export async function construireXlsxIndividuel(donnees) {
  const { anneeScolaire, semaineDebut, entete, lignes, creneaux, pages, nomsFormateurs, horaireDuCreneau } = donnees;

  const classeur = new ExcelJS.Workbook();
  const nomsPris = new Set();

  for (const page of pages) {
    const feuille = classeur.addWorksheet(nomFeuille(page.libelle, nomsPris), {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      views: [{ state: 'frozen', ySplit: 4 }],
    });
    remplirFeuille(feuille, { entete, lignes, creneaux, page, nomsFormateurs, horaireDuCreneau, anneeScolaire, semaineDebut });
  }

  const tampon = Buffer.from(await classeur.xlsx.writeBuffer());

  return {
    tampon,
    nomFichier: nomFichierIndividuel(donnees, 'xlsx'),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
