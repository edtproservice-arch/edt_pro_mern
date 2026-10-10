import ExcelJS from 'exceljs';
import { nomFichierPeriodes } from './exportPeriodesTexte.js';
import { BADGE_FERIE, BADGE_VACANCES, TEINTES_GANTT, TEINTE_VACANCES, TEXTE_VACANCES } from './exportPeriodesGantt.js';

/**
 * L'Excel des périodes de stage / de formation — la même page que le Word.
 *
 * ⚠️ LES DATES SONT DE VRAIES DATES, LES JOURS DES NOMBRES : le fichier se
 * retravaille (trier, filtrer, sommer). Le sujet est donc répété sur CHAQUE
 * ligne, contrairement au Word : une cellule fusionnée casse le tri et le
 * filtre automatique d'Excel.
 */

const GRIS_ENTETE = 'FFF2F2F2';
const bordureFine = { style: 'thin', color: { argb: 'FF000000' } };
const bordureTout = { top: bordureFine, left: bordureFine, bottom: bordureFine, right: bordureFine };

/** « AAAA-MM-JJ » → Date à minuit UTC : Excel n'y lit ni heure ni décalage. */
const enDate = (jour) => {
  const [annee, mois, date] = jour.split('-').map(Number);
  return new Date(Date.UTC(annee, mois - 1, date));
};

/**
 * La feuille « Calendrier » (mode calendrier, 2026-10-10) : le Gantt de la
 * frise, une colonne étroite par semaine sous son mois — seule feuille du
 * classeur dans ce mode.
 */
function feuilleGantt(classeur, { gantt, libelles, etablissement, anneeScolaire }) {
  const feuille = classeur.addWorksheet('Calendrier', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', xSplit: 1, ySplit: 6 }],
  });
  const derniere = gantt.semaines.length + 1;
  const plein = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

  feuille.mergeCells(1, 1, 1, derniere);
  feuille.getCell(1, 1).value = libelles.titre;
  feuille.getCell(1, 1).font = { bold: true, size: 14 };
  feuille.getCell(1, 1).alignment = { horizontal: 'center' };
  feuille.mergeCells(2, 1, 2, derniere);
  feuille.getCell(2, 1).value = [etablissement?.nom, Number.isInteger(anneeScolaire) ? `${anneeScolaire}-${anneeScolaire + 1}` : '']
    .filter(Boolean)
    .join(' — ');
  feuille.getCell(2, 1).alignment = { horizontal: 'center' };

  // Ligne 4 : les mois (fusionnés) ; ligne 5 : les numéros de semaine ; ligne 6 : le badge VAC.
  feuille.getCell(4, 1).value = libelles.colonneSujet;
  feuille.mergeCells(4, 1, 6, 1);
  let colonne = 2;
  for (const mois of gantt.mois) {
    if (mois.semaines > 1) feuille.mergeCells(4, colonne, 4, colonne + mois.semaines - 1);
    feuille.getCell(4, colonne).value = mois.libelle;
    colonne += mois.semaines;
  }
  gantt.semaines.forEach((semaine, rang) => {
    const cellule = feuille.getCell(5, rang + 2);
    cellule.value = semaine.numero ?? '';
    cellule.font = { size: 8 };
    if (gantt.semainesVacances[rang]) cellule.fill = plein(`FF${TEINTE_VACANCES}`);
  });
  gantt.semainesVacances.forEach((vacances, rang) => {
    const cellule = feuille.getCell(6, rang + 2);
    const nombreFeries = gantt.feriesParSemaine?.[rang] ?? 0;
    if (vacances) {
      cellule.value = 'VAC';
      cellule.fill = plein(`FF${BADGE_VACANCES}`);
      cellule.font = { bold: true, size: 6, color: { argb: `FF${TEXTE_VACANCES}` } };
    } else if (nombreFeries > 0) {
      cellule.value = `${nombreFeries}JF`;
      cellule.fill = plein(`FF${BADGE_FERIE}`);
      cellule.font = { bold: true, size: 6 };
    }
  });
  for (const numero of [4, 5, 6]) {
    for (let c = 1; c <= derniere; c += 1) {
      const cellule = feuille.getCell(numero, c);
      cellule.font = { ...cellule.font, bold: numero !== 5 || c === 1 };
      cellule.alignment = { horizontal: 'center', vertical: 'middle' };
      cellule.border = bordureTout;
      if (!cellule.fill) cellule.fill = plein(GRIS_ENTETE);
    }
  }

  gantt.lignes.forEach((ligne, rangLigne) => {
    const numero = 7 + rangLigne;
    const sujet = feuille.getCell(numero, 1);
    sujet.value = ligne.sujet;
    sujet.font = { bold: true };
    sujet.border = bordureTout;
    ligne.cases.forEach((rang, semaine) => {
      const cellule = feuille.getCell(numero, semaine + 2);
      // Bordures noires (2026-10-10, demande du porteur), comme le Word.
      cellule.border = bordureTout;
      if (rang !== null) cellule.fill = plein(`FF${TEINTES_GANTT[rang % TEINTES_GANTT.length]}`);
      else if (gantt.semainesVacances[semaine]) cellule.fill = plein(`FF${TEINTE_VACANCES}`);
    });
  });

  // Légende sous la grille.
  const legende = 7 + gantt.lignes.length + 1;
  [...TEINTES_GANTT.map((teinte, rang) => [teinte, `${rang + 1}${rang === 0 ? 're' : 'e'} période`]), [TEINTE_VACANCES, 'Vacances'], [BADGE_FERIE, 'Jour férié (JF)']].forEach(
    ([teinte, texte], rang) => {
      const c = 2 + rang * 5;
      feuille.getCell(legende, c).fill = plein(`FF${teinte}`);
      feuille.getCell(legende, c + 1).value = texte;
    }
  );

  feuille.getColumn(1).width = 22;
  for (let c = 2; c <= derniere; c += 1) feuille.getColumn(c).width = 3.2;
}

export async function construireXlsxPeriodes(donnees) {
  const { type, libelles, etablissement, anneeScolaire, sujets } = donnees;

  const classeur = new ExcelJS.Workbook();
  // En mode calendrier, la feuille Gantt SEULE — comme le Word et le PDF.
  if (donnees.gantt) {
    feuilleGantt(classeur, donnees);
    return {
      tampon: Buffer.from(await classeur.xlsx.writeBuffer()),
      nomFichier: nomFichierPeriodes(type, anneeScolaire, 'xlsx'),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
  const feuille = classeur.addWorksheet(type === 'stages' ? 'Stages' : 'Formations', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 5 }],
  });

  const titre = (numero, texte, police) => {
    feuille.mergeCells(numero, 1, numero, 5);
    const cellule = feuille.getCell(numero, 1);
    cellule.value = texte;
    cellule.font = police;
    cellule.alignment = { horizontal: 'center', vertical: 'middle' };
  };
  titre(1, libelles.titre, { bold: true, size: 14 });
  titre(2, etablissement?.nom ?? '', { bold: true });
  if (Number.isInteger(anneeScolaire)) {
    titre(3, `Année de Formation : ${anneeScolaire}-${anneeScolaire + 1}`, {});
  }

  const entete = feuille.getRow(5);
  [libelles.colonneSujet, libelles.colonneDetail, 'Du', 'Au', 'Jours'].forEach((texte, index) => {
    const cellule = entete.getCell(index + 1);
    cellule.value = texte;
    cellule.font = { bold: true };
    cellule.alignment = { horizontal: 'center', vertical: 'middle' };
    cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_ENTETE } };
    cellule.border = bordureTout;
  });

  let numero = 6;
  for (const sujet of sujets) {
    for (const periode of sujet.periodes) {
      const rangee = feuille.getRow(numero);
      rangee.values = [sujet.sujet, sujet.detail, enDate(periode.debut), enDate(periode.fin), periode.jours];
      rangee.getCell(3).numFmt = 'dd/mm/yyyy';
      rangee.getCell(4).numFmt = 'dd/mm/yyyy';
      for (let colonne = 1; colonne <= 5; colonne += 1) {
        const cellule = rangee.getCell(colonne);
        cellule.border = bordureTout;
        cellule.alignment = { horizontal: colonne === 1 ? 'left' : 'center', vertical: 'middle' };
      }
      numero += 1;
    }
  }

  if (numero > 6) feuille.autoFilter = { from: { row: 5, column: 1 }, to: { row: numero - 1, column: 5 } };

  // Le total en FORMULE : il suit les retouches faites dans le fichier.
  const total = feuille.getRow(numero);
  total.getCell(1).value = `Total : ${sujets.length} ${libelles.sujets}`;
  total.getCell(3).value = `${donnees.totalPeriodes} période(s)`;
  total.getCell(5).value = { formula: `SUM(E6:E${numero - 1})`, result: donnees.totalJours };
  for (let colonne = 1; colonne <= 5; colonne += 1) {
    const cellule = total.getCell(colonne);
    cellule.font = { bold: true };
    cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_ENTETE } };
    cellule.border = bordureTout;
    cellule.alignment = { horizontal: colonne === 1 ? 'left' : 'center' };
  }

  [26, 16, 14, 14, 10].forEach((largeur, index) => {
    feuille.getColumn(index + 1).width = largeur;
  });

  return {
    tampon: Buffer.from(await classeur.xlsx.writeBuffer()),
    nomFichier: nomFichierPeriodes(type, anneeScolaire, 'xlsx'),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
