import ExcelJS from 'exceljs';
import { JOURS } from 'shared/constants';
import { datesJoursOuvres, libelleSemainePeriode, nomFichierFeuilleAbsence } from './exportFeuilleAbsenceTexte.js';

/**
 * L'Excel de la feuille d'absence hebdomadaire — la même grille que le Word :
 * un encart (Filière / Année / Groupe / Semaine), puis N°, Nom & Prénom, T. A,
 * et 6 jours × 4 créneaux, une ligne par étudiant du groupe.
 *
 * ⚠️ UN ONGLET PAR GROUPE (2026-09-29, demande du porteur : le bouton
 * télécharge tous les groupes que le filtre de « Faire l'appel » laisse
 * visibles) — voir `exportFeuilleAbsenceDocx.js` pour la même idée en pages.
 */

const GRIS_ENTETE = 'FFFAFAFA';
const COULEURS_MARQUE = { absence: 'FFB91C1C', retard: 'FFC2650C' };
const NB_COLONNES = 3 + 6 * 4;

/**
 * ⚠️ DEUX SEMAINES D'ABSENCE DE SUITE (2026-09-29, demande du porteur) — même
 * règle et mêmes couleurs que `exportFeuilleAbsenceDocx.js` (`ligne.rouge`).
 */
const FOND_LIGNE_ROUGE = 'FFFEE2E2';
const TEXTE_LIGNE_ROUGE = COULEURS_MARQUE.absence;

const bordureFine = { style: 'thin', color: { argb: 'FF000000' } };
const bordureTout = { top: bordureFine, left: bordureFine, bottom: bordureFine, right: bordureFine };

const JOURS_ABBREGES = { Lundi: 'LUN', Mardi: 'MAR', Mercredi: 'MERC', Jeudi: 'JEU', Vendredi: 'VEN', Samedi: 'SAM' };

function ligneCentree(feuille, numero, texte, { gras = true } = {}) {
  feuille.mergeCells(numero, 1, numero, NB_COLONNES);
  const cellule = feuille.getCell(numero, 1);
  cellule.value = texte;
  cellule.font = { bold: gras };
  cellule.alignment = { horizontal: 'center' };
  return cellule;
}

/** Un nom d'onglet Excel valide : 31 caractères maximum, sans `* ? : \ / [ ]`. */
function nomOnglet(groupe) {
  return groupe.replace(/[*?:\\/[\]]/g, '-').slice(0, 31);
}

function remplirFeuille(feuille, { etablissement, groupe, filiere, anneeLabel, anneeScolaire, semaine, lignes, formateurs }) {
  feuille.getCell(1, 1).value = 'Feuille d’Absence Hebdomadaire';
  feuille.mergeCells(1, 1, 1, NB_COLONNES);
  feuille.getCell(1, 1).font = { bold: true, size: 14 };
  feuille.getCell(1, 1).alignment = { horizontal: 'center' };

  ligneCentree(feuille, 2, etablissement?.nom ?? '');
  ligneCentree(feuille, 3, `Filière : ${filiere} (${anneeLabel})    —    Année de Formation : ${anneeScolaire}-${anneeScolaire + 1}`);
  ligneCentree(feuille, 4, `Groupe : ${groupe}    —    Semaine ${libelleSemainePeriode(semaine)}`);

  ['N°', 'Nom & Prénom', 'T. A'].forEach((texte, index) => {
    feuille.mergeCells(5, index + 1, 6, index + 1);
    const cellule = feuille.getCell(5, index + 1);
    cellule.value = texte;
    cellule.font = { bold: true };
    cellule.alignment = { horizontal: 'center', vertical: 'middle' };
    cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_ENTETE } };
    cellule.border = bordureTout;
  });

  const dates = datesJoursOuvres(semaine);
  JOURS.slice(0, 6).forEach((jour, jourIndex) => {
    const colonneDebut = 4 + jourIndex * 4;
    feuille.mergeCells(5, colonneDebut, 5, colonneDebut + 3);
    const enteteJour = feuille.getCell(5, colonneDebut);
    enteteJour.value = `${JOURS_ABBREGES[jour]} ${dates[jourIndex]}`;
    enteteJour.font = { bold: true };
    enteteJour.alignment = { horizontal: 'center' };
    enteteJour.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_ENTETE } };

    ['S1', 'S2', 'S3', 'S4'].forEach((seance, seanceIndex) => {
      const cellule = feuille.getCell(6, colonneDebut + seanceIndex);
      cellule.value = seance;
      cellule.font = { bold: true };
      cellule.alignment = { horizontal: 'center' };
      cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_ENTETE } };
      cellule.border = bordureTout;
    });
  });

  lignes.forEach((ligne, index) => {
    const rangee = feuille.getRow(7 + index);
    rangee.getCell(1).value = ligne.numero;
    rangee.getCell(2).value = ligne.nom;
    rangee.getCell(3).value = ligne.totalSemaine;

    ligne.marques.forEach((marque, colonne) => {
      const cellule = rangee.getCell(4 + colonne);
      if (marque) {
        cellule.value = marque === 'retard' ? 'R' : 'A';
        cellule.font = { bold: true, color: { argb: COULEURS_MARQUE[marque] ?? COULEURS_MARQUE.absence } };
      }
    });

    for (let colonne = 1; colonne <= NB_COLONNES; colonne += 1) {
      const cellule = rangee.getCell(colonne);
      cellule.alignment = { horizontal: colonne === 2 ? 'left' : 'center', vertical: 'middle' };
      cellule.border = bordureTout;
      if (ligne.rouge) {
        cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FOND_LIGNE_ROUGE } };
        cellule.font = { ...cellule.font, color: { argb: TEXTE_LIGNE_ROUGE } };
      }
    }
  });

  const derniereLigne = 7 + lignes.length;
  [
    ['Formateurs', derniereLigne],
    ['Emargements', derniereLigne + 1],
    ['Assistants', derniereLigne + 2],
  ].forEach(([texte, numero]) => {
    feuille.mergeCells(numero, 1, numero, 3);
    const cellule = feuille.getCell(numero, 1);
    cellule.value = texte;
    cellule.font = { bold: true };
    cellule.alignment = { horizontal: 'center', vertical: 'middle' };
    for (let colonne = 1; colonne <= NB_COLONNES; colonne += 1) {
      feuille.getCell(numero, colonne).border = bordureTout;
    }
  });

  /*
   * ⚠️ LE NOM À LA VERTICALE (2026-09-29, demande du porteur) — même case
   * étroite que les créneaux des étudiants, `textRotation: 90` la lit de bas
   * en haut, comme `<w:textDirection w:val="btLr"/>` côté Word.
   */
  const ligneFormateurs = feuille.getRow(derniereLigne);
  // ⚠️ MÊME PROPORTION QUE LE WORD (2026-09-29, demande du porteur : « les
  // noms est trop petit, agrandi un peu plus », puis « diminue plus le
  // height de la ligne formateur ») — voir `exportFeuilleAbsenceDocx.js`.
  ligneFormateurs.height = 90;
  (formateurs ?? []).forEach((nom, colonne) => {
    const cellule = ligneFormateurs.getCell(4 + colonne);
    if (!nom) return;
    cellule.value = nom;
    cellule.alignment = { horizontal: 'center', vertical: 'middle', textRotation: 90 };
    cellule.font = { size: 11 };
  });

  feuille.getCell(derniereLigne + 4, 1).value = 'Surveillant Général :';
  feuille.getCell(derniereLigne + 4, 1).font = { bold: true };

  feuille.getColumn(1).width = 6;
  feuille.getColumn(2).width = 26;
  feuille.getColumn(3).width = 8;
  for (let colonne = 4; colonne <= NB_COLONNES; colonne += 1) {
    feuille.getColumn(colonne).width = 6;
  }
}

export async function construireXlsxFeuilleAbsence(donnees) {
  const { etablissement, anneeScolaire, semaine, feuilles } = donnees;

  const classeur = new ExcelJS.Workbook();
  const nomsPris = new Set();

  feuilles.forEach((feuilleDonnees) => {
    let nom = nomOnglet(feuilleDonnees.groupe);
    // ⚠️ Deux groupes distincts peuvent tronquer sur le même nom à 31
    // caractères — un onglet en double ferait échouer `addWorksheet`.
    let suffixe = 2;
    while (nomsPris.has(nom)) {
      nom = `${nomOnglet(feuilleDonnees.groupe).slice(0, 28)} (${suffixe})`;
      suffixe += 1;
    }
    nomsPris.add(nom);

    const feuille = classeur.addWorksheet(nom, {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      views: [{ state: 'frozen', ySplit: 6 }],
    });
    remplirFeuille(feuille, { etablissement, anneeScolaire, semaine, ...feuilleDonnees });
  });

  const tampon = Buffer.from(await classeur.xlsx.writeBuffer());

  return {
    tampon,
    nomFichier: nomFichierFeuilleAbsence(feuilles.map((f) => f.groupe), semaine, 'xlsx'),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
