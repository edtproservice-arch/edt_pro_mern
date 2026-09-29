import ExcelJS from 'exceljs';
import { dateFr, nomFichierEmargement } from './exportEmargementTexte.js';

/**
 * L'Excel de l'émargement journalier — la même liste que le Word : une ligne
 * d'en-tête, puis une ligne par bloc de cours d'un formateur ce jour-là, la
 * colonne Taux colorée du même rouge/orange/vert que la page Avancement.
 */

const GRIS_ENTETE = 'FFFAFAFA';
const ZEBRE = 'FFF7F7F8';

const COULEURS_TAUX = {
  bas: { fond: 'FFFDE2E2', texte: 'FFB91C1C' },
  moyen: { fond: 'FFFEF3C7', texte: 'FF92620A' },
  haut: { fond: 'FFD1FAE5', texte: 'FF047857' },
};

const bordureFine = { style: 'thin', color: { argb: 'FFCCCCCC' } };
const bordureTout = { top: bordureFine, left: bordureFine, bottom: bordureFine, right: bordureFine };

const ENTETES = ['Formateur', 'Groupe', 'Module', 'Espace', 'Horaire', 'Taux', 'Absence', 'Émargement'];
// ⚠️ MODULE ÉLARGIE (2026-09-25, demande du porteur) : elle porte désormais
// « CODE - Nom complet », plus large qu'un simple code.
const LARGEURS = [22, 16, 40, 14, 16, 14, 12, 14];

export async function construireXlsxEmargement(donnees) {
  const { etablissement, anneeScolaire, jour, date, semaineLabel, lignes } = donnees;

  const classeur = new ExcelJS.Workbook();
  const feuille = classeur.addWorksheet('Émargement', {
    // ⚠️ PAYSAGE (2026-09-25, demande du porteur) — même raison que le Word :
    // le nom complet du module a besoin de largeur, pas de hauteur.
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 4 }],
  });

  feuille.mergeCells(1, 1, 1, ENTETES.length);
  feuille.getCell(1, 1).value = `Emploi du temps journalier - ${jour.toUpperCase()} — ${etablissement?.nom ?? ''}`;
  feuille.getCell(1, 1).font = { bold: true, size: 12 };
  feuille.getCell(1, 1).alignment = { horizontal: 'center' };

  feuille.mergeCells(2, 1, 2, ENTETES.length);
  feuille.getCell(2, 1).value = `Au titre de l'année ${anneeScolaire}-${anneeScolaire + 1}`;
  feuille.getCell(2, 1).alignment = { horizontal: 'center' };

  feuille.mergeCells(3, 1, 3, ENTETES.length);
  feuille.getCell(3, 1).value = `Date : ${dateFr(date)} (Semaine ${semaineLabel})`;
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
      ligne.formateur,
      ligne.groupe,
      ligne.moduleAffiche ?? ligne.module,
      ligne.salle,
      `${ligne.debut.replace(':', 'h')} - ${ligne.fin.replace(':', 'h')}`,
      ligne.taux === null ? '' : `${ligne.taux}% (${ligne.pose}h / ${ligne.prevu}h)`,
      '',
      '',
    ];

    valeurs.forEach((valeur, colonne) => {
      const cellule = rangee.getCell(colonne + 1);
      cellule.value = valeur;
      cellule.alignment = { horizontal: colonne === 0 ? 'left' : 'center', vertical: 'middle', wrapText: true };
      cellule.border = bordureTout;
      if (zebre) cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRE } };
    });

    // ⚠️ LE TAUX NE SUIT PAS LE ZÈBRE — sa couleur dit le niveau d'avancement,
    // toujours prioritaire sur l'alternance des lignes.
    if (ligne.niveau) {
      const couleurs = COULEURS_TAUX[ligne.niveau] ?? COULEURS_TAUX.bas;
      const celluleTaux = rangee.getCell(6);
      celluleTaux.font = { bold: true, color: { argb: couleurs.texte } };
      celluleTaux.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: couleurs.fond } };
    }
  });

  LARGEURS.forEach((largeur, index) => {
    feuille.getColumn(index + 1).width = largeur;
  });

  const tampon = Buffer.from(await classeur.xlsx.writeBuffer());

  return {
    tampon,
    nomFichier: nomFichierEmargement(donnees, 'xlsx'),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
