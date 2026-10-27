import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import {
  ESPACE,
  FOND,
  TAB,
  bord,
  cellule,
  ligne,
  paragraphe,
  rangee,
  rempli,
  run,
  tableau,
} from './formulaireComposeDocx.js';
import { centrerTitresEntete } from './enteteCanevas.js';
import { ajouterNumerotation } from '../seances/numerotationPages.js';

/**
 * ═══ L'EN-TÊTE D'UNE ÉPREUVE — CONTRÔLE CONTINU OU EFM (2026-10-26, demande du porteur,
 * canevas `CONTRÔLE.docx` et `EFM.docx`) ═══ La première page du sujet : le formateur n'a
 * plus qu'à écrire ses questions dessous. « Mes documents » : il choisit une de ses séances,
 * qui donne le groupe, le module et la date — comme la feuille de présence CC/EFM.
 *
 * ⚠️ « NOM ET PRÉNOM », « GROUPE » ET « V » RESTENT TOUJOURS VIDES (demande du porteur) :
 *    c'est un canevas que le stagiaire remplit, le même pour toute la classe.
 *
 * Au style des autres documents : l'en-tête de page de la fiche de réclamation (logo OFPPT,
 * « مكتب التكوين المهني وإنعاش الشغل / Office de la Formation… »), un titre encadré sur fond
 * clair, Calibri. Une case non choisie garde les options du canevas (« Th / TP / SY ») pour
 * être entourée à la main, ou ses pointillés.
 *
 * ⚠️ COMME LE CANEVAS (2026-10-26, demande du porteur) :
 *    - « Direction Régionale <région> » puis le NOM ABRÉGÉ de l'établissement, au-dessus du
 *      titre ; le « CFP : … / EFP : … » de l'en-tête de page est retiré.
 *    - SA LARGEUR : marges de 1 cm (567 twips), pas les 1,5 cm des autres documents — le
 *      contenu, en-tête de page compris, s'étend sur 10 772 twips.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CANEVAS_ENTETE = path.join(__dirname, 'canevas', 'ficheReclamation.docx');

export const EPREUVES = { th: 'Théorique', tp: 'Pratique', sy: 'Synthèse' };
export const DUREES = ['1H', '1H30', '2H', '2H30', '3H', '5H'];
export const BAREMES = [20, 40];
export const PORTEES = { local: 'LOCALE', regional: 'RÉGIONALE' };

const NIVEAUX = { TS: 'Technicien spécialisé', T: 'Technicien', Q: 'Qualification', S: 'Spécialisation' };
const GRIS = '7F7F7F';
const POINTS = '……………………………';

// La largeur du canevas : A4 (11 906 twips), marges de 567 de chaque côté.
const MARGE = 567;
// La marge du haut, et la distance de l'en-tête au bord (2026-10-26 : « et la marge top ») : 0,6 cm.
const MARGE_HAUT = 340;
const LARGEUR = 11906 - 2 * MARGE;
const LARGEUR_GAUCHE = 6500;
const LARGEUR_DROITE = LARGEUR - LARGEUR_GAUCHE;

// L'en-tête de page du canevas de la fiche : 10 206 de large, logo 1 600 + titres 8 606.
const LARGEUR_ENTETE = 10206;
const TITRES_ENTETE = 8606;

/** « Libellé : valeur » ; sans valeur, `aDefaut` en gris — les options à entourer, ou des points. */
const info = (libelle, texte, aDefaut = POINTS) =>
  paragraphe(
    run(`${libelle} : `, { gras: true, taille: 22 }) +
      (rempli(texte) ? run(String(texte).trim(), { taille: 22 }) : run(aDefaut, { taille: 22, couleur: GRIS })),
    { apres: 80 }
  );

/** Un côté du cadre des informations : bordé partout sauf entre les deux colonnes. */
const cote = (contenu, largeur, gauche) =>
  cellule(contenu, largeur, {
    bordures:
      '<w:tcBorders>' +
      bord('top', 'single', 6) +
      bord('left', gauche ? 'single' : 'nil', gauche ? 6 : 0) +
      bord('bottom', 'single', 6) +
      bord('right', gauche ? 'nil' : 'single', gauche ? 0 : 6) +
      '</w:tcBorders>',
    marges: [140, 200],
  });

/**
 * @param {{ type: 'cc'|'efm', numero?: number, portee?: 'local'|'regional', region?: string,
 *   anneeScolaire: number, filiere?: string, niveau?: string, annee?: number|null, module?: string,
 *   intitule?: string, date?: string, epreuve?: 'th'|'tp'|'sy', duree?: string, bareme?: number }} e
 */
function corps(e) {
  const titre =
    e.type === 'efm'
      ? `ÉVALUATION DE FIN DE MODULE${e.portee ? ` ${PORTEES[e.portee]}` : ''}`
      : `CONTRÔLE CONTINU N° ${e.numero ?? '……'}`;

  // « Direction Régionale » ne change pas ; la région et le nom abrégé sont ceux de l'établissement.
  const direction =
    paragraphe(run(`Direction Régionale ${e.region ?? ''}`.trim(), { gras: true, taille: 24 }), {
      alignement: 'center',
      apres: 20,
    }) +
    (rempli(e.efp) ? paragraphe(run(e.efp, { gras: true, taille: 24 }), { alignement: 'center', apres: 120 }) : ESPACE(100));

  const cadreTitre = tableau(
    [LARGEUR],
    rangee(
      cellule(
        paragraphe(run(titre, { gras: true, taille: 28 }), { alignement: 'center', apres: 40 }) +
          paragraphe(run(`AU TITRE DE L’ANNÉE : ${e.anneeScolaire}/${e.anneeScolaire + 1}`, { gras: true, taille: 22 }), {
            alignement: 'center',
            apres: 0,
          }),
        LARGEUR,
        { fond: FOND, marges: [120, 200] }
      )
    )
  );

  const niveau = e.niveau ? `${NIVEAUX[e.niveau] ?? e.niveau} (${e.niveau})` : '';
  const annee = e.annee ? (e.annee === 1 ? '1ère année' : `${e.annee}ème année`) : '';
  const informations = tableau(
    [LARGEUR_GAUCHE, LARGEUR_DROITE],
    rangee(
      cote(
        info('Filière', e.filiere) +
          info('Niveau', niveau, 'Q / T / TS') +
          info('N° du module', e.module) +
          info('Intitulé du module', e.intitule) +
          info('Date d’évaluation', e.date, '……… / ……… / ………'),
        LARGEUR_GAUCHE,
        true
      ) +
        cote(
          info('Année de formation', annee, '1A / 2A') +
            info('Épreuve', e.epreuve ? EPREUVES[e.epreuve] : '', 'Th / TP / SY') +
            info('Durée', e.duree, '1H30 / 2H30 / 5H') +
            info('Barème', `……… / ${e.bareme ?? 40}`),
          LARGEUR_DROITE,
          false
        )
    )
  );

  // Toujours vides : le stagiaire les remplit sur sa copie.
  const candidat = ligne(
    run('Nom et prénom : ', { gras: true, taille: 24 }) +
      TAB +
      run('  Groupe : ', { gras: true, taille: 24 }) +
      TAB +
      run('  V : ', { gras: true, taille: 24 }) +
      TAB,
    [
      [6650, 'left', true],
      [9650, 'left', true],
      [LARGEUR, 'right', true],
    ],
    { apres: 0 }
  );
  // Un filet sous la ligne du candidat : le sujet commence dessous.
  const filet =
    '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="000000"/></w:pBdr>' +
    '<w:spacing w:before="0" w:after="240"/></w:pPr></w:p>';

  return direction + cadreTitre + ESPACE(240) + informations + ESPACE(160) + candidat + filet;
}

/**
 * Le document Word : le canevas de la fiche de réclamation, son en-tête de page gardé (sans
 * CFP / EFP, élargi), son corps remplacé par l'en-tête de l'épreuve — et un paragraphe vide où
 * écrire.
 *
 * @param {object} e — voir `corps`, plus `efp` : le nom abrégé de l'établissement
 * @returns {Promise<Buffer>}
 */
export async function construireDocxEnteteExamen(e) {
  const zip = await JSZip.loadAsync(await readFile(CANEVAS_ENTETE));

  const xml = await zip.file('word/document.xml').async('string');
  const debutCorps = xml.indexOf('<w:body>') + '<w:body>'.length;
  const debutSectPr = xml.lastIndexOf('<w:sectPr');
  if (debutSectPr <= debutCorps) throw new Error('Canevas Word illisible : la mise en page (sectPr) est absente');
  // Les marges du canevas original : 1 cm à gauche et à droite ; 0,6 cm en haut, en-tête compris.
  const miseEnPage = xml
    .slice(debutSectPr)
    .replace(/(<w:pgMar[^>]*\sw:top=")\d+"/, `$1${MARGE_HAUT}"`)
    .replace(/(<w:pgMar[^>]*\sw:header=")\d+"/, `$1${MARGE_HAUT}"`)
    .replace(/(<w:pgMar[^>]*\sw:right=")\d+"/, `$1${MARGE}"`)
    .replace(/(<w:pgMar[^>]*\sw:left=")\d+"/, `$1${MARGE}"`)
    /*
     * ═══ ⚠️ PLUS D'EN-TÊTE DE PAGE (2026-10-27, demande du porteur : « annule cette partie
     *     depuis l'en-tête du Word, pas du document, pour ne pas la dupliquer sur une autre
     *     page ») ═══ Le bloc OFPPT (logo, « مكتب التكوين المهني… », « Office de la
     *     Formation… ») passe en tête du CORPS, sur la seule première page : la section ne
     *     référence plus d'en-tête.
     */
    .replace(/<w:headerReference\b[^>]*\/>/g, '');

  /*
   * L'en-tête du canevas : « CFP : … » et « EFP : … » retirés — l'établissement est écrit sous la
   * Direction Régionale —, et son tableau (logo, titres) élargi à la largeur du document.
   */
  const ajout = LARGEUR - LARGEUR_ENTETE;
  const entete = (await zip.file('word/header1.xml').async('string'))
    .replace(/<w:p\b(?:(?!<\/w:p>).)*?>(?:CFP|EFP) :<\/w:t>(?:(?!<\/w:p>).)*<\/w:p>/gs, '')
    .replace(`<w:tblW w:w="${LARGEUR_ENTETE}"`, `<w:tblW w:w="${LARGEUR}"`)
    .replaceAll(`w:w="${TITRES_ENTETE}"`, `w:w="${TITRES_ENTETE + ajout}"`);
  /*
   * Les paragraphes vides sous le tableau de l'en-tête — la place de « CFP / EFP » — écartaient
   * la Direction Régionale du logo (2026-10-26). Word en exige un après un tableau : un seul,
   * d'un point.
   */
  const finTableau = entete.lastIndexOf('</w:tbl>') + '</w:tbl>'.length;
  // Les titres centrés sur la page (2026-10-26) — voir `centrerTitresEntete`.
  const enteteCentre = centrerTitresEntete(entete.slice(0, finTableau));
  const tableauEntete = enteteCentre.slice(enteteCentre.indexOf('<w:tbl>'));

  /*
   * ⚠️ L'IMAGE DU LOGO SUIT LE TABLEAU : dans l'en-tête, son `r:embed` désignait une relation
   *    de `header1.xml.rels`. Déplacée dans le corps, elle doit en avoir une dans
   *    `document.xml.rels` — sous un identifiant NEUF, car celui de l'en-tête (« rId1 ») y
   *    désigne déjà autre chose.
   */
  const relationsEntete = (await zip.file('word/_rels/header1.xml.rels')?.async('string')) ?? '';
  let relationsDocument = await zip.file('word/_rels/document.xml.rels').async('string');
  let tableauCorps = tableauEntete;
  for (const [, identifiant] of tableauEntete.matchAll(/r:embed="([^"]+)"/g)) {
    const relation = relationsEntete.match(new RegExp(`<Relationship\\b[^>]*Id="${identifiant}"[^>]*/>`))?.[0];
    if (!relation) continue;
    const neuf = `rIdEntete${identifiant.replace(/\W/g, '')}`;
    if (!relationsDocument.includes(`Id="${neuf}"`)) {
      relationsDocument = relationsDocument.replace(
        '</Relationships>',
        `${relation.replace(`Id="${identifiant}"`, `Id="${neuf}"`)}</Relationships>`
      );
    }
    tableauCorps = tableauCorps.replaceAll(`r:embed="${identifiant}"`, `r:embed="${neuf}"`);
  }
  zip.file('word/_rels/document.xml.rels', relationsDocument);

  const documentXml = xml.slice(0, debutCorps) + tableauCorps + corps(e) + '<w:p/>' + miseEnPage;
  // La numérotation « 1 / N » en bas de page, comme l'emploi du temps journalier (2026-10-27).
  zip.file('word/document.xml', await ajouterNumerotation(zip, documentXml));

  return zip.generateAsync({ type: 'nodebuffer' });
}
