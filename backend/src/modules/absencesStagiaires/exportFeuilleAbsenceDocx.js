import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { celluleTexteSimple, echapperXml } from '../seances/xmlCellules.js';
import { chargerCanevasTampon } from '../seances/canevasCache.js';
import { assemblerLigne, extraireLignes, extraireTableaux, remplacerBalise } from '../seances/xmlTableaux.js';
import {
  datesJoursOuvres,
  libelleSemainePeriode,
  nomFichierFeuilleAbsence,
  texteHeures,
} from './exportFeuilleAbsenceTexte.js';

/**
 * Le Word de la feuille d'absence hebdomadaire des STAGIAIRES — GREFFÉ dans le
 * canevas transmis (2026-09-29, demande du porteur : « je veux intégrer
 * l'absence pour stagiaire, voici le canvas pour Feuille d'Absence
 * Hebdomadaire »), suivant la même méthode que les autres exports de ce
 * projet : le fichier réel de l'établissement sert de gabarit, seul le TEXTE
 * des cellules change.
 *
 * ═══ COMMENT CE CANEVAS-CI EST FAIT ═══
 * DEUX tableaux : un encart (Filière / Année de formation / Groupe / Semaine),
 * puis LA GRILLE — 27 colonnes (N°, Nom & Prénom, T. A, puis 6 jours × 4
 * créneaux), 30 lignes : l'en-tête des jours (fusionné sur 4 colonnes chacun),
 * l'en-tête des créneaux (S1-S4 × 6), 25 lignes-gabarit d'ÉTUDIANT identiques
 * (numérotées 1 à 25 dans le canevas transmis, avec des trous — ignorés ici,
 * voir plus bas), puis Formateurs / Emargements / Assistants — trois champs
 * MANUELS qu'aucune donnée ne vient remplir, comme sur le canevas transmis.
 *
 * ⚠️ UNE SEULE ligne-gabarit ÉTUDIANT, PAS 25 (2026-09-29, décision du porteur :
 * « 1, 2, 3… sans trous, ordre alphabétique ») — le canevas transmis numérote
 * ses 25 lignes à la Konosys, avec des trous (des lignes vides entre deux noms
 * : voir la ligne 21 à 24, vides, entre BOULLOUS et YAKDAN). Reproduire cette
 * numérotation demanderait un rang stable que rien, dans ce projet, ne porte
 * aujourd'hui. On clone donc la PREMIÈRE ligne-gabarit autant de fois qu'il y a
 * de stagiaires dans le groupe, numérotés 1..N sans trou.
 *
 * ⚠️ LE SURLIGNAGE ROSE D'UNE LIGNE DU CANEVAS (« BOUHZAM DOUNIA ») n'est PAS
 * reproduit : c'est une annotation manuelle de l'exemplaire transmis, absente
 * de la ligne-gabarit qu'on clone (la toute première, jamais surlignée).
 *
 * ⚠️ « FORMATEURS » EST LA SEULE DES TROIS LIGNES MANUELLES À ÊTRE REMPLIE
 * (2026-09-29, demande du porteur : « en ligne formateur en bas afficher le
 * nom du formateur verticalement ») — Émargements et Assistants restent
 * blancs, à signer à la main.
 *
 * ⚠️⚠️ UNE SEULE DES 24 CASES PORTE `<w:textDirection w:val="btLr"/>` DANS LE
 * CANEVAS TRANSMIS (2026-09-29, constaté ici même : rendu, le nom d'une case
 * SANS direction s'écrivait à l'horizontale, mot pour mot ce que le porteur
 * signalait — « corrige ce problème des noms pas verticale ») — celle où
 * figurait l'exemple « FOUAD NOUZRI ». Les 23 autres n'ont ni direction ni
 * `<w:t>` du tout : qui a préparé ce canevas n'a mis en forme que la case de
 * son propre exemple. `celluleFormateurVertical` force donc la direction et
 * la taille de police sur LES 24, plutôt que de faire confiance au gabarit.
 *
 * ═══ ⚠️ PLUSIEURS GROUPES = PLUSIEURS PAGES, UN SEUL FICHIER (2026-09-29,
 * demande du porteur : « en faire l'appel je veux ajouter l'option de filtre
 * comme en édition » — le bouton télécharge alors TOUS les groupes affichés
 * par le filtre) ═══ Le corps du canevas n'est qu'UNE page (deux tableaux
 * entre deux petits paragraphes-espaceurs, jusqu'à `<w:sectPr>` — la mise en
 * page, l'en-tête, le logo). On en extrait ce bloc UNE fois comme GABARIT DE
 * PAGE, on le clone et on le remplit pour chaque groupe demandé, séparés par
 * un saut de page — jamais un fichier par groupe : c'est le même geste
 * « Télécharger » qui doit tout donner.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHEMIN_CANEVAS = path.join(__dirname, 'canevas', 'feuilleAbsenceHebdomadaire.docx');

/** Les 3 premières lignes de la grille (N°, Nom & Prénom, T. A) + les 6 jours × 4 créneaux d'un étudiant. */
const COLONNES_DONNEES = 3;

const COULEURS_MARQUE = {
  absence: 'B91C1C',
  retard: 'C2650C',
};

/**
 * ⚠️ DEUX SEMAINES D'ABSENCE DE SUITE (2026-09-29, demande du porteur : « si
 * un stagiaire est absent en semaine S4 [puis] S5 sa ligne le bg et texte
 * doit être en rouge ») — voir `exportFeuilleAbsence.service.js` pour la
 * règle exacte (`ligne.rouge`). Fond clair + texte rouge foncé, PAS rouge sur
 * rouge (illisible) : même teinte de texte que les cases « A ».
 */
const FOND_LIGNE_ROUGE = 'FEE2E2';
const TEXTE_LIGNE_ROUGE = COULEURS_MARQUE.absence;

const SAUT_DE_PAGE = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/** Le gris des cases d'un jour férié (2026-10-23) — plus soutenu que le fond des en-têtes. */
const FOND_FERIE = 'D9D9D9';

/*
 * ⚠️ L'ORDRE DES PROPRIÉTÉS D'UNE CASE EST IMPOSÉ PAR LE FORMAT (2026-10-23) :
 * `tcW, gridSpan, vMerge, tcBorders, shd, noWrap, tcMar, textDirection,
 * tcFitText, vAlign, hideMark`. Un élément posé en TÊTE de `<w:tcPr>` (ce que
 * faisaient la ligne rouge et le nom vertical) passe dans LibreOffice mais peut
 * faire déclarer le fichier « illisible » par Word. Chacun s'insère donc
 * devant le premier de ceux qui doivent le suivre.
 */
const APRES_SHD = ['noWrap', 'tcMar', 'textDirection', 'tcFitText', 'vAlign', 'hideMark'];
const APRES_TEXT_DIRECTION = ['tcFitText', 'vAlign', 'hideMark'];

function insererDansTcPr(tc, element, suivants) {
  const tcPr = tc.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/)?.[0];
  if (!tcPr) return tc.replace(/<w:tc>/, `<w:tc><w:tcPr>${element}</w:tcPr>`);
  const positions = suivants
    .map((nom) => tcPr.search(new RegExp(`<w:${nom}\\b`)))
    .filter((position) => position !== -1);
  const position = positions.length ? Math.min(...positions) : tcPr.length - '</w:tcPr>'.length;
  return tc.replace(tcPr, tcPr.slice(0, position) + element + tcPr.slice(position));
}

/** Le fond d'une case : remplacé s'il existe, sinon inséré à sa place. */
function avecFond(tcModele, couleur) {
  const shd = `<w:shd w:val="clear" w:color="auto" w:fill="${couleur}"/>`;
  return /<w:shd\b[^/]*\/>/.test(tcModele)
    ? tcModele.replace(/<w:shd\b[^/]*\/>/, shd)
    : insererDansTcPr(tcModele, shd, APRES_SHD);
}

/**
 * ═══ ⚠️ UN JOUR FÉRIÉ = UN SEUL BLOC (2026-10-23, demande du porteur :
 * « afficher le nom du jour verticalement en colonne après fusionner ») ═══
 * Dans chaque ligne, ses quatre cases n'en font qu'une (`gridSpan`) ; d'une
 * ligne à l'autre, ces cases se fusionnent en hauteur (`vMerge`), du premier
 * stagiaire à la ligne « Formateurs ». Seule la case de TÊTE porte le texte,
 * écrit à la verticale — les suivantes ne font que la prolonger.
 *
 * @param {Array<string>} tcs  les cases de la ligne
 * @param {number} decalage    l'index de la première case de créneau
 * @param {'tete'|'suite'} rang
 */
function fusionnerJoursFeries(tcs, decalage, feries, rang) {
  const resultat = [...tcs];
  // De droite à gauche : chaque fusion retire trois cases sans déplacer celles d'avant.
  for (let jour = (feries?.length ?? 0) - 1; jour >= 0; jour -= 1) {
    const ferie = feries[jour];
    if (!ferie) continue;
    const debut = decalage + jour * 4;
    resultat.splice(debut, 4, caseFeriee(resultat.slice(debut, debut + 4), rang === 'tete' ? ferie.intitule : null));
  }
  return resultat;
}

/** Taille (en demi-points) du nom du férié, à la verticale dans son bloc. */
const TAILLE_FERIE = 22;
const BORDURE_FERIE = '<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="8" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="8" w:space="0" w:color="000000"/>';

/** Les quatre cases d'un jour férié, réunies — `intitule` dans la case de tête, rien dans les suivantes. */
function caseFeriee(quatre, intitule) {
  const largeur = quatre.reduce((somme, tc) => somme + Number(tc.match(/<w:tcW w:w="(\d+)"/)?.[1] ?? 0), 0);
  // Dans l'ordre imposé : tcW, gridSpan, vMerge, tcBorders, shd, textDirection, vAlign.
  const tcPr =
    `<w:tcPr><w:tcW w:w="${largeur}" w:type="dxa"/><w:gridSpan w:val="4"/>` +
    (intitule !== null ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>') +
    `<w:tcBorders>${BORDURE_FERIE}</w:tcBorders>` +
    `<w:shd w:val="clear" w:color="auto" w:fill="${FOND_FERIE}"/>` +
    '<w:textDirection w:val="btLr"/><w:vAlign w:val="center"/></w:tcPr>';
  const paragraphe =
    intitule !== null
      ? `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="${TAILLE_FERIE}"/><w:szCs w:val="${TAILLE_FERIE}"/></w:rPr><w:t xml:space="preserve">${echapperXml(`Jour férié — ${intitule}`)}</w:t></w:r></w:p>`
      : '<w:p/>';
  return `<w:tc>${tcPr}${paragraphe}</w:tc>`;
}

/**
 * Taille (en demi-points) et hauteur de ligne (en twips) du nom de formateur,
 * à la verticale — 2026-09-30, demande du porteur : « je veux agrandi la
 * taille du texte du nom formateur » (après les réglages précédents, 9 puis
 * 11). 13 est le maximum sûr : les colonnes de créneau ne font qu'environ
 * 320 twips de large (16pt), et une police plus grande (essayé : 16) fait
 * passer le nom le plus long, « ABDESSAMAD AIT TALEB », à la ligne — ce qui
 * casse l'alignement vertical de toute la rangée. La hauteur de ligne grandit
 * avec la police, dans la même proportion : sans elle, un nom un peu long
 * revient au bogue du départ (deux colonnes tassées dans la même case).
 */
const TAILLE_FORMATEUR = 13;
const HAUTEUR_LIGNE_FORMATEURS = 1800;

/**
 * Le texte d'une cellule au gabarit VIDE (pas de `<w:t>`, comme « T. A »),
 * CENTRÉ — 2026-09-29, demande du porteur : « centrer le texte ». Différent
 * de `celluleTexteSimple` (jamais centrée) car cette colonne-ci porte des
 * nombres à comparer d'un coup d'œil, comme N° et chaque case de créneau.
 */
function celluleTexteCentre(tcModele, texte) {
  const run = `<w:r><w:t xml:space="preserve">${echapperXml(texte)}</w:t></w:r>`;
  if (/<w:p\b[^>]*\/>/.test(tcModele)) {
    return tcModele.replace(/<w:p\b([^>]*)\/>/, (_correspondance, attributs) => `<w:p${attributs}><w:pPr><w:jc w:val="center"/></w:pPr>${run}</w:p>`);
  }
  return tcModele.replace('</w:p>', `${run}</w:p>`);
}

/** Une case de créneau : vide si présent, lettre colorée si absence ou retard. */
function celluleMarque(tcModele, marque) {
  if (!marque) return tcModele;

  const lettre = marque === 'retard' ? 'R' : 'A';
  const couleur = COULEURS_MARQUE[marque] ?? COULEURS_MARQUE.absence;
  const run = `<w:r><w:rPr><w:b/><w:bCs/><w:color w:val="${couleur}"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr><w:t>${lettre}</w:t></w:r>`;

  if (/<w:p\b[^>]*\/>/.test(tcModele)) {
    return tcModele.replace(/<w:p\b([^>]*)\/>/, (_correspondance, attributs) => `<w:p${attributs}><w:pPr><w:jc w:val="center"/></w:pPr>${run}</w:p>`);
  }
  return tcModele.replace('</w:p>', `${run}</w:p>`);
}

/** La cellule d'une ligne rouge : fond clair sur la case, rouge foncé sur chacun de ses runs. */
function avecLigneRouge(tcModele) {
  let xml = avecFond(tcModele, FOND_LIGNE_ROUGE);

  xml = xml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) => {
    if (/<w:rPr>/.test(run)) {
      return /<w:color\b[^/]*\/>/.test(run)
        ? run.replace(/<w:color\b[^/]*\/>/, `<w:color w:val="${TEXTE_LIGNE_ROUGE}"/>`)
        : run.replace('<w:rPr>', `<w:rPr><w:color w:val="${TEXTE_LIGNE_ROUGE}"/>`);
    }
    return run.replace(/^<w:r\b[^>]*>/, (ouverture) => `${ouverture}<w:rPr><w:color w:val="${TEXTE_LIGNE_ROUGE}"/></w:rPr>`);
  });

  return xml;
}

/** L'en-tête des jours a DEUX paragraphes par case (« LUN » puis la date) : seul le second change. */
function avecDateEnteteJour(tcModele, dateTexte) {
  const paragraphes = tcModele.match(/<w:p\b[\s\S]*?<\/w:p>/g);
  if (!paragraphes || paragraphes.length < 2) return tcModele;

  const dernier = paragraphes[paragraphes.length - 1];
  const remplace = dernier.replace(/<w:t[^>]*>[^<]*<\/w:t>/, `<w:t>${echapperXml(dateTexte)}</w:t>`);
  return tcModele.replace(dernier, remplace);
}

/** Une ligne d'étudiant : N°, Nom & Prénom, T. A, puis ses 24 cases de créneau. */
function construireLigneEtudiant(gabaritTcs, ligne, feries, rang) {
  const neuves = [...gabaritTcs];
  neuves[0] = celluleTexteSimple(neuves[0], String(ligne.numero));
  neuves[1] = celluleTexteSimple(neuves[1], ligne.nom);
  neuves[2] = celluleTexteCentre(neuves[2], texteHeures(ligne.totalSemaine));
  ligne.marques.forEach((marque, index) => {
    neuves[COLONNES_DONNEES + index] = celluleMarque(neuves[COLONNES_DONNEES + index], marque);
  });
  const finales = ligne.rouge ? neuves.map(avecLigneRouge) : neuves;
  // ⚠️ APRÈS LA LIGNE ROUGE : le bloc du férié, gris, remplace ses quatre cases.
  return fusionnerJoursFeries(finales, COLONNES_DONNEES, feries, rang);
}

/**
 * Le nom d'un formateur, à la verticale, dans une case de créneau — voir la
 * note en tête de fichier : la direction et la taille sont FORCÉES plutôt que
 * lues du gabarit, dont une seule des 24 cases les porte déjà.
 */
function celluleFormateurVertical(tcModele, nom) {
  if (!nom) return tcModele;

  const tc = /<w:textDirection\b/.test(tcModele)
    ? tcModele
    : insererDansTcPr(tcModele, '<w:textDirection w:val="btLr"/>', APRES_TEXT_DIRECTION);

  const run = `<w:r><w:rPr><w:sz w:val="${TAILLE_FORMATEUR}"/><w:szCs w:val="${TAILLE_FORMATEUR}"/></w:rPr><w:t xml:space="preserve">${echapperXml(nom)}</w:t></w:r>`;

  if (/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/.test(tc)) {
    return tc.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/, run);
  }
  if (/<w:p\b[^>]*\/>/.test(tc)) {
    return tc.replace(/<w:p\b([^>]*)\/>/, (_correspondance, attributs) => `<w:p${attributs}>${run}</w:p>`);
  }
  return tc.replace('</w:p>', `${run}</w:p>`);
}

/** La hauteur de la ligne « Formateurs », assez grande pour un nom complet à la verticale. */
function avecHauteurFormateurs(avantPremierTc) {
  const proprietes = `<w:trHeight w:val="${HAUTEUR_LIGNE_FORMATEURS}" w:hRule="atLeast"/>`;
  return /<w:trHeight\b[^/]*\/>/.test(avantPremierTc)
    ? avantPremierTc.replace(/<w:trHeight\b[^/]*\/>/, proprietes)
    : avantPremierTc.replace('<w:trPr>', `<w:trPr>${proprietes}`);
}

/** La ligne « Formateurs » : sa case-étiquette (colonne fusionnée) inchangée, ses 24 cases de créneau remplies. */
function construireLigneFormateurs(gabaritTcs, formateurs, feries) {
  const neuves = [...gabaritTcs];
  formateurs.forEach((nom, index) => {
    neuves[1 + index] = celluleFormateurVertical(neuves[1 + index], nom);
  });
  // Le bloc du férié descend jusqu'ici : la ligne prolonge la fusion commencée au premier stagiaire.
  return fusionnerJoursFeries(neuves, 1, feries, 'suite');
}

/** Une page complète (l'encart + la grille) pour UN groupe, à partir du gabarit de page brut. */
function construirePage(gabaritPage, { groupe, filiere, anneeLabel, anneeScolaire, semaine, lignes, formateurs, feries }) {
  let xml = remplacerBalise(
    gabaritPage,
    'Génie Mécanique option Etudes et Méthodes en Fabrication Mécanique (2A)',
    echapperXml(`${filiere} (${anneeLabel})`)
  );
  xml = remplacerBalise(xml, '2026-2027', `${anneeScolaire}-${anneeScolaire + 1}`);
  xml = remplacerBalise(xml, 'GMOEMFM201', echapperXml(groupe));
  xml = remplacerBalise(xml, 'S2 du 14/09 au 19/09/2026', echapperXml(libelleSemainePeriode(semaine)));

  const [infos, grille] = extraireTableaux(xml);
  if (!infos || !grille) throw new Error('Canevas Word illisible : les deux tableaux attendus sont absents');

  const lignesGrille = extraireLignes(grille.contenu);
  const [enteteJours, enteteSeances, gabaritEtudiant] = lignesGrille;
  const [ligneFormateurs, ligneEmargements, ligneAssistants] = lignesGrille.slice(27);
  if (!enteteJours || !enteteSeances || !gabaritEtudiant || !ligneFormateurs || !ligneEmargements || !ligneAssistants) {
    throw new Error('Canevas Word illisible : la grille attendue a changé de forme');
  }

  const enteteJoursTcs = [...enteteJours.tcs];
  datesJoursOuvres(semaine).forEach((dateTexte, index) => {
    const texte = feries?.[index] ? `${dateTexte} · Férié` : dateTexte;
    enteteJoursTcs[COLONNES_DONNEES + index] = avecDateEnteteJour(enteteJoursTcs[COLONNES_DONNEES + index], texte);
  });

  const enteteJoursXml = assemblerLigne(enteteJours.avantPremierTc, enteteJoursTcs);
  const enteteSeancesXml = assemblerLigne(enteteSeances.avantPremierTc, enteteSeances.tcs);
  const lignesEtudiantsXml = lignes
    .map((ligne, index) =>
      assemblerLigne(
        gabaritEtudiant.avantPremierTc,
        construireLigneEtudiant(gabaritEtudiant.tcs, ligne, feries, index === 0 ? 'tete' : 'suite')
      )
    )
    .join('');
  const ligneFormateursXml = assemblerLigne(
    avecHauteurFormateurs(ligneFormateurs.avantPremierTc),
    construireLigneFormateurs(ligneFormateurs.tcs, formateurs, feries)
  );
  const lignesFinalesXml =
    ligneFormateursXml +
    [ligneEmargements, ligneAssistants].map((l) => assemblerLigne(l.avantPremierTc, l.tcs)).join('');

  const nouvelleGrille = `${enteteJoursXml}${enteteSeancesXml}${lignesEtudiantsXml}${lignesFinalesXml}`;
  const preambule = grille.contenu.slice(0, grille.contenu.indexOf(enteteJours.avantPremierTc));
  return xml.slice(0, grille.debut) + preambule + nouvelleGrille + '</w:tbl>' + xml.slice(grille.fin);
}

export async function construireDocxFeuilleAbsence(donnees) {
  const { etablissement, anneeScolaire, semaine, feuilles, feries } = donnees;

  const tampon = await chargerCanevasTampon(CHEMIN_CANEVAS);
  const zip = await JSZip.loadAsync(tampon);

  const fichierDocument = zip.file('word/document.xml');
  const fichierHeader = zip.file('word/header1.xml');
  if (!fichierDocument || !fichierHeader) {
    throw new Error('Canevas Word illisible : document.xml ou header1.xml absent du modèle');
  }

  let xmlEntete = await fichierHeader.async('string');
  xmlEntete = remplacerBalise(
    xmlEntete,
    'CENTRE DE FORMATION DANS LES MÉTIERS DE LA MÉTALLERIE SOUDURE',
    echapperXml(etablissement?.nom)
  );
  zip.file('word/header1.xml', xmlEntete);

  const xmlDocument = await fichierDocument.async('string');
  const debutCorps = xmlDocument.indexOf('<w:body>') + '<w:body>'.length;
  const debutSectPr = xmlDocument.lastIndexOf('<w:sectPr');
  if (debutSectPr <= debutCorps) throw new Error('Canevas Word illisible : la mise en page (sectPr) est absente');

  const gabaritPage = xmlDocument.slice(debutCorps, debutSectPr);

  const pages = feuilles.map((feuille) => construirePage(gabaritPage, { ...feuille, anneeScolaire, semaine, feries }));
  const corpsFinal = pages.join(SAUT_DE_PAGE);

  const xmlFinal = xmlDocument.slice(0, debutCorps) + corpsFinal + xmlDocument.slice(debutSectPr);
  zip.file('word/document.xml', xmlFinal);

  const tamponFinal = await zip.generateAsync({ type: 'nodebuffer' });

  return {
    tampon: tamponFinal,
    nomFichier: nomFichierFeuilleAbsence(feuilles.map((f) => f.groupe), semaine, 'docx'),
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}
