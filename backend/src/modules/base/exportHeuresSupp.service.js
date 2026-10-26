import JSZip from 'jszip';
import { Etablissement } from '../../models/Etablissement.js';
import { nouveauClasseur } from './bilan.service.js';
import { heuresSupplementaires } from './heuresSupp.service.js';

/**
 * ÉTAT MENSUEL des heures supplémentaires — le format des états de l'administration (2026-10-17).
 * Les chiffres sont ceux du modal : même service, même règle (`calculerHeuresSupp`).
 *
 * D'abord la « Synthèse annuelle » (voir `ajouterSyntheseAnnuelle`), puis une feuille par mois,
 * une ligne par formateur :
 *   Mle | Nom et Prénom | MHS | (TH.R, TH.SUP) par semaine | Total réalisé | Cumul | Plafond |
 *   Quota HS | Reste du quota
 *
 * TH.R = heures réalisées ; TH.SUP = heures réalisées au-delà du seuil (sans plafond depuis le 2026-10-26) ;
 * Cumul = total réalisé − masse horaire du mois (26 h par semaine commencée, − 4,334 h par jour
 * férié — règle du porteur du 2026-10-20 ; négatif en rouge) ; Plafond = ce qui est payé (30 h par mois au plus, et dans la
 * limite du quota) ; Quota HS = le quota de l'année ; Reste du quota = ce qu'il reste à payer sur
 * l'année À LA FIN DE CE MOIS. Les semaines sont celles dont le JEUDI tombe dans le mois — la
 * règle du calcul.
 *
 * MHS = masse hebdomadaire statutaire : 26 h (910 h par an) ou 36 h (1260 h). « Vac. » pour un
 * vacataire, qui n'a pas d'heures supplémentaires.
 */

const MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
const dateFr = (jour) => `${jour.slice(8, 10)}/${jour.slice(5, 7)}/${jour.slice(0, 4)}`;

/** « Heures réalisées au 17/10/2026 à 14:30 » : les séances planifiées après ne comptent pas. */
const mentionRealise = (instant) =>
  `Heures réalisées au ${dateFr(instant.date)} à ${instant.heure} — séances terminées seulement`;

/* ─── Charte ──────────────────────────────────────────────────────────────── */

const COULEURS = {
  marine: 'FF1F3864',
  semaine: 'FFD9E1F2', // en-tête d'une semaine ordinaire
  semaineFermee: 'FFFCE4D6', // en-tête d'une semaine avec un jour férié ou de vacances
  sousEntete: 'FFEDF2F9',
  zebre: 'FFF7F9FC',
  hs: 'FFE2EFDA',
  hsTexte: 'FF375623',
  paye: 'FFFFF2CC',
  trait: 'FFB4C0D6',
  gris: 'FF7F7F7F',
  mutualise: 'FFEDE7F6', // formateur mutualisé : le violet de l'écran
  mutualiseTexte: 'FF5B21B6',
};
const plein = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

/**
 * Formateur MUTUALISÉ (2026-10-18) : Mle et nom sur fond violet, « (mutualisé) » après le nom, et
 * une note sur la cellule avec la masse affectée et le réalisé de chaque établissement — les
 * chiffres de la ligne, eux, sont cumulés sur tous.
 */
/** « 22.5 » → « 22,5 » : les notes se lisent comme le reste du classeur. */
const nombreFr = (valeur) => String(Math.round((Number(valeur) || 0) * 100) / 100).replace('.', ',');

/**
 * Le texte d'une note de répartition : un titre, une ligne par établissement, le total.
 *
 * ⚠️ DES LIGNES COURTES (2026-10-18, signalé par le porteur : « le commentaire n'affiche pas la
 * masse de l'autre établissement »). Une ligne longue passe à la ligne dans le cadre de la note,
 * et les établissements suivants en sortaient : on ne voyait que « Cet établissement ». Le cadre
 * est aussi agrandi à l'enregistrement — voir `agrandirLesNotes`.
 */
function noteRepartition(titre, ici, ailleurs, total) {
  return [
    titre,
    `• Ici : ${nombreFr(ici)} h`,
    ...ailleurs.map((a) => `• ${a.nom} : ${nombreFr(a.valeur)} h`),
    `= Total : ${nombreFr(total)} h`,
  ].join('\n');
}

/** Pose une note de répartition sur une cellule, et la teinte en violet. */
function noter(cellule, texte) {
  cellule.note = texte;
  cellule.font = { ...(cellule.font ?? {}), color: { argb: COULEURS.mutualiseTexte } };
}

/** Les heures d'un formateur mutualisé sur une liste de semaines, par établissement. */
function repartitionDesSemaines(semainesDuFormateur) {
  const parEtablissement = new Map();
  let total = 0;
  for (const semaine of semainesDuFormateur) {
    total += semaine.heures ?? 0;
    for (const autre of semaine.ailleurs ?? []) {
      parEtablissement.set(autre.nom, (parEtablissement.get(autre.nom) ?? 0) + autre.heures);
    }
  }
  const ailleurs = [...parEtablissement].map(([nom, valeur]) => ({ nom, valeur }));
  const horsIci = ailleurs.reduce((somme, a) => somme + a.valeur, 0);
  return { ici: total - horsIci, ailleurs, total };
}

/**
 * Formateur MUTUALISÉ (2026-10-18) : Mle et nom sur fond violet, « (mutualisé) » après le nom, et
 * une note sur chaque valeur qui cumule plusieurs établissements, avec la part de chacun :
 *   - le nom : masse affectée et heures réalisées, établissement par établissement ;
 *   - la masse affectée (synthèse) ;
 *   - les heures d'un mois (synthèse) et le total réalisé du mois (feuille mensuelle) ;
 *   - les heures d'une semaine (feuille mensuelle), quand une part a été faite ailleurs.
 *
 * @param {object} options
 * @param {number} [options.colAffectee]  colonne de la masse affectée
 * @param {Array<{colonne: number, semaines: object[], titre: string}>} [options.heures]  cellules
 *   d'heures à commenter, avec les semaines du formateur qu'elles additionnent
 */
function marquerMutualise(ligne, formateur, { colAffectee = null, heures = [] } = {}) {
  if (!formateur.mutualise) return;
  const { ici, ailleurs } = formateur.mutualise;

  for (const c of [1, 2]) ligne.getCell(c).fill = plein(COULEURS.mutualise);
  const nom = ligne.getCell(2);
  nom.value = `${formateur.nom} (mutualisé)`;
  nom.font = { ...(nom.font ?? {}), color: { argb: COULEURS.mutualiseTexte } };
  nom.note = [
    'Formateur mutualisé',
    `• Ici : ${nombreFr(ici.affecte)} h affectées, ${nombreFr(ici.heures)} h réalisées`,
    ...ailleurs.map((a) => `• ${a.nom} : ${nombreFr(a.affecte)} h affectées, ${nombreFr(a.heures)} h réalisées`),
    `= Total : ${nombreFr(formateur.affecte)} h affectées, ${nombreFr(formateur.totaux.heures)} h réalisées`,
  ].join('\n');

  if (colAffectee) {
    noter(
      ligne.getCell(colAffectee),
      noteRepartition(
        'Masse affectée',
        ici.affecte,
        ailleurs.map((a) => ({ nom: a.nom, valeur: a.affecte })),
        formateur.affecte
      )
    );
  }

  for (const { colonne, semaines, titre } of heures) {
    const repartition = repartitionDesSemaines(semaines);
    if (repartition.ailleurs.length === 0) continue;
    noter(
      ligne.getCell(colonne),
      noteRepartition(titre, repartition.ici, repartition.ailleurs, repartition.total)
    );
  }
}

/**
 * ⚠️ LE CADRE DES NOTES EST AGRANDI APRÈS COUP (2026-10-18). ExcelJS le fixe à 2 colonnes sur
 * 4 lignes, sans réglage : une répartition sur trois établissements n'y tenait pas. On retouche
 * donc l'ancre de chaque note dans le classeur produit — 4 colonnes sur 8 lignes.
 */
async function agrandirLesNotes(tampon) {
  const zip = await JSZip.loadAsync(tampon);
  const dessins = Object.keys(zip.files).filter((chemin) => /^xl\/drawings\/vmlDrawing\d+\.vml$/.test(chemin));
  if (dessins.length === 0) return tampon;

  for (const chemin of dessins) {
    const xml = await zip.file(chemin).async('string');
    const agrandi = xml.replace(/<x:Anchor>([^<]+)<\/x:Anchor>/g, (tout, valeurs) => {
      const [gauche, dg, haut, dh] = valeurs.split(',').map((v) => Number(v.trim()));
      if ([gauche, dg, haut, dh].some(Number.isNaN)) return tout;
      return `<x:Anchor>${[gauche, dg, haut, dh, gauche + 4, 2, haut + 8, 16].join(', ')}</x:Anchor>`;
    });
    zip.file(chemin, agrandi);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const MENTION_MUTUALISE = ' · Violet : formateur mutualisé, heures cumulées sur tous ses établissements (détail en note)';
const fin = { style: 'thin', color: { argb: COULEURS.trait } };
const moyen = { style: 'medium', color: { argb: COULEURS.marine } };
const CADRE = { top: fin, left: fin, bottom: fin, right: fin };
const POLICE = 'Calibri';

// Deux décimales, mais « 0 » tout court pour un zéro — comme les colonnes Cumul et Plafond.
const FORMAT_HEURES = '0.00';
const FORMAT_CUMUL = '0.00;-0.00;0';
// TH.SUP : négatif en rouge, avec le signe moins (2026-10-20, demande du porteur).
const FORMAT_ECART = '0.00;[Red]-0.00;0.00';
const ROUGE = 'FFC00000';

/**
 * Le TH.SUP d'une semaine, NÉGATIF compris — la même règle que l'écran (`ecartSemaine` de
 * `HeuresSupp.jsx`) : les heures supp si le seuil est atteint, sinon ce qui manque pour l'atteindre.
 * Un simple affichage : le Cumul, le Plafond et le quota ne comptent que les heures supp.
 *
 * @returns {number|null}  `null` : case vide — vacataire, ou semaine pas encore commencée
 */
function ecartSemaine(semaine, realiseAu) {
  if (!semaine || semaine.seuil === null || semaine.seuil === undefined) return null;
  if (realiseAu && semaine.lundi > realiseAu.date) return null;
  return semaine.heures < semaine.seuil ? semaine.heures - semaine.seuil : semaine.brut;
}

/** « AAAA-MM-JJ » + n jours, à midi : un changement d'heure ne fait pas glisser le jour. */
function decaler(jour, jours) {
  const date = new Date(`${jour}T12:00:00`);
  date.setDate(date.getDate() + jours);
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

const arrondi = (valeur) => Math.round(valeur * 100) / 100;
const libelleMois = (cle) => `${MOIS[Number(cle.slice(5, 7)) - 1]} ${cle.slice(0, 4)}`;

/**
 * SYNTHÈSE ANNUELLE — la première feuille du classeur (2026-10-17) : un formateur par ligne,
 * ses masses et son quota, puis mois par mois les heures réalisées et les HS payées, et les
 * totaux de l'année. Même charte que les feuilles mensuelles.
 */
function ajouterSyntheseAnnuelle(classeur, { parMatricule, moisTravailles, etablissement, anneeScolaire, realiseAu }) {
  const feuille = classeur.addWorksheet('Synthèse annuelle', {
    properties: { defaultRowHeight: 18, tabColor: { argb: COULEURS.marine } },
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
    headerFooter: { oddFooter: `&L&8${mentionRealise(realiseAu)}&R&8Page &P / &N` },
  });

  // Colonnes : Mle, Nom, Statutaire, MHS, Affectée, Quota, 2 par mois, puis les totaux de l'année.
  const PREMIER_MOIS = 7;
  const colTotal = PREMIER_MOIS + moisTravailles.length * 2;
  const colHs = colTotal + 1;
  const colPaye = colTotal + 2;
  const colReste = colTotal + 3;
  const derniere = colReste;

  feuille.getColumn(1).width = 10;
  feuille.getColumn(2).width = 32;
  for (let c = 3; c < PREMIER_MOIS; c += 1) feuille.getColumn(c).width = 10;
  for (let c = PREMIER_MOIS; c < colTotal; c += 1) feuille.getColumn(c).width = 10;
  for (let c = colTotal; c <= derniere; c += 1) feuille.getColumn(c).width = 11;

  /* ─── En-tête du document ─────────────────────────────────────────── */
  feuille.mergeCells(1, 1, 1, derniere);
  const titre = feuille.getCell(1, 1);
  titre.value = `SYNTHÈSE ANNUELLE DES HEURES SUPPLÉMENTAIRES — ${anneeScolaire}/${anneeScolaire + 1}`;
  titre.font = { name: POLICE, size: 15, bold: true, color: { argb: COULEURS.marine } };
  titre.alignment = { horizontal: 'center', vertical: 'middle' };
  feuille.getRow(1).height = 28;

  const milieu = Math.max(4, colTotal - 1);
  feuille.mergeCells(2, 1, 2, milieu);
  feuille.getCell(2, 1).value = {
    richText: [
      { text: 'EFP : ', font: { name: POLICE, size: 11 } },
      { text: etablissement?.nom ?? '', font: { name: POLICE, size: 11, bold: true } },
    ],
  };
  feuille.mergeCells(2, milieu + 1, 2, derniere);
  feuille.getCell(2, milieu + 1).value = {
    richText: [
      { text: 'Année Formation : ', font: { name: POLICE, size: 11 } },
      { text: `${anneeScolaire}/${anneeScolaire + 1}`, font: { name: POLICE, size: 11, bold: true } },
    ],
  };
  feuille.getCell(2, milieu + 1).alignment = { horizontal: 'right' };

  feuille.mergeCells(3, 1, 3, derniere);
  feuille.getCell(3, 1).value =
    'Quota HS = masse affectée − masse statutaire · MHS : 26 h (910 h), 36 h (1260 h) · vacataires ' +
    'non listés (sans HS) · ' + mentionRealise(realiseAu) + MENTION_MUTUALISE;
  feuille.getCell(3, 1).font = { name: POLICE, italic: true, size: 9, color: { argb: COULEURS.gris } };

  /* ─── En-tête du tableau : deux lignes ────────────────────────────── */
  const L1 = 5;
  const L2 = 6;
  const entete = (ligne, colonne, valeur, { fond = COULEURS.marine, texte = 'FFFFFFFF' } = {}) => {
    const cellule = feuille.getCell(ligne, colonne);
    cellule.value = valeur;
    cellule.font = { name: POLICE, size: 10, bold: true, color: { argb: texte } };
    cellule.fill = plein(fond);
    cellule.border = { top: moyen, left: fin, right: fin, bottom: ligne === L2 ? moyen : fin };
    cellule.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  };
  const fixes = [
    [1, 'Mle'],
    [2, 'Nom et Prénom'],
    [3, 'Masse\nstatutaire'],
    [4, 'MHS'],
    [5, 'Masse\naffectée'],
    [6, 'Quota\nHS'],
    [colTotal, 'Total\nRéalisé'],
    [colHs, 'HS\nréalisées'],
    [colPaye, 'HS payées\n(année)'],
    [colReste, 'Reste du\nquota'],
  ];
  for (const [colonne, libelle] of fixes) {
    entete(L1, colonne, libelle);
    entete(L2, colonne, null);
    feuille.mergeCells(L1, colonne, L2, colonne);
  }
  moisTravailles.forEach((mois, i) => {
    const colonne = PREMIER_MOIS + i * 2;
    const style = { fond: COULEURS.semaine, texte: COULEURS.marine };
    entete(L1, colonne, libelleMois(mois), style);
    entete(L1, colonne + 1, null, style);
    feuille.mergeCells(L1, colonne, L1, colonne + 1);
    entete(L2, colonne, 'TH.R', { fond: COULEURS.sousEntete, texte: COULEURS.marine });
    entete(L2, colonne + 1, 'HS payées', { fond: COULEURS.sousEntete, texte: COULEURS.marine });
  });
  feuille.getRow(L1).height = 34;
  feuille.getRow(L2).height = 20;

  /* ─── Une ligne par formateur ─────────────────────────────────────── */
  const premiereLigne = L2 + 1;
  parMatricule.forEach((formateur, index) => {
    const ligne = feuille.getRow(premiereLigne + index);
    const parMois = new Map(formateur.mois.map((m) => [m.mois, m]));
    const matricule = /^\d+$/.test(formateur.matricule) ? Number(formateur.matricule) : formateur.matricule;
    const valeurs = [
      matricule,
      formateur.nom,
      formateur.statutaire || null,
      formateur.mhs ?? (formateur.statut === 'vacataire' ? 'Vac.' : '—'),
      formateur.affecte,
      formateur.totaux.quota,
    ];
    for (const mois of moisTravailles) {
      const m = parMois.get(mois);
      valeurs.push(m?.heures ?? 0, m?.paye ? m.paye : null);
    }
    valeurs.push(formateur.totaux.heures, formateur.totaux.brut, formateur.totaux.paye, formateur.totaux.restant);
    ligne.values = valeurs;
    ligne.height = 18;

    const vacataire = formateur.statut === 'vacataire';
    const discret = vacataire ? { italic: true, color: { argb: COULEURS.gris } } : {};
    const fond = index % 2 === 1 ? plein(COULEURS.zebre) : undefined;
    for (let c = 1; c <= derniere; c += 1) {
      const cellule = ligne.getCell(c);
      cellule.border = CADRE;
      cellule.font = { name: POLICE, size: 10, ...discret };
      cellule.alignment =
        c <= 2
          ? { horizontal: 'left', vertical: 'middle', indent: 1 }
          : { horizontal: 'center', vertical: 'middle' };
      if (fond) cellule.fill = fond;
      // Les masses (statutaire, MHS, affectée) restent des nombres simples : 910, pas 910,00.
      if (c >= 6) cellule.numFmt = c >= PREMIER_MOIS && c < colTotal ? FORMAT_HEURES : FORMAT_CUMUL;
    }
    ligne.getCell(2).font = { name: POLICE, size: 10, bold: !vacataire, ...discret };
    marquerMutualise(ligne, formateur, {
      colAffectee: 5,
      heures: moisTravailles.map((mois, i) => ({
        colonne: PREMIER_MOIS + i * 2,
        semaines: formateur.semaines.filter((semaine) => semaine.mois === mois),
        titre: `Heures réalisées — ${libelleMois(mois)}`,
      })),
    });

    // Les HS payées d'un mois se voient d'un coup d'œil.
    moisTravailles.forEach((_, i) => {
      const cellule = ligne.getCell(PREMIER_MOIS + i * 2 + 1);
      if (cellule.value) {
        cellule.fill = plein(COULEURS.paye);
        cellule.font = { name: POLICE, size: 10, bold: true };
      }
    });
    ligne.getCell(colTotal).font = { name: POLICE, size: 10, bold: true, ...discret };
    ligne.getCell(colPaye).fill = plein(COULEURS.paye);
    ligne.getCell(colPaye).font = { name: POLICE, size: 10, bold: true };
    ligne.getCell(colReste).font = { name: POLICE, size: 10, bold: true, color: { argb: COULEURS.marine } };
  });

  /* ─── Ligne de total ──────────────────────────────────────────────── */
  const derniereLigne = premiereLigne + parMatricule.length - 1;
  const total = feuille.getRow(derniereLigne + 1);
  feuille.mergeCells(derniereLigne + 1, 1, derniereLigne + 1, 4);
  total.getCell(1).value = 'TOTAL';
  for (let c = 5; c <= derniere; c += 1) {
    const lettre = feuille.getColumn(c).letter;
    const somme = parMatricule.reduce(
      (acc, _, i) => acc + (Number(feuille.getCell(premiereLigne + i, c).value) || 0),
      0
    );
    total.getCell(c).value = {
      formula: `SUM(${lettre}${premiereLigne}:${lettre}${derniereLigne})`,
      result: arrondi(somme),
    };
    if (c >= 6) total.getCell(c).numFmt = FORMAT_CUMUL;
  }
  for (let c = 1; c <= derniere; c += 1) {
    const cellule = total.getCell(c);
    cellule.fill = plein(COULEURS.semaine);
    cellule.font = { name: POLICE, size: 10, bold: true, color: { argb: COULEURS.marine } };
    cellule.border = { top: moyen, bottom: moyen, left: fin, right: fin };
    cellule.alignment = { horizontal: 'center', vertical: 'middle' };
  }
  total.height = 20;

  feuille.views = [{ state: 'frozen', xSplit: 2, ySplit: L2, showGridLines: false }];
  feuille.pageSetup.printTitlesRow = `${L1}:${L2}`;
}

export async function construireEtatMensuelHeuresSupp(etablissementId, anneeScolaire) {
  const [{ semaines: calendrier, formateurs, realiseAu }, etablissement] = await Promise.all([
    heuresSupplementaires(etablissementId, anneeScolaire, { complet: true }),
    Etablissement.findById(etablissementId).select('nom').lean(),
  ]);

  const parMatricule = [...formateurs].sort((a, b) =>
    String(a.matricule).localeCompare(String(b.matricule), 'fr', { numeric: true })
  );
  const detail = new Map(formateurs.map((f) => [f, new Map(f.semaines.map((s) => [s.numero, s]))]));
  const moisTravailles = [...new Set(calendrier.map((s) => s.mois))].filter((mois) =>
    formateurs.some((f) => f.mois.some((m) => m.mois === mois && m.heures > 0))
  );

  const classeur = nouveauClasseur();
  // La ligne TOTAL est en formules : Excel les recalcule à l'ouverture, même un total nul.
  classeur.calcProperties.fullCalcOnLoad = true;

  // La synthèse de l'année d'abord : c'est la feuille qu'on ouvre en premier.
  if (moisTravailles.length > 0) {
    ajouterSyntheseAnnuelle(classeur, { parMatricule, moisTravailles, etablissement, anneeScolaire, realiseAu });
  }

  for (const mois of moisTravailles) {
    const semaines = calendrier.filter((s) => s.mois === mois);
    const nomMois = MOIS[Number(mois.slice(5, 7)) - 1];
    const feuille = classeur.addWorksheet(`${nomMois} ${mois.slice(0, 4)}`, {
      properties: { defaultRowHeight: 18 },
      pageSetup: {
        orientation: 'landscape',
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      },
      headerFooter: { oddFooter: `&L&8${mentionRealise(realiseAu)}&R&8Page &P / &N` },
    });

    // Colonnes : Mle, Nom, MHS, 2 par semaine, puis Total, Cumul, Plafond, Quota, Reste.
    const PREMIERE_SEMAINE = 4;
    const colTotal = PREMIERE_SEMAINE + semaines.length * 2;
    const colCumul = colTotal + 1;
    const colPlafond = colTotal + 2;
    const colQuota = colTotal + 3;
    const colReste = colTotal + 4;
    const derniere = colReste;

    feuille.getColumn(1).width = 10;
    feuille.getColumn(2).width = 32;
    feuille.getColumn(3).width = 7;
    for (let c = PREMIERE_SEMAINE; c < colTotal; c += 1) feuille.getColumn(c).width = 9.5;
    for (let c = colTotal; c <= derniere; c += 1) feuille.getColumn(c).width = 11;

    /* ─── En-tête du document ─────────────────────────────────────────── */
    feuille.mergeCells(1, 1, 1, derniere);
    const titre = feuille.getCell(1, 1);
    titre.value = `ÉTAT MENSUEL DES HEURES SUPPLÉMENTAIRES — ${nomMois.toUpperCase()} ${mois.slice(0, 4)}`;
    titre.font = { name: POLICE, size: 15, bold: true, color: { argb: COULEURS.marine } };
    titre.alignment = { horizontal: 'center', vertical: 'middle' };
    feuille.getRow(1).height = 28;

    const milieu = Math.max(3, colTotal - 1);
    feuille.mergeCells(2, 1, 2, milieu);
    feuille.getCell(2, 1).value = {
      richText: [
        { text: 'EFP : ', font: { name: POLICE, size: 11 } },
        { text: etablissement?.nom ?? '', font: { name: POLICE, size: 11, bold: true } },
      ],
    };
    feuille.mergeCells(2, milieu + 1, 2, derniere);
    feuille.getCell(2, milieu + 1).value = {
      richText: [
        { text: 'Année Formation : ', font: { name: POLICE, size: 11 } },
        { text: `${anneeScolaire}/${anneeScolaire + 1}`, font: { name: POLICE, size: 11, bold: true } },
        { text: '     Mois : ', font: { name: POLICE, size: 11 } },
        { text: nomMois, font: { name: POLICE, size: 11, bold: true } },
      ],
    };
    feuille.getCell(2, milieu + 1).alignment = { horizontal: 'right' };

    // Les deux numérotations cohabitent dans l'en-tête des semaines : on dit laquelle est laquelle.
    feuille.mergeCells(3, 1, 3, derniere);
    feuille.getCell(3, 1).value =
      'S-xx : semaine calendaire · (Sn) : semaine de l’année de formation · JF : jours fériés ou ' +
      'de vacances · ' + mentionRealise(realiseAu) + MENTION_MUTUALISE;
    feuille.getCell(3, 1).font = { name: POLICE, italic: true, size: 9, color: { argb: COULEURS.gris } };

    /* ─── En-tête du tableau : deux lignes ────────────────────────────── */
    const L1 = 5;
    const L2 = 6;
    const entete = (ligne, colonne, valeur, { fond = COULEURS.marine, texte = 'FFFFFFFF' } = {}) => {
      const cellule = feuille.getCell(ligne, colonne);
      cellule.value = valeur;
      cellule.font = { name: POLICE, size: 10, bold: true, color: { argb: texte } };
      cellule.fill = plein(fond);
      cellule.border = { top: moyen, left: fin, right: fin, bottom: ligne === L2 ? moyen : fin };
      cellule.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    };
    const fixes = [
      [1, 'Mle'],
      [2, 'Nom et Prénom'],
      [3, 'MHS'],
      [colTotal, 'Total\nRéalisé'],
      [colCumul, 'Cumul\nTH.SUP'],
      [colPlafond, 'Plafond\n(payé)'],
      [colQuota, 'Quota\nHS'],
      [colReste, 'Reste du\nquota'],
    ];
    for (const [colonne, libelle] of fixes) {
      entete(L1, colonne, libelle);
      entete(L2, colonne, null);
      feuille.mergeCells(L1, colonne, L2, colonne);
    }
    semaines.forEach((semaine, i) => {
      const colonne = PREMIERE_SEMAINE + i * 2;
      const fond = semaine.joursFermes > 0 ? COULEURS.semaineFermee : COULEURS.semaine;
      const style = { fond, texte: COULEURS.marine };
      // « S-37 (S1) » : la semaine calendaire, puis celle de l'année de formation.
      entete(
        L1,
        colonne,
        `S-${semaine.calendaire} (S${semaine.numero})\n${dateFr(semaine.lundi)}\nau ` +
          `${dateFr(decaler(semaine.lundi, 5))}\nJF=${semaine.joursFermes}`,
        style
      );
      entete(L1, colonne + 1, null, style);
      feuille.mergeCells(L1, colonne, L1, colonne + 1);
      entete(L2, colonne, 'TH.R', { fond: COULEURS.sousEntete, texte: COULEURS.marine });
      entete(L2, colonne + 1, 'TH.SUP', { fond: COULEURS.sousEntete, texte: COULEURS.marine });
    });
    feuille.getRow(L1).height = 66;
    feuille.getRow(L2).height = 20;

    /* ─── Une ligne par formateur ─────────────────────────────────────── */
    const premiereLigne = L2 + 1;
    parMatricule.forEach((formateur, index) => {
      const ligne = feuille.getRow(premiereLigne + index);
      const moisFormateur = formateur.mois.find((m) => m.mois === mois);
      // Le reste du quota APRÈS la dernière semaine du mois : ce que le calcul a laissé à payer.
      const resteFinDeMois =
        formateur.semaines.filter((s) => s.mois === mois).at(-1)?.restant ?? formateur.totaux.quota;
      // Un matricule tout en chiffres part en NOMBRE : en texte, Excel le marque d'un triangle vert.
      const matricule = /^\d+$/.test(formateur.matricule) ? Number(formateur.matricule) : formateur.matricule;
      const valeurs = [matricule, formateur.nom, formateur.mhs ?? 'Vac.'];
      for (const semaine of semaines) {
        const s = detail.get(formateur).get(semaine.numero);
        valeurs.push(s?.heures ?? 0, ecartSemaine(s, realiseAu));
      }
      valeurs.push(
        moisFormateur?.heures ?? 0,
        moisFormateur?.cumul ?? null,
        moisFormateur?.paye ?? 0,
        formateur.totaux.quota,
        resteFinDeMois
      );
      ligne.values = valeurs;
      ligne.height = 18;

      const vacataire = formateur.statut === 'vacataire';
      const fond = index % 2 === 1 ? plein(COULEURS.zebre) : undefined;
      for (let c = 1; c <= derniere; c += 1) {
        const cellule = ligne.getCell(c);
        cellule.border = CADRE;
        cellule.font = { name: POLICE, size: 10, ...(vacataire ? { italic: true, color: { argb: COULEURS.gris } } : {}) };
        cellule.alignment = c <= 2
          ? { horizontal: 'left', vertical: 'middle', indent: 1 }
          : { horizontal: 'center', vertical: 'middle' };
        if (fond) cellule.fill = fond;
        if (c >= 3) cellule.numFmt = c >= colCumul ? FORMAT_CUMUL : FORMAT_HEURES;
      }
      ligne.getCell(3).numFmt = '0';
      ligne.getCell(2).font = { name: POLICE, size: 10, bold: !vacataire, ...(vacataire ? { italic: true, color: { argb: COULEURS.gris } } : {}) };
      const semainesDuFormateur = semaines.map((s) => detail.get(formateur).get(s.numero)).filter(Boolean);
      marquerMutualise(ligne, formateur, {
        heures: [
          ...semaines.map((s, i) => ({
            colonne: PREMIERE_SEMAINE + i * 2,
            semaines: [detail.get(formateur).get(s.numero)].filter(Boolean),
            titre: `S-${s.calendaire} (S${s.numero}) — heures réalisées`,
          })),
          { colonne: colTotal, semaines: semainesDuFormateur, titre: `Total réalisé — ${nomMois}` },
        ],
      });

      // Une heure supplémentaire se voit d'un coup d'œil.
      semaines.forEach((_, i) => {
        const cellule = ligne.getCell(PREMIERE_SEMAINE + i * 2 + 1);
        cellule.numFmt = FORMAT_ECART;
        if (cellule.value > 0) {
          cellule.fill = plein(COULEURS.hs);
          cellule.font = { name: POLICE, size: 10, bold: true, color: { argb: COULEURS.hsTexte } };
        } else if (cellule.value < 0) {
          cellule.font = { name: POLICE, size: 10, color: { argb: ROUGE } };
        }
      });
      ligne.getCell(colTotal).font = { name: POLICE, size: 10, bold: true };
      // Le Cumul peut être négatif — ce qui manque pour atteindre la masse du mois.
      const cumul = ligne.getCell(colCumul);
      cumul.numFmt = FORMAT_ECART;
      if (cumul.value < 0) cumul.font = { name: POLICE, size: 10, color: { argb: ROUGE } };
      else if (cumul.value > 0) cumul.font = { name: POLICE, size: 10, bold: true, color: { argb: COULEURS.hsTexte } };
      ligne.getCell(colPlafond).fill = plein(COULEURS.paye);
      ligne.getCell(colPlafond).font = { name: POLICE, size: 10, bold: true };
      ligne.getCell(colReste).font = { name: POLICE, size: 10, bold: true, color: { argb: COULEURS.marine } };
    });

    /* ─── Ligne de total ──────────────────────────────────────────────── */
    const derniereLigne = premiereLigne + parMatricule.length - 1;
    const total = feuille.getRow(derniereLigne + 1);
    feuille.mergeCells(derniereLigne + 1, 1, derniereLigne + 1, 3);
    total.getCell(1).value = 'TOTAL';
    for (let c = PREMIERE_SEMAINE; c <= derniere; c += 1) {
      const lettre = feuille.getColumn(c).letter;
      const somme = parMatricule.reduce((acc, _, i) => acc + (Number(feuille.getCell(premiereLigne + i, c).value) || 0), 0);
      total.getCell(c).value = {
        formula: `SUM(${lettre}${premiereLigne}:${lettre}${derniereLigne})`,
        result: arrondi(somme),
      };
      total.getCell(c).numFmt = FORMAT_CUMUL;
    }
    for (let c = 1; c <= derniere; c += 1) {
      const cellule = total.getCell(c);
      cellule.fill = plein(COULEURS.semaine);
      cellule.font = { name: POLICE, size: 10, bold: true, color: { argb: COULEURS.marine } };
      cellule.border = { top: moyen, bottom: moyen, left: fin, right: fin };
      cellule.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    total.height = 20;

    feuille.views = [{ state: 'frozen', xSplit: 3, ySplit: L2, showGridLines: false }];
    feuille.pageSetup.printTitlesRow = `${L1}:${L2}`;
  }

  if (moisTravailles.length === 0) classeur.addWorksheet('Aucune séance');

  return {
    tampon: await agrandirLesNotes(Buffer.from(await classeur.xlsx.writeBuffer())),
    nomFichier: `Etat_mensuel_heures_supp_${anneeScolaire}-${anneeScolaire + 1}.xlsx`,
    resume: { mois: moisTravailles.length, formateurs: formateurs.length },
  };
}
