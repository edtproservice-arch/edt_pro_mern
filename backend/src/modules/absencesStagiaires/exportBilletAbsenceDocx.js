import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { echapperXml } from '../seances/xmlCellules.js';
import { chargerCanevasTampon } from '../seances/canevasCache.js';
import { dateCourte, nomFichierBillets } from './exportBilletAbsenceTexte.js';

/**
 * Le billet d'excuse des absences et retards STAGIAIRES justifiés — GREFFÉ
 * dans le canevas transmis (2026-09-29, demande du porteur : « si une
 * absence ou retard est justifié afficher un billet d'absence »).
 *
 * ═══ COMMENT CE CANEVAS-CI EST FAIT ═══
 * UNE page A4, quatre billets identiques (Nom, Prénom, Filière, Groupe, une
 * case ABSENCE/RETARD à cocher, une Date, un « Visa GS » qui reste blanc, se
 * signe à la main) — pensée pour être imprimée puis DÉCOUPÉE. Un tableau de
 * mise en page les range 3 sur la première ligne, 1 sur la seconde.
 *
 * ═══ ⚠️ AUTANT DE CASES VISIBLES QUE DE BILLETS, PAS QUATRE TOUJOURS
 * (2026-09-29, demande du porteur : « il affiche 4 même si il y a deux
 * absences », puis « respecter la forme carré du billet », puis « en pdf
 * marche bien mais en word non ») ═══
 *
 * ⚠️⚠️ ON NE RETIRE NI LIGNE NI CASE DE LA GRILLE — on les VIDE. Une première
 * version retirait les cases en trop (`<w:gridAfter>`/`<w:wAfter>`, la
 * technique que le canevas utilise LUI-MÊME sur sa ligne à une case) : juste
 * en LibreOffice/PDF, mais Word, lui, réétalait quand même les cases
 * restantes sur toute la largeur — la forme carrée s'y perdait de nouveau,
 * cette fois SEULEMENT dans Word. Plutôt que deux moteurs à satisfaire à la
 * fois, la grille garde EXACTEMENT sa forme d'origine (mêmes lignes, mêmes
 * cases, mêmes largeurs) : une case sans billet est VIDÉE (bordure en
 * pointillés retirée, logo et champs effacés) au lieu d'être retirée — elle
 * n'affiche donc plus rien, sans qu'aucun moteur n'ait à recalculer une
 * largeur.
 *
 * ⚠️ QUATRE BILLETS PAR PAGE, comme le canevas les range déjà — un cinquième
 * ouvre une SECONDE page, sur le même gabarit, plutôt qu'un fichier par
 * billet : c'est le même geste qui doit tous les donner.
 *
 * ═══ ⚠️⚠️ CE CANEVAS IMBRIQUE DES TABLEAUX, CONTRAIREMENT À TOUS LES AUTRES
 * DE CE MODULE (2026-09-29, constaté ici même) ═══ `xmlTableaux.js` le dit en
 * tête : ses fonctions supposent des `<w:tbl>` JAMAIS imbriqués — vrai de
 * chaque canevas rencontré jusqu'ici. Celui-ci a un tableau de mise en page
 * dont CHAQUE case contient le tableau d'UN billet, qui contient lui-même un
 * troisième tableau pour le logo. `extraireTableaux`/`extraireLignes` y
 * verraient le MAUVAIS tableau se refermer (celui du logo, pas celui du
 * billet, ni celui de mise en page) et tronqueraient tout ce qui suit.
 *
 * On retrouve donc la structure à la main, par PROFONDEUR D'IMBRICATION
 * (`tablesDeNiveauSuperieur`/`lignesDeNiveauSuperieur`/`cellulesDeNiveauSuperieur`
 * ci-dessous), et chaque champ d'UN billet se repère par la POSITION de son
 * `<w:t>` DANS SA PROPRE CASE — dix-huit `<w:t>`, toujours dans le même ordre.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHEMIN_CANEVAS = path.join(__dirname, 'canevas', 'billetAbsence.docx');

const BILLETS_PAR_PAGE = 4;

const SAUT_DE_PAGE = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

const TEXTES_PAR_RUN = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;

/** Remplace le texte du `<w:t>` d'INDICE `index` (0-based) dans le fragment XML donné. */
function remplacerTexteParIndex(xml, index, texte) {
  let compteur = -1;
  return xml.replace(TEXTES_PAR_RUN, (correspondance) => {
    compteur += 1;
    if (compteur !== index) return correspondance;
    return `<w:t xml:space="preserve">${echapperXml(texte)}</w:t>`;
  });
}

/** Les indices, DANS LES 18 `<w:t>` D'UNE SEULE CASE, de chaque champ. */
const RUN = {
  NOM: 3,
  PRENOM: 5,
  FILIERE: 7,
  GROUPE: 9,
  CASE_ABSENCE: 10,
  CASE_RETARD: 12,
  DATE: 15,
};

/** Les `<w:tbl>` ENFANTS DIRECTS de ce fragment — jamais ceux d'un tableau imbriqué dans l'un d'eux. */
function tablesDeNiveauSuperieur(xml) {
  const tables = [];
  const re = /<w:tbl>|<\/w:tbl>/g;
  let correspondance;
  let profondeur = 0;
  let debut = -1;
  while ((correspondance = re.exec(xml))) {
    if (correspondance[0] === '<w:tbl>') {
      if (profondeur === 0) debut = correspondance.index;
      profondeur += 1;
    } else {
      profondeur -= 1;
      if (profondeur === 0) tables.push({ debut, fin: correspondance.index + correspondance[0].length });
    }
  }
  return tables;
}

/** Les `<w:tr>` ENFANTS DIRECTS de ce tableau — jamais ceux d'un tableau imbriqué dans une de ses cases. */
function lignesDeNiveauSuperieur(xmlTableau) {
  const lignes = [];
  const re = /<w:tbl>|<\/w:tbl>|<w:tr\b[^>]*>|<\/w:tr>/g;
  let correspondance;
  let profondeurTableau = 0;
  let profondeurLigne = 0;
  let debut = -1;
  while ((correspondance = re.exec(xmlTableau))) {
    const jeton = correspondance[0];
    if (jeton === '<w:tbl>') profondeurTableau += 1;
    else if (jeton === '</w:tbl>') profondeurTableau -= 1;
    else if (jeton.startsWith('<w:tr')) {
      if (profondeurTableau === 1 && profondeurLigne === 0) debut = correspondance.index;
      profondeurLigne += 1;
    } else {
      profondeurLigne -= 1;
      if (profondeurTableau === 1 && profondeurLigne === 0) {
        lignes.push({ debut, fin: correspondance.index + jeton.length });
      }
    }
  }
  return lignes;
}

/** Les `<w:tc>` ENFANTS DIRECTS de cette ligne — jamais ceux d'un tableau imbriqué dans l'une d'elles. */
function cellulesDeNiveauSuperieur(xmlLigne) {
  const cellules = [];
  const re = /<w:tbl>|<\/w:tbl>|<w:tc>|<\/w:tc>/g;
  let correspondance;
  let profondeurTableau = 0;
  let profondeurCellule = 0;
  let debut = -1;
  while ((correspondance = re.exec(xmlLigne))) {
    const jeton = correspondance[0];
    if (jeton === '<w:tbl>') profondeurTableau += 1;
    else if (jeton === '</w:tbl>') profondeurTableau -= 1;
    else if (jeton === '<w:tc>') {
      if (profondeurTableau === 0 && profondeurCellule === 0) debut = correspondance.index;
      profondeurCellule += 1;
    } else {
      profondeurCellule -= 1;
      if (profondeurTableau === 0 && profondeurCellule === 0) {
        cellules.push({ debut, fin: correspondance.index + jeton.length });
      }
    }
  }
  return cellules;
}

/**
 * Remplit LES 18 `<w:t>` d'une case de billet avec les champs d'UN stagiaire.
 * ⚠️ Un billet VIERGE garde la case du canevas telle quelle — ses pointillés
 * sont précisément ce qu'on remplit à la main.
 */
function remplirCase(xmlCase, billet) {
  if (billet.vierge) return xmlCase;
  let xml = xmlCase;
  xml = remplacerTexteParIndex(xml, RUN.NOM, billet.nom);
  xml = remplacerTexteParIndex(xml, RUN.PRENOM, billet.prenom);
  xml = remplacerTexteParIndex(xml, RUN.FILIERE, billet.filiere);
  xml = remplacerTexteParIndex(xml, RUN.GROUPE, billet.groupe);
  xml = remplacerTexteParIndex(xml, RUN.DATE, dateCourte(billet.date));
  if (billet.type === 'retard') {
    xml = remplacerTexteParIndex(xml, RUN.CASE_RETARD, '      ☑ ');
  } else {
    xml = remplacerTexteParIndex(xml, RUN.CASE_ABSENCE, '☑ ');
  }
  return xml;
}

/*
 * ⚠️ UNE BORDURE BLANCHE, PAS « AUCUNE BORDURE » (2026-09-29, constaté ici
 * même : « val="none" » retire bien le trait dans LibreOffice, mais Word
 * continue d'en tracer un — sans doute hérité des `tblBorders` du tableau de
 * mise en page EXTÉRIEUR, `insideH`/`insideV` compris) — peindre le trait en
 * BLANC plutôt que de tenter de l'effacer se moque de qui hérite de quoi :
 * une bordure blanche sur une page blanche ne se voit pas, dans aucun moteur.
 *
 * ⚠️⚠️ MAIS PAS SUR LES QUATRE CÔTÉS TOUJOURS (2026-09-29, demande du
 * porteur : « ajouter les bordures dashed pour compléter le billet ») — une
 * case vidée qui touche encore un billet GARDÉ partage sa bordure AVEC lui :
 * la repeindre en blanc de CE côté-là efface aussi le pointillé du billet
 * voisin sur cette même arête (Word et LibreOffice résolvent une bordure
 * partagée en un seul trait, pas deux superposés). Seuls les côtés qui NE
 * touchent AUCUN billet gardé sont repeints ; celui qui en touche un reste
 * pointillé, comme le canevas transmis.
 */
function coteBordureInvisible(cote) {
  return `<w:${cote} w:val="single" w:sz="4" w:space="0" w:color="FFFFFF"/>`;
}

/**
 * Vide une case SANS BILLET : les côtés de sa bordure passés dans
 * `cotesAEffacer` disparaissent (repeints en blanc, voir la note ci-dessus —
 * jamais ceux qui touchent encore un billet gardé), et tout son contenu
 * (logo, titre, champs) avec — elle garde sa place et sa largeur dans la
 * grille (voir la note en tête de fichier), mais n'affiche plus rien, dans
 * Word comme dans LibreOffice.
 */
function viderCase(xmlCase, cotesAEffacer) {
  const finTcPr = xmlCase.indexOf('</w:tcPr>');
  if (finTcPr === -1) return xmlCase;
  let tcPr = xmlCase.slice(0, finTcPr + '</w:tcPr>'.length);

  const bordureExistante = tcPr.match(/<w:tcBorders>([\s\S]*?)<\/w:tcBorders>/);
  let interieurBordure = bordureExistante ? bordureExistante[1] : '';
  cotesAEffacer.forEach((cote) => {
    const re = new RegExp(`<w:${cote}\\b[^/]*/>`);
    interieurBordure = re.test(interieurBordure)
      ? interieurBordure.replace(re, coteBordureInvisible(cote))
      : interieurBordure + coteBordureInvisible(cote);
  });
  const nouvelleBordure = `<w:tcBorders>${interieurBordure}</w:tcBorders>`;
  tcPr = bordureExistante
    ? tcPr.replace(bordureExistante[0], nouvelleBordure)
    : tcPr.replace('<w:tcPr>', `<w:tcPr>${nouvelleBordure}`);

  return `${tcPr}<w:p/></w:tc>`;
}

/**
 * Quels côtés d'une case VIDÉE touchent ENCORE un billet gardé, dans cette
 * grille fixe à quatre cases (trois en haut, une en bas sous la première) —
 * ce côté-là doit rester pointillé plutôt que d'être repeint en blanc. Les
 * billets se remplissent toujours dans l'ordre (0, 1, 2, 3), donc une case
 * vidée n'a jamais de billet gardé à sa DROITE ou en DESSOUS — seulement,
 * selon le nombre de billets, à sa GAUCHE (cases 1 et 2) ou au-dessus
 * (case 3, sous la case 0). ⚠️ Pas un « toujours » : la case 2 vidée n'a sa
 * voisine de gauche (case 1) GARDÉE que s'il y a EXACTEMENT deux billets —
 * avec un seul, les deux sont vidées, et leur arête commune doit rester
 * blanche des deux côtés, pas pointillée dans le vide.
 */
function coteAGarderPointille(position, nbBillets, cote) {
  if (position === 1 && cote === 'left') return nbBillets === 1;
  if (position === 2 && cote === 'left') return nbBillets === 2;
  if (position === 3 && cote === 'top') return true;
  return false;
}

/** Une page : la grille du gabarit, INCHANGÉE — seules ses cases sans billet sont vidées. */
function construirePage(gabaritPage, billetsDeCettePage) {
  const [tableExterieure] = tablesDeNiveauSuperieur(gabaritPage);
  if (!tableExterieure) throw new Error('Canevas Word illisible : la grille des billets est absente');

  const contenuTable = gabaritPage.slice(tableExterieure.debut, tableExterieure.fin);
  const lignes = lignesDeNiveauSuperieur(contenuTable);
  if (lignes.length === 0) throw new Error('Canevas Word illisible : aucune ligne dans la grille des billets');

  const preambuleTable = contenuTable.slice(0, lignes[0].debut);

  const structureLignes = lignes.map((ligne) => {
    const texteLigne = contenuTable.slice(ligne.debut, ligne.fin);
    const cellules = cellulesDeNiveauSuperieur(texteLigne);
    const avantPremiereCellule = cellules.length > 0 ? texteLigne.slice(0, cellules[0].debut) : texteLigne;
    const xmlCellules = cellules.map((c) => texteLigne.slice(c.debut, c.fin));
    return { avantPremiereCellule, xmlCellules };
  });

  const casesDisponibles = structureLignes.flatMap((l) => l.xmlCellules);
  if (casesDisponibles.length !== BILLETS_PAR_PAGE) {
    throw new Error('Canevas Word illisible : quatre cases de billet attendues par page');
  }

  const nbBillets = billetsDeCettePage.length;
  const casesFinales = casesDisponibles.map((xmlCase, position) => {
    if (position < nbBillets) return remplirCase(xmlCase, billetsDeCettePage[position]);
    const cotesAEffacer = ['top', 'left', 'bottom', 'right'].filter(
      (cote) => !coteAGarderPointille(position, nbBillets, cote)
    );
    return viderCase(xmlCase, cotesAEffacer);
  });

  let curseur = 0;
  const nouvellesLignes = structureLignes.map(({ avantPremiereCellule, xmlCellules }) => {
    const casesDeCetteLigne = casesFinales.slice(curseur, curseur + xmlCellules.length);
    curseur += xmlCellules.length;
    return `${avantPremiereCellule}${casesDeCetteLigne.join('')}</w:tr>`;
  });

  const nouvelleTable = `${preambuleTable}${nouvellesLignes.join('')}</w:tbl>`;
  return gabaritPage.slice(0, tableExterieure.debut) + nouvelleTable + gabaritPage.slice(tableExterieure.fin);
}

/**
 * ═══ LA PAGE DE BILLETS VIERGES : PLEINE, PAS QUATRE ═══ (2026-10-01, demande
 * du porteur : « il met seulement 4 billets même s'il y a la possibilité de
 * plus ».) La première rangée du canevas — trois billets, déjà à la bonne
 * largeur — est répétée `RANGEES_VIERGES` fois : la même grille, plus haute.
 *
 * ⚠️ CINQ RANGÉES, ET C'EST MESURÉ : une rangée fait ~52 mm, la page en offre
 * ~279 entre ses marges de 500 twips. Une sixième passerait sur une seconde
 * page — `cantSplit` la déplace entière plutôt que de la couper.
 */
const RANGEES_VIERGES = 5;
export const BILLETS_VIERGES_PAR_PAGE = RANGEES_VIERGES * 3;

function construirePageVierge(gabaritPage) {
  const [tableExterieure] = tablesDeNiveauSuperieur(gabaritPage);
  if (!tableExterieure) throw new Error('Canevas Word illisible : la grille des billets est absente');

  const contenuTable = gabaritPage.slice(tableExterieure.debut, tableExterieure.fin);
  const [premiereLigne] = lignesDeNiveauSuperieur(contenuTable);
  if (!premiereLigne) throw new Error('Canevas Word illisible : aucune ligne dans la grille des billets');

  const preambuleTable = contenuTable.slice(0, premiereLigne.debut);
  const rangee = contenuTable.slice(premiereLigne.debut, premiereLigne.fin);
  const nouvelleTable = `${preambuleTable}${rangee.repeat(RANGEES_VIERGES)}</w:tbl>`;
  return gabaritPage.slice(0, tableExterieure.debut) + nouvelleTable + gabaritPage.slice(tableExterieure.fin);
}

export async function construireDocxBilletsAbsence(donnees) {
  const { anneeScolaire, billets } = donnees;

  const tampon = await chargerCanevasTampon(CHEMIN_CANEVAS);
  const zip = await JSZip.loadAsync(tampon);

  const fichierDocument = zip.file('word/document.xml');
  if (!fichierDocument) throw new Error('Canevas Word illisible : document.xml absent du modèle');

  const xmlDocument = await fichierDocument.async('string');
  const debutCorps = xmlDocument.indexOf('<w:body>') + '<w:body>'.length;
  const debutSectPr = xmlDocument.lastIndexOf('<w:sectPr');
  if (debutSectPr <= debutCorps) throw new Error('Canevas Word illisible : la mise en page (sectPr) est absente');

  let gabaritPage = xmlDocument.slice(debutCorps, debutSectPr);
  // ⚠️ `.replaceAll()` : toutes les cases REMPLIES d'une page portent l'année.
  gabaritPage = gabaritPage.replaceAll('2026-2027', `${anneeScolaire}-${anneeScolaire + 1}`);

  const pages = [];
  if (billets.length > 0 && billets.every((billet) => billet.vierge)) {
    pages.push(construirePageVierge(gabaritPage));
  } else {
    for (let debut = 0; debut < billets.length; debut += BILLETS_PAR_PAGE) {
      pages.push(construirePage(gabaritPage, billets.slice(debut, debut + BILLETS_PAR_PAGE)));
    }
  }
  const corpsFinal = pages.join(SAUT_DE_PAGE);

  const xmlFinal = xmlDocument.slice(0, debutCorps) + corpsFinal + xmlDocument.slice(debutSectPr);
  zip.file('word/document.xml', xmlFinal);

  const tamponFinal = await zip.generateAsync({ type: 'nodebuffer' });

  return {
    tampon: tamponFinal,
    nomFichier: nomFichierBillets(billets, 'docx'),
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}
