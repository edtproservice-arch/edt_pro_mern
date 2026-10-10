import JSZip from 'jszip';
import { CHEMIN_CANEVAS_AFFECTATION } from '../base/exportAffectationFormateurDocx.js';
import { chargerCanevasTampon } from '../seances/canevasCache.js';
import { echapperXml } from '../seances/xmlCellules.js';
import { remplacerBalise } from '../seances/xmlTableaux.js';
import { dateFr, nomFichierPeriodes } from './exportPeriodesTexte.js';
import { BADGE_FERIE, BADGE_VACANCES, TEINTES_GANTT, TEINTE_VACANCES, TEXTE_VACANCES } from './exportPeriodesGantt.js';

/**
 * Le Word des périodes de stage / de formation.
 *
 * ═══ L'EN-TÊTE DU CANEVAS D'AFFECTATION, UN CORPS ÉCRIT ICI ═══ Aucun canevas
 * n'a été transmis pour ce document. Plutôt que d'en inventer un autre en-tête,
 * on reprend celui de `affectationFormateur.docx` — logo OFPPT, titre et nom de
 * l'établissement, la page A4 et ses marges — et l'on remplace son CORPS par le
 * tableau des périodes. Les documents de l'établissement gardent ainsi une
 * seule allure.
 *
 * ⚠️ LE `<w:sectPr>` FINAL EST CONSERVÉ : c'est lui qui rattache l'en-tête
 * (`headerReference`) et fixe la page. Le jeter donnerait un document sans logo.
 */

/** Les textes de l'exemplaire, remplacés tels quels (voir `exportAffectationFormateurDocx.js`). */
const EXEMPLE = {
  titre: 'Affectation Annuelle Formateur',
  etablissement: 'INSTITUT SPECIALISE DE TECHNOLOGIE APPLIQUEE SIDI HAJJAJ OUED HASSAR',
};

// Largeur utile de la page du canevas : 11906 − 2 × 850 twips.
const LARGEURS = [2700, 1800, 1900, 1900, 1906];
const GRIS = 'F2F2F2';

const POLICE = '<w:rFonts w:ascii="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>';

function run(texte, { gras = false, taille = 20, couleur } = {}) {
  return (
    `<w:r><w:rPr>${POLICE}${gras ? '<w:b/><w:bCs/>' : ''}${couleur ? `<w:color w:val="${couleur}"/>` : ''}` +
    `<w:sz w:val="${taille}"/><w:szCs w:val="${taille}"/></w:rPr>` +
    `<w:t xml:space="preserve">${echapperXml(texte)}</w:t></w:r>`
  );
}

function paragraphe(texte, { gras, taille, centre = false, avant = 0, apres = 120 } = {}) {
  return (
    `<w:p><w:pPr><w:spacing w:before="${avant}" w:after="${apres}"/>${centre ? '<w:jc w:val="center"/>' : ''}</w:pPr>` +
    `${texte ? run(texte, { gras, taille }) : ''}</w:p>`
  );
}

function cellule(texte, largeur, { gras = false, fond, fusion, centre = true } = {}) {
  const proprietes =
    `<w:tcW w:w="${largeur}" w:type="dxa"/>` +
    (fusion ? `<w:vMerge${fusion === 'debut' ? ' w:val="restart"' : ''}/>` : '') +
    (fond ? `<w:shd w:val="clear" w:color="auto" w:fill="${fond}"/>` : '') +
    '<w:vAlign w:val="center"/>';
  return (
    `<w:tc><w:tcPr>${proprietes}</w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/>${centre ? '<w:jc w:val="center"/>' : ''}</w:pPr>` +
    `${texte === '' ? '' : run(texte, { gras })}</w:p></w:tc>`
  );
}

// ⚠️ `tblHeader` : l'en-tête du tableau se répète en haut de chaque page.
const ligne = (cellules, { entete = false } = {}) =>
  `<w:tr><w:trPr><w:cantSplit/>${entete ? '<w:tblHeader/>' : ''}</w:trPr>${cellules.join('')}</w:tr>`;

function tableau({ libelles, sujets, totalPeriodes, totalJours }) {
  const bord = '<w:{c} w:val="single" w:sz="4" w:space="0" w:color="auto"/>';
  const bordures = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((c) => bord.replace('{c}', c)).join('');

  const entete = ligne(
    [libelles.colonneSujet, libelles.colonneDetail, 'Du', 'Au', 'Jours'].map((texte, i) =>
      cellule(texte, LARGEURS[i], { gras: true, fond: GRIS })
    ),
    { entete: true }
  );

  /*
   * ⚠️ FUSION VERTICALE (`vMerge`) DU SUJET ET DE SON DÉTAIL : une ligne par
   * période, mais le groupe n'est lu qu'une fois — c'est ce que la liste de
   * l'écran montre (une ligne par groupe). La cellule « continue » doit exister
   * quand même, vide : Word compte les colonnes ligne par ligne.
   */
  const corps = sujets.flatMap((sujet) =>
    sujet.periodes.map((periode, rang) => {
      const fusion = sujet.periodes.length > 1 ? (rang === 0 ? 'debut' : 'suite') : undefined;
      return ligne([
        cellule(rang === 0 ? sujet.sujet : '', LARGEURS[0], { gras: true, fusion }),
        cellule(rang === 0 ? sujet.detail : '', LARGEURS[1], { fusion }),
        cellule(dateFr(periode.debut), LARGEURS[2]),
        cellule(dateFr(periode.fin), LARGEURS[3]),
        cellule(String(periode.jours), LARGEURS[4]),
      ]);
    })
  );

  const total = ligne([
    cellule(`Total : ${sujets.length} ${libelles.sujets}`, LARGEURS[0], { gras: true, fond: GRIS }),
    cellule('', LARGEURS[1], { fond: GRIS }),
    cellule(`${totalPeriodes} période(s)`, LARGEURS[2], { gras: true, fond: GRIS }),
    cellule('', LARGEURS[3], { fond: GRIS }),
    cellule(String(totalJours), LARGEURS[4], { gras: true, fond: GRIS }),
  ]);

  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${LARGEURS.reduce((a, b) => a + b, 0)}" w:type="dxa"/>` +
    `<w:tblBorders>${bordures}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid>${LARGEURS.map((l) => `<w:gridCol w:w="${l}"/>`).join('')}</w:tblGrid>` +
    `${entete}${corps.join('')}${total}</w:tbl>`
  );
}

/*
 * ═══ LE GANTT (mode calendrier, 2026-10-10) ═══ Page PAYSAGE : 46 semaines ne
 * tiennent pas en portrait. Largeur utile 16838 − 2 × 600 twips ; la colonne
 * des sujets prend 2000, chaque semaine le reste à parts égales.
 */
const PAYSAGE = { largeur: 16838, hauteur: 11906, marge: 600 };
const LARGEUR_SUJET_GANTT = 2000;

function celluleGantt(texte, largeur, { fond, span, fusion, gras = false, taille = 12, centre = true, couleur } = {}) {
  const proprietes =
    `<w:tcW w:w="${largeur}" w:type="dxa"/>` +
    (span ? `<w:gridSpan w:val="${span}"/>` : '') +
    (fusion ? `<w:vMerge${fusion === 'debut' ? ' w:val="restart"' : ''}/>` : '') +
    (fond ? `<w:shd w:val="clear" w:color="auto" w:fill="${fond}"/>` : '') +
    '<w:tcMar><w:left w:w="20" w:type="dxa"/><w:right w:w="20" w:type="dxa"/></w:tcMar>' +
    '<w:vAlign w:val="center"/>';
  return (
    `<w:tc><w:tcPr>${proprietes}</w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/>${centre ? '<w:jc w:val="center"/>' : ''}</w:pPr>` +
    `${texte ? run(texte, { gras, taille, couleur }) : ''}</w:p></w:tc>`
  );
}

const ligneGantt = (cellules, { entete = false, hauteur = 260 } = {}) =>
  `<w:tr><w:trPr><w:cantSplit/>${entete ? '<w:tblHeader/>' : ''}<w:trHeight w:val="${hauteur}"/></w:trPr>${cellules.join('')}</w:tr>`;

function tableauGantt({ gantt, libelles }) {
  const nombre = gantt.semaines.length;
  const utile = PAYSAGE.largeur - 2 * PAYSAGE.marge;
  const largeurSemaine = Math.floor((utile - LARGEUR_SUJET_GANTT) / nombre);
  const largeurs = [LARGEUR_SUJET_GANTT, ...Array(nombre).fill(largeurSemaine)];

  // Bordures NOIRES (2026-10-10, demande du porteur) — le gris s'effaçait à l'impression.
  const bord = '<w:{c} w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  const bordures = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((c) => bord.replace('{c}', c)).join('');

  // Vacances d'abord, période par-dessus : la case dit d'abord qui est absent.
  const fondDe = (rang, semaine) =>
    rang !== null ? TEINTES_GANTT[rang % TEINTES_GANTT.length] : gantt.semainesVacances[semaine] ? TEINTE_VACANCES : undefined;

  const ligneMois = ligneGantt(
    [
      celluleGantt(libelles.colonneSujet, LARGEUR_SUJET_GANTT, { gras: true, fond: GRIS, fusion: 'debut', taille: 16 }),
      ...gantt.mois.map((mois) =>
        celluleGantt(mois.libelle, largeurSemaine * mois.semaines, { span: mois.semaines, gras: true, fond: GRIS, taille: 14 })
      ),
    ],
    { entete: true }
  );
  const ligneSemaines = ligneGantt(
    [
      celluleGantt('', LARGEUR_SUJET_GANTT, { fond: GRIS, fusion: 'suite' }),
      ...gantt.semaines.map((semaine, rang) =>
        celluleGantt(semaine.numero ? String(semaine.numero) : '', largeurSemaine, {
          fond: gantt.semainesVacances[rang] ? TEINTE_VACANCES : GRIS,
          taille: 10,
        })
      ),
    ],
    { entete: true }
  );

  /*
   * Le badge « VAC » du chronogramme, sous le numéro des semaines de vacances
   * (2026-10-10, demande du porteur) — sa teinte : `bg-primary/20 text-primary`.
   * Ligne omise quand l'année n'a aucune vacance déclarée.
   */
  /* … et « N JF » sur une semaine qui porte des jours fériés (badge ambre du
     chronogramme). Une semaine de vacances garde VAC : c'est elle qui ferme. */
  const feriesParSemaine = gantt.feriesParSemaine ?? [];
  const ligneVacances = gantt.semainesVacances.some(Boolean) || feriesParSemaine.some(Boolean)
    ? ligneGantt(
        [
          celluleGantt('', LARGEUR_SUJET_GANTT, { fond: GRIS, fusion: 'suite' }),
          ...gantt.semainesVacances.map((vacances, rang) => {
            if (vacances) {
              return celluleGantt('VAC', largeurSemaine, { fond: BADGE_VACANCES, couleur: TEXTE_VACANCES, gras: true, taille: 8 });
            }
            if (feriesParSemaine[rang] > 0) {
              return celluleGantt(`${feriesParSemaine[rang]}JF`, largeurSemaine, { fond: BADGE_FERIE, gras: true, taille: 8 });
            }
            return celluleGantt('', largeurSemaine, { fond: GRIS });
          }),
        ],
        { entete: true, hauteur: 180 }
      )
    : '';

  const corps = gantt.lignes.map((ligne) =>
    ligneGantt([
      celluleGantt(ligne.sujet, LARGEUR_SUJET_GANTT, { gras: true, taille: 14, centre: false }),
      ...ligne.cases.map((rang, semaine) => celluleGantt('', largeurSemaine, { fond: fondDe(rang, semaine) })),
    ])
  );

  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${largeurs.reduce((a, b) => a + b, 0)}" w:type="dxa"/>` +
    `<w:tblBorders>${bordures}</w:tblBorders><w:tblLayout w:type="fixed"/>` +
    '<w:tblCellMar><w:left w:w="20" w:type="dxa"/><w:right w:w="20" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${largeurs.map((l) => `<w:gridCol w:w="${l}"/>`).join('')}</w:tblGrid>` +
    `${ligneMois}${ligneSemaines}${ligneVacances}${corps.join('')}</w:tbl>`
  );
}

/** La légende des teintes, en une ligne de petites cases colorées. */
function legendeGantt() {
  const entrees = [
    ...['1re période', '2e période', '3e période', '4e période'].map((texte, rang) => [TEINTES_GANTT[rang], texte]),
    [TEINTE_VACANCES, 'Vacances'],
    [BADGE_FERIE, 'Jour férié (JF)'],
  ];
  const cellules = entrees.flatMap(([fond, texte]) => [
    celluleGantt('', 240, { fond }),
    celluleGantt(texte, 1500, { taille: 14, centre: false }),
  ]);
  const largeurs = entrees.flatMap(() => [240, 1500]);
  const sansBord = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((c) => `<w:${c} w:val="nil"/>`)
    .join('');
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${largeurs.reduce((a, b) => a + b, 0)}" w:type="dxa"/>` +
    `<w:tblBorders>${sansBord}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid>${largeurs.map((l) => `<w:gridCol w:w="${l}"/>`).join('')}</w:tblGrid>` +
    `${ligneGantt(cellules, { hauteur: 240 })}</w:tbl>`
  );
}

/** La section du canevas passée en paysage — en-tête (logo) conservé. */
function enPaysage(sectPr) {
  return sectPr
    .replace(/<w:pgSz\b[^>]*\/>/, `<w:pgSz w:w="${PAYSAGE.largeur}" w:h="${PAYSAGE.hauteur}" w:orient="landscape"/>`)
    .replace(
      /<w:pgMar\b[^>]*\/>/,
      `<w:pgMar w:top="600" w:right="${PAYSAGE.marge}" w:bottom="600" w:left="${PAYSAGE.marge}" w:header="400" w:footer="400" w:gutter="0"/>`
    );
}

export async function construireDocxPeriodes(donnees) {
  const { type, libelles, etablissement, anneeScolaire } = donnees;

  const zip = await JSZip.loadAsync(await chargerCanevasTampon(CHEMIN_CANEVAS_AFFECTATION));
  const fichierDocument = zip.file('word/document.xml');
  const fichierEntete = zip.file('word/header1.xml');
  if (!fichierDocument || !fichierEntete) {
    throw new Error('Canevas Word illisible : document.xml ou header1.xml absent du modèle');
  }

  // ⚠️ Aptos → Calibri, pour la même raison que l'affectation : Aptos manque au serveur.
  let entete = (await fichierEntete.async('string')).replaceAll('Aptos', 'Calibri');
  entete = remplacerBalise(entete, EXEMPLE.titre, echapperXml(libelles.titre));
  entete = remplacerBalise(entete, EXEMPLE.etablissement, echapperXml(etablissement?.nom ?? ''));
  /* ⚠️ EN PAYSAGE, L'EN-TÊTE EST CENTRÉ : son tableau (logo + titre) garde la
     largeur portrait du canevas (10206 twips) et restait collé à gauche. */
  if (donnees.gantt) entete = entete.replace(/(<w:tblPr>\s*<w:tblW [^>]*\/>)/, '$1<w:jc w:val="center"/>');
  zip.file('word/header1.xml', entete);
  const fichierStyles = zip.file('word/styles.xml');
  if (fichierStyles) {
    zip.file('word/styles.xml', (await fichierStyles.async('string')).replaceAll('Aptos', 'Calibri'));
  }

  const xml = await fichierDocument.async('string');
  const debutCorps = xml.indexOf('<w:body>') + '<w:body>'.length;
  const debutSection = xml.lastIndexOf('<w:sectPr');
  if (debutCorps < '<w:body>'.length || debutSection < debutCorps) {
    throw new Error('Canevas Word illisible : corps ou section absents du modèle');
  }

  const aujourdhui = new Date().toLocaleDateString('fr-FR');
  const corps =
    (Number.isInteger(anneeScolaire)
      ? paragraphe(`Année de Formation : ${anneeScolaire}-${anneeScolaire + 1}`, {
          centre: true,
          avant: 220,
          apres: 200,
          taille: 18,
        })
      : '') +
    // (Le titre est déjà dans l'en-tête : le répéter ici le doublait.)
    /* En mode calendrier, LE GANTT SEUL (2026-10-10, demande du porteur : « en
       export laisser que gantt ») — le tableau des dates n'est plus repris. */
    (donnees.gantt ? tableauGantt(donnees) + paragraphe('', { apres: 60 }) + legendeGantt() : tableau(donnees)) +
    paragraphe(`Édité le ${aujourdhui}`, { taille: 16, avant: 200 }) +
    paragraphe('Directeur :', { gras: true, avant: 300 });

  const section = xml.slice(debutSection);
  zip.file(
    'word/document.xml',
    xml.slice(0, debutCorps) + corps + (donnees.gantt ? enPaysage(section) : section)
  );

  return {
    tampon: await zip.generateAsync({ type: 'nodebuffer' }),
    nomFichier: nomFichierPeriodes(type, anneeScolaire, 'docx'),
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}
