import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { echapperXml } from '../seances/xmlCellules.js';
import { chargerCanevasTampon } from '../seances/canevasCache.js';
import { convertirDocxEnPdf, prechaufferLibreOffice } from '../seances/libreOffice.js';
import { corpsBadgesNumeros } from './exportBadgesNumeros.js';

/**
 * Les feuilles de présence des stagiaires aux épreuves — GREFFÉES dans les
 * canevas transmis : l'EFF (2026-10-02, `Feuille_Presence_EFF_DEVOWFS201.docx`)
 * et le contrôle continu / EFM (2026-10-02, `Feuille_Presence_DEVOWFS201 (4).docx`).
 *
 * ═══ UN MÊME GABARIT, DEUX MODÈLES ═══
 * Les deux canevas ont la même forme : des tableaux SANS imbrication dans le
 * corps — un tableau d'en-tête (établissement, filière, groupe…) et la liste
 * des stagiaires, en-tête répété (`tblHeader`) puis une ligne par stagiaire.
 * Le titre et l'année sont dans l'EN-TÊTE de page, le tableau des surveillants
 * dans le PIED : tous deux se répètent seuls sur chaque page. `MODELES` dit,
 * pour chacun, QUEL tableau et QUELLES cases recevoir — le reste (épreuve,
 * date, heures, session, cases CC / EFM / Local / Régional) se remplit à la
 * main le jour de l'épreuve.
 *
 * ⚠️ UNE LIGNE PAR STAGIAIRE, ET AUCUNE LIGNE VIDE (2026-10-02, demande du
 * porteur : « si la ligne est vide ne l'affiche pas ») — les canevas
 * complétaient jusqu'à 25 lignes. Au-delà d'une page, la liste continue sur la
 * suivante, en-tête répété.
 *
 * ⚠️ UNE PAGE PAR GROUPE, dans le même fichier — comme la feuille d'absence.
 *
 * ⚠️ TROIS RETOUCHES DES CANEVAS TRANSMIS, faites UNE FOIS dans les copies de
 * `canevas/` (2026-10-02, demandes du porteur) :
 *   - le logo est celui des autres canevas, avec ombre ;
 *   - Calibri au lieu d'Aptos, que LibreOffice ne connaît pas et remplaçait
 *     par une police plus grasse — le PDF sortait « en gras » ;
 *   - le logo est EN LIGNE dans sa cellule (il flottait, décalé de -0,37 cm) :
 *     la cellule centrée verticalement l'aligne enfin sur le titre.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const canevas = (nom) => path.join(__dirname, 'canevas', nom);

/**
 * `entete` : [ligne, case, champ] — le champ de la feuille écrit dans cette
 * case du tableau d'en-tête. `ligne` : les champs écrits, case après case,
 * dans la ligne d'un stagiaire.
 */
export const MODELES = {
  eff: {
    chemin: canevas('feuillePresenceEff.docx'),
    nomFichier: 'Presence_EFF',
    tableEntete: 1,
    entete: [
      [1, 0, 'efp'],
      [1, 1, 'filiere'],
      [1, 2, 'numero'],
    ],
    tableListe: 3,
    ligne: (s) => [s.matricule, `${s.nom} ${s.prenom}`.trim()],
  },
  'cc-efm': {
    chemin: canevas('feuillePresenceCcEfm.docx'),
    nomFichier: 'Presence_CC_EFM',
    tableEntete: 0,
    entete: [
      [0, 1, 'efp'],
      [0, 3, 'filiere'],
      [1, 3, 'numero'],
    ],
    tableListe: 2,
    ligne: (s, index) => [String(index + 1), s.matricule, s.nom, s.prenom],
  },
  /* La liste des stagiaires d'un groupe (2026-10-02, `Liste_Stagiaires_DEVOWFS201.docx`) :
     même gabarit, l'en-tête porte le niveau et l'effectif, et le GROUPE ENTIER. */
  liste: {
    chemin: canevas('listeStagiaires.docx'),
    nomFichier: 'Liste_Stagiaires',
    tableEntete: 0,
    entete: [
      [0, 1, 'efp'],
      [0, 3, 'niveau'],
      [1, 1, 'groupe'],
      [1, 3, 'effectif'],
    ],
    tableListe: 1,
    ligne: (s, index) => [String(index + 1), s.matricule, s.nom, s.prenom],
  },
  /* Les badges de numéros de table sans informations (2026-10-02) : une grille
     de badges à découper, pas un en-tête suivi d'une liste — `construireCorps`
     remplace la page type, voir `exportBadgesNumeros.js`. */
  'badges-sans': {
    chemin: canevas('badgesNumerosSansInfos.docx'),
    nomFichier: 'Badges_Numeros',
    construireCorps: corpsBadgesNumeros(['numero', 'efp']),
  },
  /* La liste des stagiaires pour vérification (2026-10-02,
     `Liste_Verification_DEVOWFS201.docx`) : en paysage, le titre dans le CORPS,
     l'EFP et le groupe dans la même case que leur étiquette, puis CIN, noms
     arabes et date de naissance. La colonne Observation reste à la main. */
  verification: {
    chemin: canevas('listeVerification.docx'),
    nomFichier: 'Liste_Verification',
    remplacements: { 'CFP MGD HASSANIA': 'efp', DEVOWFS201: 'groupe' },
    tableListe: 2,
    ligne: (s, index) => [
      String(index + 1),
      s.matricule,
      s.cin,
      s.nom,
      s.prenom,
      s.prenomArabe,
      s.nomArabe,
      s.dateNaissance,
    ],
  },
  /* Le retrait définitif de l'attestation du bac (2026-10-02,
     `Retrait_Définitif_du_Bac.docx`) : un formulaire par stagiaire. L'identité
     est remplie ; le bac (type, année, spécialité, série) et le motif ne sont
     pas dans Konosys et restent en pointillés.
     ⚠️ L'EN-TÊTE ET LE PIED VENAIENT DU CF MEDIOUNA : le nom de l'établissement
     les remplace ; son adresse et ses téléphones sont retirés — la fiche
     établissement n'en porte pas, et ceux d'un autre centre seraient faux. */
  'retrait-definitif': modeleRetraitBac('retraitDefinitifBac.docx', 'Retrait_Definitif_Bac'),
  /* Le retrait PROVISOIRE (2026-10-02, `Retrait_Provisoire_Bac (1).docx`) : le
     même formulaire et le même en-tête du CF Mediouna ; « À rendre le » et
     « Rendu le » se remplissent à la main. */
  'retrait-provisoire': modeleRetraitBac('retraitProvisoireBac.docx', 'Retrait_Provisoire_Bac'),
  /* La check-list de vérification des diplômes (2026-10-02,
     `Checklist_Diplomes_DEVOWFS201.docx`) : UNE PAGE PAR STAGIAIRE — l'encadré
     d'identité est rempli, la vérification et les visas se font à la main. */
  checklist: {
    chemin: canevas('checklistDiplomes.docx'),
    nomFichier: 'Checklist_Diplomes',
    construireCorps: corpsParStagiaire({
      CS: 'region',
      'CFP MGD HASSANIA': 'efp',
      TS: 'niveau',
      'Développement Digital option Web Full Stack': 'filiereLibelle',
      DEVOWFS201: 'groupe',
      'ABBAOUI WALID': 'nomComplet',
      '2006113000155': 'matricule',
    }),
  },
  /* Les mêmes badges, AVEC les informations du stagiaire (2026-10-02). */
  'badges-infos': {
    chemin: canevas('badgesNumerosAvecInfos.docx'),
    nomFichier: 'Badges_Numeros_Table',
    construireCorps: corpsBadgesNumeros(['numero', 'efp', 'groupe', 'matricule', 'nom', 'prenom']),
  },
};

for (const { chemin } of Object.values(MODELES)) prechaufferLibreOffice(chemin);

const SAUT_DE_PAGE = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/**
 * Le corps d'un document à UNE PAGE PAR STAGIAIRE (la check-list des
 * diplômes) : la page du canevas recopiée pour chacun, ses textes d'exemple
 * remplacés par les siens. `remplacements` : le texte EXACT d'un `<w:t>` du
 * canevas → le champ qui le remplace (`nomComplet`, `matricule`, `region`…).
 */
/**
 * Les deux retraits du bac — définitif et provisoire — partagent formulaire,
 * en-tête et pied : seuls le canevas et le nom du fichier changent.
 * ⚠️ UNE DÉCLARATION DE FONCTION, hissée : `MODELES`, plus haut, l'appelle à son chargement.
 */
function modeleRetraitBac(fichier, nomFichier) {
  return {
    chemin: canevas(fichier),
    nomFichier,
    construireCorps: corpsFormulaire([
      [/^Noms\s*&\s*Prénoms/, (v) => `${v.nom} ${v.prenom}`],
      [/^Date\s*&\s*lieu\s*de\s*naissance/, (v) => [v.dateNaissance, v.lieuNaissance].filter(Boolean).join(' à ')],
      [/^N°\s*C\.N\.I\./, (v) => v.cin],
      [/^Filière\s*de\s*formation/, (v) => v.filiereLibelle],
      [/^CEF/, (v) => v.matricule],
    ]),
    remplacementsDocument: {
      // Le COMPLEXE, pas le nom abrégé (2026-10-02, demande du porteur).
      'CF MEDIOUNA CASABLANCA': 'complexe',
      'CENTRE DE FORMATION DANS LES MÉTIERS DE LA MÉTALLERIE SOUDURE': 'etablissement',
      'Direction Régionale Casa Settat Casablanca': 'directionRegionale',
      '50 Rue Caporal Driss Chbakou Aïn Bordja -': 'vide',
      '☎ 05 22 60 04 32   05 22 60.00 82': 'vide',
    },
  };
}

/** Où tombent les « : » des lignes du retrait du bac (twips, depuis la marge) — celle du canevas ouvert dans Word. */
const TAB_FORMULAIRE = 3440;

/**
 * ═══ ⚠️ TOUTES LES LIGNES « Libellé : … » SUR UNE MÊME TABULATION GAUCHE ═══
 * (2026-10-02, constaté par le porteur dans Word.) Le canevas place ses « : »
 * de deux façons : une tabulation DROITE que les pointillés remplissent sur
 * toute la largeur, et — pour « Motif du retrait » — des ESPACES. Les deux ne
 * tombent au même endroit que par la largeur des pointillés et des espaces, qui
 * n'est pas la même dans Word et dans LibreOffice : une ligne remplie, passée
 * en tabulation gauche, se décalait toujours dans l'un des deux. Toutes les
 * lignes, remplies ou non, passent donc sur la même tabulation gauche.
 */
function alignerLigneFormulaire(paragraphe, texte) {
  const gauche = `<w:tab w:val="left" w:pos="${TAB_FORMULAIRE}"/>`;
  if (/<w:tab w:val="right" w:pos="\d+"\/>/.test(paragraphe)) {
    return paragraphe.replace(/<w:tab w:val="right" w:pos="\d+"\/>/, gauche);
  }
  if (!/^Motif du retrait/.test(texte)) return paragraphe;
  // Les espaces qui poussaient le « : » disparaissent ; une tabulation les remplace.
  const avecTabulation = paragraphe
    .replace(/<w:t(?:\s[^>]*)?>\s+<\/w:t>/g, '<w:t></w:t>')
    .replace(/(<w:t(?:\s[^>]*)?>):(<\/w:t>)/, '<w:tab/>$1:$2');
  return /<w:tabs>/.test(avecTabulation)
    ? avecTabulation.replace('<w:tabs>', `<w:tabs>${gauche}`)
    : avecTabulation.replace(/<w:pPr>/, `<w:pPr><w:tabs>${gauche}</w:tabs>`);
}

/**
 * Le corps d'un FORMULAIRE à une page par stagiaire (le retrait du bac) : chaque
 * ligne « Libellé : ………… » dont le libellé correspond reçoit la valeur du
 * stagiaire à la place de ses pointillés. Une valeur vide garde les
 * pointillés : la ligne se remplit alors à la main.
 *
 * @param {Array<[RegExp, (valeurs) => string]>} champs — le libellé (sur le
 *   texte du paragraphe, runs réunis) et ce qu'on y écrit
 */
function corpsFormulaire(champs) {
  return (gabarit, feuilles, sautDePage) => {
    /*
     * ⚠️ DES POINTILLÉS DE MÊME LONGUEUR : maintenant qu'elles partent toutes de
     * la même tabulation, une ligne aux pointillés plus courts (« Motif du
     * retrait » du retrait provisoire) s'arrêtait avant les autres. Toutes
     * prennent la longueur de la plus longue.
     */
    const longueur = Math.max(0, ...[...gabarit.matchAll(/>:\s*(…+)<\/w:t>/g)].map((m) => m[1].length));
    const page = gabarit.replace(/(<w:t(?:\s[^>]*)?>):\s*…+(<\/w:t>)/g, `$1:  ${'…'.repeat(longueur)}$2`);
    return feuilles
      .flatMap((feuille) =>
        feuille.stagiaires.map((stagiaire) => {
          const valeurs = { ...feuille, ...stagiaire };
          return page.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphe) => {
            // ⚠️ LE TEXTE DU XML EST ÉCHAPPÉ : « Noms & Prénoms » y est « Noms &amp; Prénoms ».
            const texte = [...paragraphe.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
              .map((m) => m[1])
              .join('')
              .replaceAll('&amp;', '&');
            const aligne = alignerLigneFormulaire(paragraphe, texte);
            const champ = champs.find(([libelle]) => libelle.test(texte));
            const valeur = champ ? String(champ[1](valeurs) ?? '').trim() : '';
            if (!valeur) return aligne;
            // Le run des pointillés commence par « : » — lui seul change.
            return aligne.replace(
              /<w:t(?:\s[^>]*)?>:\s*…+<\/w:t>/,
              `<w:t xml:space="preserve">:  ${echapperXml(valeur)}</w:t>`
            );
          });
        })
      )
      .join(sautDePage);
  };
}

// ⚠️ UNE DÉCLARATION DE FONCTION, hissée : `MODELES`, plus haut, l'appelle à son chargement.
function corpsParStagiaire(remplacements) {
  return (gabarit, feuilles, sautDePage) =>
    feuilles
      .flatMap((feuille) =>
        feuille.stagiaires.map((stagiaire) => {
          const valeurs = { ...feuille, ...stagiaire, nomComplet: `${stagiaire.nom} ${stagiaire.prenom}`.trim() };
          return remplacerTextes(gabarit, remplacements, valeurs);
        })
      )
      .join(sautDePage);
}

const tables = (xml) => [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)];
const lignes = (xml) => [...xml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((m) => m[0]);

/**
 * Le texte d'une case : son premier `<w:t>` remplacé, les suivants vidés — la
 * mise en forme du canevas est gardée. Une case sans aucun `<w:t>` reçoit un
 * run dans son premier paragraphe.
 */
function ecrireCase(xmlCase, texte) {
  const run = `<w:t xml:space="preserve">${echapperXml(texte)}</w:t>`;
  let premier = true;
  const remplie = xmlCase.replace(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g, () => {
    if (!premier) return '<w:t></w:t>';
    premier = false;
    return run;
  });
  if (!premier) return remplie;
  return xmlCase.replace(/<w:p\b([^>]*?)\/>|<\/w:p>/, (balise, attributs) =>
    balise.startsWith('</') ? `<w:r>${run}</w:r></w:p>` : `<w:p${attributs}><w:r>${run}</w:r></w:p>`
  );
}

/** Une ligne dont les cases d'indice donné reçoivent leur texte (`{ indice: texte }`), les autres inchangées. */
function ecrireLigne(xmlLigne, textes) {
  let index = -1;
  return xmlLigne.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, (xmlCase) => {
    index += 1;
    return index in textes ? ecrireCase(xmlCase, textes[index]) : xmlCase;
  });
}

function remplacerTable(xml, index, nouvelle) {
  const table = tables(xml)[index];
  return xml.slice(0, table.index) + nouvelle + xml.slice(table.index + table[0].length);
}

function construirePage(gabarit, modele, feuille) {
  const toutes = tables(gabarit).map((m) => m[0]);
  const tableListe = toutes[modele.tableListe];
  if (!tableListe) throw new Error('Canevas Word illisible : la liste des stagiaires est absente');

  // L'en-tête, s'il est un tableau à cases : chaque champ dans sa case.
  let page = gabarit;
  if (modele.tableEntete !== undefined) {
    const tableEntete = toutes[modele.tableEntete];
    if (!tableEntete) throw new Error('Canevas Word illisible : le tableau d’en-tête est absent');
    let nouvelleEntete = tableEntete;
    lignes(tableEntete).forEach((xmlLigne, numeroLigne) => {
      const textes = Object.fromEntries(
        modele.entete.filter(([l]) => l === numeroLigne).map(([, c, champ]) => [c, feuille[champ] ?? ''])
      );
      if (Object.keys(textes).length > 0) nouvelleEntete = nouvelleEntete.replace(xmlLigne, ecrireLigne(xmlLigne, textes));
    });
    page = remplacerTable(page, modele.tableEntete, nouvelleEntete);
  }

  // L'en-tête, si l'étiquette et sa valeur partagent une case (« EFP : CFP MGD
  // HASSANIA ») : la valeur d'exemple du canevas, remplacée là où elle est.
  page = remplacerTextes(page, modele.remplacements ?? {}, feuille);

  // La liste : l'en-tête, puis une ligne par stagiaire — les lignes du canevas disparaissent.
  const lignesListe = lignes(tableListe);
  const [enTeteListe, ligneModele] = lignesListe;
  if (!ligneModele) throw new Error('Canevas Word illisible : ligne de stagiaire attendue');
  const derniere = lignesListe.at(-1);
  const debut = tableListe.indexOf(enTeteListe);
  const fin = tableListe.lastIndexOf(derniere) + derniere.length;
  const remplies = feuille.stagiaires.map((s, index) =>
    ecrireLigne(ligneModele, { ...modele.ligne(s, index) })
  );
  const nouvelleListe = tableListe.slice(0, debut) + enTeteListe + remplies.join('') + tableListe.slice(fin);

  // ⚠️ LA LISTE EN DERNIER : ses lignes sont réécrites, les textes d'exemple ne doivent plus y être cherchés.
  return remplacerTable(page, modele.tableListe, nouvelleListe);
}

/** Les `<w:t>` dont le texte est EXACTEMENT une clé de `remplacements`, réécrits avec le champ qu'elle désigne. */
function remplacerTextes(xml, remplacements, valeurs) {
  return xml.replace(/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g, (tout, ouverture, texte, fermeture) =>
    texte in remplacements
      ? `<w:t xml:space="preserve">${echapperXml(valeurs[remplacements[texte]] ?? '')}${fermeture}`
      : tout
  );
}

export async function construireDocxFeuillePresence(modele, { anneeScolaire, feuilles }) {
  const zip = await JSZip.loadAsync(await chargerCanevasTampon(modele.chemin));

  const xmlDocument = await zip.file('word/document.xml').async('string');
  const debutCorps = xmlDocument.indexOf('<w:body>') + '<w:body>'.length;
  const debutSectPr = xmlDocument.lastIndexOf('<w:sectPr');
  if (debutSectPr <= debutCorps) throw new Error('Canevas Word illisible : la mise en page (sectPr) est absente');

  // L'année des canevas, sous ses deux écritures (« 2026-2027 », « 2026/2027 »).
  const annee = (xml) =>
    xml
      .replaceAll('2026-2027', `${anneeScolaire}-${anneeScolaire + 1}`)
      .replaceAll('2026/2027', `${anneeScolaire}/${anneeScolaire + 1}`);

  // Dans le corps quand le titre n'est pas dans un en-tête de page (liste de vérification, retrait du bac).
  const gabarit = annee(xmlDocument.slice(debutCorps, debutSectPr));
  const corps = modele.construireCorps
    ? modele.construireCorps(gabarit, feuilles, SAUT_DE_PAGE)
    : feuilles.map((feuille) => construirePage(gabarit, modele, feuille)).join(SAUT_DE_PAGE);
  zip.file('word/document.xml', xmlDocument.slice(0, debutCorps) + corps + xmlDocument.slice(debutSectPr));

  // L'en-tête et le pied de page : l'année, et ce qui y désigne l'établissement (une valeur par document).
  for (const nom of Object.keys(zip.files).filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n))) {
    const xml = annee(await zip.file(nom).async('string'));
    zip.file(nom, remplacerTextes(xml, modele.remplacementsDocument ?? {}, { ...feuilles[0], vide: '' }));
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}

export async function construirePdfFeuillePresence(modele, donnees) {
  return convertirDocxEnPdf(await construireDocxFeuillePresence(modele, donnees));
}
