import ExcelJS from 'exceljs';
import { colonnesNotes } from './exportNotesDisciplineTexte.js';

/**
 * L'Excel des notes de discipline : UN ONGLET PAR GROUPE (comme la feuille
 * d'absence hebdomadaire), les mêmes colonnes que le Word — les nombres restent
 * des NOMBRES, pour trier, filtrer ou faire une moyenne sans les retaper.
 */
const GRIS_ENTETE = 'FFF2F2F2';
const ROUGE_SANCTION = 'FFB91C1C';
const bordureFine = { style: 'thin', color: { argb: 'FF000000' } };
const bordureTout = { top: bordureFine, left: bordureFine, bottom: bordureFine, right: bordureFine };
const LIGNE_ENTETE = 6;

export async function construireXlsxNotesDiscipline({ etablissement, anneeScolaire, feuilles }) {
  const classeur = new ExcelJS.Workbook();
  const nomsPris = new Set();

  for (const { groupe, examen, stagiaires } of feuilles) {
    const passage = examen?.type !== 'fin';
    const colonnes = colonnesNotes(passage);
    const feuille = classeur.addWorksheet(nomOnglet(groupe, nomsPris), {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      views: [{ state: 'frozen', ySplit: LIGNE_ENTETE }],
    });

    const ligneFusionnee = (numero, texte, police = {}) => {
      feuille.mergeCells(numero, 1, numero, colonnes.length);
      const cellule = feuille.getCell(numero, 1);
      cellule.value = texte;
      cellule.font = police;
      cellule.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    };
    // Le canevas du Word (2026-10-11) : titre, établissement, année, groupe — sans ligne de résumé.
    ligneFusionnee(1, 'Notes de discipline', { bold: true, size: 14 });
    ligneFusionnee(2, etablissement?.nom ?? '', { bold: true, size: 9 });
    ligneFusionnee(3, `Année de Formation : ${anneeScolaire}-${anneeScolaire + 1}`);
    ligneFusionnee(4, `Groupe ${groupe}`, { bold: true, size: 12 });

    const entete = feuille.getRow(LIGNE_ENTETE);
    colonnes.forEach((colonne, rang) => {
      const cellule = entete.getCell(rang + 1);
      cellule.value = colonne.entete;
      cellule.font = { bold: true };
      cellule.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_ENTETE } };
      cellule.border = bordureTout;
      feuille.getColumn(rang + 1).width = Math.max(6, Math.round(colonne.poids * 1.6));
    });
    entete.height = 32;

    stagiaires.forEach((stagiaire, index) => {
      const rangee = feuille.getRow(LIGNE_ENTETE + 1 + index);
      colonnes.forEach((colonne, rang) => {
        const cellule = rangee.getCell(rang + 1);
        const valeur = colonne.valeur(stagiaire, index);
        cellule.value = valeur ?? '';
        cellule.border = bordureTout;
        cellule.alignment = { horizontal: colonne.gauche ? 'left' : 'center', vertical: 'middle', wrapText: colonne.gauche };
        if (colonne.note) cellule.font = { bold: true };
        // Une sanction prononcée se voit d'un coup d'œil.
        if (colonne.id.startsWith('sanction') && valeur !== '—') cellule.font = { color: { argb: ROUGE_SANCTION } };
      });
    });

    feuille.autoFilter = {
      from: { row: LIGNE_ENTETE, column: 1 },
      to: { row: LIGNE_ENTETE + stagiaires.length, column: colonnes.length },
    };

    // La signature, comme sur le Word.
    feuille.getCell(LIGNE_ENTETE + stagiaires.length + 2, 1).value = 'Gestionnaire de stagiaire :';
  }

  return Buffer.from(await classeur.xlsx.writeBuffer());
}

/** Un nom d'onglet valide et unique : 31 caractères au plus, sans `* ? : \ / [ ]`. */
function nomOnglet(groupe, pris) {
  const base = String(groupe).replace(/[*?:\\/[\]]/g, '-').slice(0, 31) || 'Groupe';
  let nom = base;
  for (let n = 2; pris.has(nom.toLowerCase()); n += 1) nom = `${base.slice(0, 27)} (${n})`;
  pris.add(nom.toLowerCase());
  return nom;
}
