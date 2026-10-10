import ExcelJS from 'exceljs';

/**
 * L'Excel du registre des absences de l'année — voir
 * `exportRegistreAbsences.service.js` pour ce que porte chaque case.
 *
 * Mise en page : titre, légende, puis deux lignes d'en-tête — le MOIS (cases
 * fusionnées) et le JOUR (« L 07 ») — au-dessus d'une ligne par stagiaire.
 * Les deux premières colonnes et l'en-tête restent figés : 300 colonnes de
 * jours se parcourent sans perdre de vue qui et quand.
 *
 * En fin de ligne : les heures (non justifiées, justifiées) sous « Assiduité »,
 * puis une colonne par sanction de comportement sous « Comportement ».
 */

const COULEURS = {
  entete: 'FFF2F2F2',
  vacances: 'FFDBEAFE', // bleu clair
  ferie: 'FFFDE68A', // ambre clair
  nonJustifiee: 'FFFECACA', // rouge clair
  justifiee: 'FFBBF7D0', // vert clair
  texteNonJustifiee: 'FFB91C1C',
  texteJustifiee: 'FF15803D',
  sanction: 'FFFED7AA', // orange clair
  texteSanction: 'FF9A3412',
};

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const INITIALES = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

const bordureFine = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const bordureTout = { top: bordureFine, left: bordureFine, bottom: bordureFine, right: bordureFine };
const fond = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

const LIGNE_MOIS = 5;
const LIGNE_JOURS = 6;
const PREMIERE_LIGNE = 7;
const PREMIER_JOUR = 3; // colonne C

export async function construireXlsxRegistreAbsences({ etablissement, anneeScolaire, jours, lignes, sanctions = [] }) {
  const classeur = new ExcelJS.Workbook();
  const feuille = classeur.addWorksheet('Registre', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: LIGNE_JOURS }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 0, fitToHeight: 0 },
  });

  const colTotalNj = PREMIER_JOUR + jours.length;
  const colTotalJ = colTotalNj + 1;
  const colSanction = (rang) => colTotalJ + 1 + rang;
  const derniereColonne = colTotalJ + sanctions.length;

  /* ── Titre et légende ─────────────────────────────────────────────── */
  feuille.getCell(1, 1).value = 'Registre des absences des stagiaires';
  feuille.getCell(1, 1).font = { bold: true, size: 14 };
  feuille.getCell(2, 1).value = [etablissement, `Année de formation ${anneeScolaire}-${anneeScolaire + 1}`]
    .filter(Boolean)
    .join('   —   ');
  feuille.getCell(2, 1).font = { bold: true };

  const legende = [
    ['Absence non justifiée (heures)', COULEURS.nonJustifiee],
    ['Absence justifiée — motif en commentaire', COULEURS.justifiee],
    ['Vacances', COULEURS.vacances],
    ['Jour férié', COULEURS.ferie],
    ['Sanction de comportement — date, motif en commentaire', COULEURS.sanction],
  ];
  // Une pastille, son libellé à droite — qui déborde sur les colonnes de jours, vides à cette hauteur.
  const positions = [1, PREMIER_JOUR + 1, PREMIER_JOUR + 12, PREMIER_JOUR + 23, PREMIER_JOUR + 30];
  legende.forEach(([libelle, couleur], rang) => {
    const pastille = feuille.getCell(3, positions[rang]);
    pastille.fill = fond(couleur);
    pastille.border = bordureTout;
    const texte = feuille.getCell(3, positions[rang] + 1);
    texte.value = libelle;
    texte.font = { size: 9 };
  });

  /* ── En-tête : groupe, stagiaire, mois, jours, totaux ─────────────── */
  for (const [colonne, libelle] of [
    [1, 'Groupe'],
    [2, 'Stagiaire'],
    [colTotalNj, 'Heures non justifiées'],
    [colTotalJ, 'Heures justifiées'],
    ...sanctions.map((sanction, rang) => [colSanction(rang), `${sanction.libelle} (${sanction.autorite})`]),
  ]) {
    // ⚠️ SUR LA LIGNE DES JOURS, SANS FUSION : c'est elle qui porte le filtre automatique.
    const cellule = feuille.getCell(LIGNE_JOURS, colonne);
    cellule.value = libelle;
    cellule.font = { bold: true };
    cellule.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cellule.fill = fond(COULEURS.entete);
    cellule.border = bordureTout;
  }

  // Au-dessus des colonnes de fin : ce qu'elles mesurent.
  for (const [de, a, libelle] of [
    [colTotalNj, colTotalJ, 'Assiduité'],
    ...(sanctions.length > 0 ? [[colSanction(0), derniereColonne, 'Comportement']] : []),
  ]) {
    feuille.mergeCells(LIGNE_MOIS, de, LIGNE_MOIS, a);
    const cellule = feuille.getCell(LIGNE_MOIS, de);
    cellule.value = libelle;
    cellule.font = { bold: true };
    cellule.alignment = { horizontal: 'center', vertical: 'middle' };
    cellule.fill = fond(COULEURS.entete);
    cellule.border = bordureTout;
  }

  // Le mois, fusionné sur ses jours.
  let debutMois = 0;
  jours.forEach(({ date }, index) => {
    const dernier = index === jours.length - 1 || jours[index + 1].date.slice(0, 7) !== date.slice(0, 7);
    if (!dernier) return;
    const [annee, mois] = date.split('-');
    const de = PREMIER_JOUR + debutMois;
    const a = PREMIER_JOUR + index;
    if (a > de) feuille.mergeCells(LIGNE_MOIS, de, LIGNE_MOIS, a);
    const cellule = feuille.getCell(LIGNE_MOIS, de);
    cellule.value = `${MOIS[Number(mois) - 1]} ${annee}`;
    cellule.font = { bold: true };
    cellule.alignment = { horizontal: 'center', vertical: 'middle' };
    cellule.fill = fond(COULEURS.entete);
    cellule.border = bordureTout;
    debutMois = index + 1;
  });

  // Le jour : initiale et numéro ; une fermeture le dit en couleur et en commentaire.
  jours.forEach(({ date, fermeture }, index) => {
    const colonne = PREMIER_JOUR + index;
    const cellule = feuille.getCell(LIGNE_JOURS, colonne);
    const jour = new Date(`${date}T12:00:00`);
    cellule.value = `${INITIALES[jour.getDay()]}\n${date.slice(8, 10)}`;
    cellule.font = { bold: true, size: 9 };
    cellule.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cellule.fill = fond(fermeture ? COULEURS[fermeture.type] : COULEURS.entete);
    cellule.border = bordureTout;
    if (fermeture) {
      cellule.note = `${fermeture.type === 'ferie' ? 'Jour férié' : 'Vacances'} : ${fermeture.libelle}`;
    }
    feuille.getColumn(colonne).width = 4.5;
  });
  feuille.getRow(LIGNE_JOURS).height = 28;

  feuille.getColumn(1).width = 16;
  feuille.getColumn(2).width = 30;
  feuille.getColumn(colTotalNj).width = 13;
  feuille.getColumn(colTotalJ).width = 13;
  sanctions.forEach((_, rang) => {
    feuille.getColumn(colSanction(rang)).width = 14;
  });
  // Les libellés de sanction sont longs (« Exclusion de 2 jours (CD) ») : la ligne d'en-tête s'élargit.
  if (sanctions.length > 0) feuille.getRow(LIGNE_JOURS).height = 42;

  /* ── Une ligne par stagiaire ──────────────────────────────────────── */
  lignes.forEach((ligne, rang) => {
    const rangee = feuille.getRow(PREMIERE_LIGNE + rang);
    rangee.getCell(1).value = ligne.groupe;
    rangee.getCell(2).value = ligne.nom;
    for (const colonne of [1, 2]) {
      rangee.getCell(colonne).border = bordureTout;
      rangee.getCell(colonne).alignment = { vertical: 'middle' };
    }

    ligne.cases.forEach((marque, index) => {
      const cellule = rangee.getCell(PREMIER_JOUR + index);
      const { fermeture } = jours[index];
      cellule.border = bordureTout;
      cellule.alignment = { horizontal: 'center', vertical: 'middle' };
      if (marque) {
        cellule.value = marque.heures;
        cellule.fill = fond(marque.justifiee ? COULEURS.justifiee : COULEURS.nonJustifiee);
        cellule.font = {
          bold: true,
          size: 9,
          color: { argb: marque.justifiee ? COULEURS.texteJustifiee : COULEURS.texteNonJustifiee },
        };
        if (marque.commentaire) cellule.note = marque.commentaire;
      } else if (fermeture) {
        cellule.fill = fond(COULEURS[fermeture.type]);
      }
    });

    for (const [colonne, valeur, couleur] of [
      [colTotalNj, ligne.nonJustifiees, COULEURS.texteNonJustifiee],
      [colTotalJ, ligne.justifiees, COULEURS.texteJustifiee],
    ]) {
      const cellule = rangee.getCell(colonne);
      cellule.value = valeur;
      cellule.font = { bold: true, color: { argb: valeur > 0 ? couleur : 'FF000000' } };
      cellule.alignment = { horizontal: 'center', vertical: 'middle' };
      cellule.border = bordureTout;
    }

    (ligne.comportement ?? []).forEach((marque, rang) => {
      const cellule = rangee.getCell(colSanction(rang));
      cellule.border = bordureTout;
      cellule.alignment = { horizontal: 'center', vertical: 'middle' };
      if (!marque) return;
      cellule.value = marque.date;
      cellule.fill = fond(COULEURS.sanction);
      cellule.font = { bold: true, size: 9, color: { argb: COULEURS.texteSanction } };
      if (marque.commentaire) cellule.note = marque.commentaire;
    });
  });

  // Le filtre automatique, pour isoler un groupe ou un stagiaire sans recopier la feuille.
  feuille.autoFilter = {
    from: { row: LIGNE_JOURS, column: 1 },
    to: { row: LIGNE_JOURS + lignes.length, column: derniereColonne },
  };

  return {
    tampon: Buffer.from(await classeur.xlsx.writeBuffer()),
    nomFichier: `Registre_absences_${anneeScolaire}-${anneeScolaire + 1}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
