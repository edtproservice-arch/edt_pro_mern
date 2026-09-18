import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { badRequest } from './httpError.js';

/**
 * Lecture d'un classeur, quel que soit son format.
 *
 * ═══ POURQUOI DEUX BIBLIOTHÈQUES ═══
 * `exceljs` ne lit QUE l'OOXML (.xlsx). Le vieux format binaire d'Excel 97-2003
 * (BIFF8, .xls) lui est étranger — d'où le refus explicite que portaient les
 * deux imports. Or e-note comme Konosys peuvent encore l'exporter, et
 * l'interface d'origine l'acceptait : le refuser était une régression.
 *
 * SheetJS lit les deux, mais on ne l'emploie QUE pour le .xls : le chemin .xlsx
 * — de loin le plus fréquent — reste sur `exceljs`, déjà éprouvé ici par les
 * tests de caractérisation des 24 imports réels. Changer de lecteur pour lui
 * aurait demandé de tout recaractériser sans rien gagner.
 *
 * ⚠️ SheetJS est installé depuis le CDN de son éditeur, PAS depuis npm : la
 * dernière version publiée sur npm (0.18.5) porte deux failles connues
 * (pollution de prototype, ReDoS) corrigées en 0.19.3 et 0.20.2, et l'éditeur
 * ne publie plus sur npm. `node-xlsx` procède de la même façon. Ne pas
 * « simplifier » en repassant sur `npm i xlsx`.
 */

/** Le format se reconnaît à l'extension — le type MIME du navigateur ne vaut rien. */
export function estAncienFormat(nomFichier) {
  return /\.xls$/i.test(String(nomFichier ?? ''));
}

/**
 * Première feuille du classeur, en lignes de CHAÎNES.
 *
 * L'alignement des colonnes est préservé : les cellules vides deviennent des
 * chaînes vides plutôt que d'être sautées. Tout le format e-note repose sur
 * l'index des colonnes — une cellule omise décalerait les 51 suivantes.
 *
 * @returns {Promise<{nom: string, lignes: string[][]}>}
 */
export async function lirePremiereFeuille(tampon, nomFichier) {
  return estAncienFormat(nomFichier) ? lireAncienFormat(tampon) : lireOoxml(tampon);
}

/**
 * TOUTES les feuilles du classeur.
 *
 * ⚠️ LES LIGNES VIDES SONT CONSERVÉES ICI, contrairement à `lirePremiereFeuille`.
 * L'import du chronogramme rapporte ses refus par NUMÉRO DE LIGNE (« ligne 23 :
 * module inconnu ») : sauter les lignes vides décalerait ces numéros, et
 * l'utilisateur irait corriger la mauvaise ligne de son fichier.
 *
 * L'index 0 du tableau correspond donc à la ligne 1 du tableur.
 *
 * @returns {Promise<Array<{nom: string, lignes: string[][]}>>}
 */
export async function lireToutesLesFeuilles(tampon, nomFichier) {
  if (estAncienFormat(nomFichier)) {
    let classeur;
    try {
      classeur = XLSX.read(tampon, { type: 'buffer', cellDates: false, cellFormula: false });
    } catch {
      throw badRequest('Fichier .xls illisible ou endommagé', { code: 'FICHIER_ILLISIBLE' });
    }

    return classeur.SheetNames.map((nom) => ({
      nom,
      lignes: normaliser(
        XLSX.utils.sheet_to_json(classeur.Sheets[nom], {
          header: 1,
          raw: false,
          defval: '',
          blankrows: true,
        })
      ),
    }));
  }

  const classeur = new ExcelJS.Workbook();
  try {
    await classeur.xlsx.load(tampon);
  } catch {
    throw badRequest('Fichier illisible : ce n’est pas un classeur Excel valide', {
      code: 'FICHIER_ILLISIBLE',
    });
  }

  if (classeur.worksheets.length === 0) {
    throw badRequest('Le classeur ne contient aucune feuille', { code: 'FICHIER_VIDE' });
  }

  return classeur.worksheets.map((feuille) => ({
    nom: feuille.name,
    /* `includeEmpty` : les lignes vides sont conservées ici — les refus sont
       rapportés par numéro de ligne du tableur. */
    lignes: normaliser(lignesDeLaFeuille(feuille, true)),
  }));
}

/** .xls — BIFF8, via SheetJS. */
function lireAncienFormat(tampon) {
  let classeur;

  try {
    classeur = XLSX.read(tampon, { type: 'buffer', cellDates: false, cellFormula: false });
  } catch {
    throw badRequest('Fichier .xls illisible ou endommagé', { code: 'FICHIER_ILLISIBLE' });
  }

  const nom = classeur.SheetNames[0];
  if (!nom) throw badRequest('Le classeur ne contient aucune feuille', { code: 'FICHIER_VIDE' });

  /*
   * `raw: false` rend les valeurs TELLES QU'AFFICHÉES — une date reste la date
   * lue à l'écran plutôt qu'un numéro de série, et un matricule gardé en texte
   * ne devient pas un nombre. `defval` comble les cellules vides.
   */
  const lignes = XLSX.utils.sheet_to_json(classeur.Sheets[nom], {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });

  return { nom, lignes: normaliser(lignes) };
}

/** .xlsx — OOXML, via exceljs. */
async function lireOoxml(tampon) {
  const classeur = new ExcelJS.Workbook();

  try {
    await classeur.xlsx.load(tampon);
  } catch {
    throw badRequest('Fichier illisible : ce n’est pas un classeur Excel valide', {
      code: 'FICHIER_ILLISIBLE',
    });
  }

  const feuille = classeur.worksheets[0];
  if (!feuille || feuille.rowCount === 0) {
    throw badRequest('Le fichier ne contient aucune feuille exploitable', { code: 'FICHIER_VIDE' });
  }

  return { nom: feuille.name, lignes: normaliser(lignesDeLaFeuille(feuille, false)) };
}

/**
 * Les lignes d'une feuille, en tableaux de CHAÎNES alignés sur les colonnes.
 *
 * ═══ ⚠️⚠️ ON LIT `row.values`, JAMAIS `getCell` COLONNE PAR COLONNE ═══
 * (défaut signalé par le porteur le 2026-09-02 : « il reste en analyse ».)
 *
 * Mesuré sur son classeur DRIF réel — 13 327 lignes × 43 colonnes, soit
 * **573 061 cellules** :
 *   · `ligne.getCell(c)`  → 207 s pour 21 500 cellules, soit **9,6 ms par
 *                            cellule**, et ~92 MINUTES pour la feuille ;
 *   · `ligne.values`      → **75 ms pour la feuille entière.**
 * Le chargement du fichier par exceljs, lui, ne prend que 3,3 s : tout le temps
 * passait donc dans cette boucle. L'écart est de l'ordre de 60 000.
 *
 * `values` rend le tableau CREUX déjà construit par exceljs, indexé à partir de
 * 1 ; `getCell` va chercher — et au besoin CRÉE — un objet cellule par appel,
 * ce qui dégénère sur une feuille large.
 *
 * ⚠️ ON PARCOURT TOUJOURS PAR INDEX DE COLONNE, pas avec `eachCell` : celui-ci
 * saute les cellules vides, et l'alignement des colonnes doit être conservé —
 * une cellule omise décalerait toutes les suivantes.
 *
 * ⚠️ ET L'INDEX 0 DE `values` N'EXISTE PAS : exceljs y laisse un trou pour que
 * l'indice corresponde au numéro de colonne. Le lire donnerait une colonne
 * fantôme en tête de chaque ligne.
 */
function lignesDeLaFeuille(feuille, avecLignesVides) {
  const lignes = [];
  const largeur = feuille.columnCount;

  feuille.eachRow({ includeEmpty: avecLignesVides }, (ligne) => {
    const valeurs = ligne.values;
    const sortie = new Array(largeur);
    for (let colonne = 1; colonne <= largeur; colonne += 1) {
      sortie[colonne - 1] = enTexte(valeurs?.[colonne]);
    }
    lignes.push(sortie);
  });

  return lignes;
}

/** Valeur de cellule exceljs → chaîne. */
function enTexte(valeur) {
  if (valeur === null || valeur === undefined) return '';
  if (typeof valeur !== 'object') return String(valeur);

  // Cellule calculée : on prend le résultat, pas la formule.
  if (valeur.result !== undefined) return String(valeur.result);
  // Texte enrichi.
  if (valeur.text !== undefined) return String(valeur.text);

  return String(valeur);
}

/**
 * Toutes les lignes à la même largeur.
 *
 * SheetJS tronque les lignes après leur dernière cellule renseignée : une ligne
 * dont les dix dernières colonnes sont vides revient plus courte, et une lecture
 * par index y trouverait `undefined` au lieu d'une chaîne vide.
 */
function normaliser(lignes) {
  const largeur = lignes.reduce((max, ligne) => Math.max(max, ligne.length), 0);

  return lignes.map((ligne) =>
    Array.from({ length: largeur }, (_, index) => String(ligne[index] ?? ''))
  );
}
