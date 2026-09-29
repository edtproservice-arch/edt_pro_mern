import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { contenuLigne } from 'shared/domain';
import { JOURS } from 'shared/constants';
import { dateFr, entetePluriel, nomFichierExport } from './exportGlobalTexte.js';
import { celluleDeuxParagraphes, celluleDonnee, celluleTexteSimple, echapperXml } from './xmlCellules.js';
import { chargerCanevasTampon } from './canevasCache.js';
import { assemblerLigne, avecHauteurMinimale, extraireTableaux, extraireLignes, remplacerBalise } from './xmlTableaux.js';

/**
 * Le Word de la « vue globale » — GREFFÉ dans le canevas transmis par
 * l'établissement (2026-09-23, demande du porteur : « modifier directement
 * dans le canvas car le résultat n'est pas similaire »).
 *
 * ═══ ⚠️ CE N'EST PLUS UNE RECONSTRUCTION, C'EST UNE GREFFE ═══
 * La première version régénérait le document avec la bibliothèque `docx` —
 * même agencement, mais jamais le même rendu qu'un fichier Word ouvert et
 * imprimé (polices, filets, logo). Celle-ci part du .docx RÉEL déposé par
 * l'établissement (`canevas/emploiGlobalFormateur.docx`), n'en modifie QUE le
 * texte des cellules, et laisse tout le reste — styles, filets, logo,
 * polices — strictement tel quel. Le fichier rendu est donc VISUELLEMENT
 * IDENTIQUE au canevas, à ceci près que les données sont les vraies.
 *
 * ═══ COMMENT LE CANEVAS EST LU ═══
 * Le canevas porte deux tableaux : le bloc de titre (logo + établissement),
 * et la grille elle-même (27 colonnes : Émargement, Formateur/Groupe/Espace,
 * Type, puis 6 jours × 4 créneaux). Les DEUX premières lignes de la grille
 * (les en-têtes JOURS et CRÉNEAUX) sont reprises telles quelles. Les TROIS
 * lignes suivantes (Groupe/Module/Salle du premier formateur du canevas)
 * servent de GABARIT : leurs bordures et largeurs dépendent de la POSITION
 * (première/milieu/dernière ligne du triplet, N-ième colonne), jamais du
 * contenu — un même gabarit sert donc pour n'importe quel nombre réel de
 * sujets, en clonant ce triplet autant de fois qu'il faut.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHEMIN_CANEVAS = path.join(__dirname, 'canevas', 'emploiGlobalFormateur.docx');

/** Le TYPE affiché dans le canevas — « SALLE », pas « Espace » (vocabulaire du domaine). */
const LABELS_TYPE = { Groupe: 'GROUPE', Module: 'MODULE', Espace: 'ESPACE', Formateur: 'FORMATEUR' };

/** Le triplet Groupe/Module/Salle d'UN sujet, cloné depuis les trois gabarits. */
function construireLignesSujet({ gabarits, libelle, lignes, cases, nomsFormateurs }) {
  const nomComplet = String(libelle ?? '').trim();
  const espace = nomComplet.indexOf(' ');
  const ligne1 = espace === -1 ? nomComplet : nomComplet.slice(0, espace);
  const ligne2 = espace === -1 ? '' : nomComplet.slice(espace + 1);

  return lignes
    .map((ligneNom, rang) => {
      const { avantPremierTc, tcs } = gabarits[rang];
      const neuves = [...tcs];

      // ⚠️ Seule la PREMIÈRE des trois lignes porte le nom : `vMerge` fusionne
      // les deux suivantes sur elle, comme dans le canevas.
      if (rang === 0) neuves[1] = celluleDeuxParagraphes(neuves[1], ligne1, ligne2);
      neuves[2] = celluleTexteSimple(neuves[2], LABELS_TYPE[ligneNom] ?? ligneNom.toUpperCase());

      for (let i = 0; i < cases.length; i += 1) {
        const premiere = cases[i].seances[0];
        const aDistance = String(premiere?.salle ?? '').toUpperCase() === 'TEAMS';
        neuves[3 + i] = celluleDonnee(
          neuves[3 + i],
          contenuLigne(cases[i].seances, ligneNom, nomsFormateurs),
          aDistance
        );
      }

      return assemblerLigne(avantPremierTc, neuves);
    })
    .join('');
}

export async function construireDocxGlobal(donnees) {
  const {
    etablissement,
    anneeScolaire,
    semaineLabel,
    semaineDebut,
    entete,
    lignes,
    creneaux,
    assemblees,
    libelleDuSujet,
    nomsFormateurs,
    horaireDuCreneau,
  } = donnees;

  const tampon = await chargerCanevasTampon(CHEMIN_CANEVAS);
  const zip = await JSZip.loadAsync(tampon);
  const fichierDocument = zip.file('word/document.xml');
  if (!fichierDocument) {
    throw new Error('Canevas Word illisible : word/document.xml absent du modèle');
  }

  let xml = await fichierDocument.async('string');

  /* ── En-tête établissement / semaine — les valeurs baked-in du canevas transmis. ── */
  xml = remplacerBalise(xml, 'CF MEDIOUNA CASABLANCA ', `${echapperXml(etablissement?.complexe)} `);
  xml = remplacerBalise(
    xml,
    ' INSTITUT SPECIALISE DE TECHNOLOGIE APPLIQUEE SIDI HAJJAJ OUED HASSAR',
    ` ${echapperXml(etablissement?.nom)}`
  );
  xml = remplacerBalise(xml, 'EMPLOI GLOBAL FORMATEURS', `EMPLOI GLOBAL ${entetePluriel(entete)}`);
  xml = remplacerBalise(
    xml,
    "Au Titre de l'année 2026-2027",
    `Au Titre de l'année ${anneeScolaire}-${anneeScolaire + 1}`
  );
  xml = remplacerBalise(
    xml,
    'Semaine S3 - À partir du : 14/09/2026',
    `Semaine ${semaineLabel} - À partir du : ${dateFr(semaineDebut)}`
  );

  /*
   * ═══ ⚠️⚠️ LA MARGE DE SÉCURITÉ D'UNE PAGE (2026-09-23, signalé par le
   * porteur : « en Word une seule page, en PDF non ») ═══
   * Le canevas ne fixe AUCUNE hauteur de ligne — chaque moteur la CALCULE lui-
   * même depuis le texte, et Word et LibreOffice ne mesurent pas une police
   * au dixième de point près exactement pareil. Pour dix-sept formateurs
   * (cinquante et une lignes de données) tenus SUR UNE SEULE PAGE, un écart
   * de quelques centièmes de point par ligne suffit à faire déborder la
   * DERNIÈRE ligne sur une seconde page — et parce que cette ligne porte la
   * fusion verticale du nom du formateur (`vMerge`), elle y réapparaît sans
   * son nom, un fragment illisible.
   *
   * ⚠️ ON NE TOUCHE PAS LA POLICE NI LA TAILLE DU TEXTE — seules les marges,
   * invisibles à l'œil à cette échelle, gagnent la marge d'erreur qui absorbe
   * l'écart entre les deux moteurs :
   *   - la marge INTÉRIEURE de chaque cellule (haut/bas, 20 → 8 dixièmes de
   *     point) : appliquée à over 53 lignes, c'est elle qui rend le plus ;
   *   - la marge de PAGE (haut/bas, 284 → 140 dixièmes de point).
   */
  xml = xml.replaceAll('<w:top w:w="20" w:type="dxa"/>', '<w:top w:w="8" w:type="dxa"/>');
  xml = xml.replaceAll('<w:bottom w:w="20" w:type="dxa"/>', '<w:bottom w:w="8" w:type="dxa"/>');
  xml = remplacerBalise(
    xml,
    '<w:pgMar w:top="284" w:right="400" w:bottom="284" w:left="400" w:header="708" w:footer="708" w:gutter="0"/>',
    '<w:pgMar w:top="140" w:right="400" w:bottom="140" w:left="400" w:header="708" w:footer="708" w:gutter="0"/>'
  );

  /*
   * ⚠️ LA COLONNE TYPE CÈDE DE LA PLACE À LA COLONNE SUJET (2026-09-24,
   * demande du porteur : « diminuer un peu le width plutôt que la taille du
   * texte »). La colonne TYPE du canevas (550 dixièmes de point) est taillée
   * pour « GROUPE »/« MODULE »/« SALLE » ; sur l'axe groupe ou salle, elle
   * affiche « FORMATEUR », plus long, qui déborde à la même taille de police.
   * On lui reprend de la place sur la colonne du sujet (nom du formateur ou
   * du groupe, largement assez large pour s'en passer) — la largeur totale du
   * tableau ne bouge pas, seule la répartition change.
   *
   * ⚠️⚠️ LES DEUX GRILLES, PAS SEULEMENT LES CELLULES (constaté ici même) :
   * le canevas porte déjà un ÉCART entre `w:tblGrid` (954/499, la largeur
   * « déclarée » de la colonne) et le `w:tcW` de chaque cellule (1050/550, la
   * largeur qu'elle applique réellement) — Word tolère la différence, mais
   * LibreOffice, lui, s'aligne sur `tblGrid` : changer seulement les cellules
   * n'avait aucun effet visible à la conversion PDF. Les deux doivent porter
   * la même valeur.
   */
  xml = xml.replaceAll('<w:tcW w:w="1050" w:type="dxa"/>', '<w:tcW w:w="800" w:type="dxa"/>');
  xml = xml.replaceAll('<w:tcW w:w="550" w:type="dxa"/>', '<w:tcW w:w="800" w:type="dxa"/>');
  xml = remplacerBalise(xml, '<w:gridCol w:w="954"/>', '<w:gridCol w:w="800"/>');
  xml = remplacerBalise(xml, '<w:gridCol w:w="499"/>', '<w:gridCol w:w="800"/>');

  /* ── La grille : ossature gardée, lignes de données reconstruites. ── */
  const tableaux = extraireTableaux(xml);
  const tableauPlanning = tableaux[1];
  if (!tableauPlanning) {
    throw new Error('Canevas Word illisible : la grille attendue est absente');
  }

  const lignesGabarit = extraireLignes(tableauPlanning.contenu);
  const [ligneJours, ligneCreneaux, ...ligneTriplet] = lignesGabarit;
  /*
   * ⚠️ LA MÊME HAUTEUR PLANCHER POUR LES TROIS LIGNES DU TRIPLET (2026-09-24,
   * demande du porteur) : voir `avecHauteurMinimale`. Chacune part de la même
   * hauteur « normale » (une ligne de texte), et s'agrandit SEULE si son
   * propre contenu a besoin d'une seconde ligne — la ligne du sujet, dont le
   * nom tient presque toujours sur deux lignes, grandit donc naturellement
   * plus souvent que Module ou Salle, sans qu'on ait à le lui imposer.
   */
  const HAUTEUR_LIGNE_NORMALE = 130;
  const gabarits = ligneTriplet
    .slice(0, 3)
    .map(({ avantPremierTc, tcs }) => ({
      avantPremierTc: avecHauteurMinimale(avantPremierTc, HAUTEUR_LIGNE_NORMALE),
      tcs,
    }));

  const ligneJoursTcs = [...ligneJours.tcs];
  ligneJoursTcs[1] = celluleTexteSimple(ligneJoursTcs[1], entete.toUpperCase());
  const ligneJoursXml = assemblerLigne(avecHauteurMinimale(ligneJours.avantPremierTc, 180), ligneJoursTcs);

  /*
   * ⚠️ L'HORAIRE VIENT DU RÉGLAGE ADMIN, PAS DU CANEVAS (2026-09-23, signalé
   * par le porteur : « il faut qu'il prenne l'horaire configuré par
   * l'admin »). Le gabarit affichait ses propres heures figées (08h30-11h00…
   * identiques les six jours) ; `horaireDuCreneau` connaît le jeu en vigueur
   * (hiver/été/ramadan) ET l'écart du vendredi (la prière de midi), comme le
   * fait déjà l'Excel.
   */
  const ligneCreneauxTcs = [...ligneCreneaux.tcs];
  let colonne = 0;
  for (const jour of JOURS) {
    for (const creneau of creneaux) {
      const { debut, fin } = horaireDuCreneau(jour, creneau);
      ligneCreneauxTcs[3 + colonne] = celluleDeuxParagraphes(
        ligneCreneauxTcs[3 + colonne],
        debut.replace(':', 'h'),
        fin.replace(':', 'h')
      );
      colonne += 1;
    }
  }
  const ligneCreneauxXml = assemblerLigne(
    avecHauteurMinimale(ligneCreneaux.avantPremierTc, 250),
    ligneCreneauxTcs
  );

  const preambule = tableauPlanning.contenu.slice(
    0,
    tableauPlanning.contenu.indexOf(ligneJours.avantPremierTc)
  );

  const nouvellesLignes = assemblees
    .map((ligneSujet) =>
      construireLignesSujet({
        gabarits,
        libelle: libelleDuSujet(ligneSujet.sujet),
        lignes,
        cases: ligneSujet.cases,
        nomsFormateurs,
      })
    )
    .join('');

  const nouveauTableau = `${preambule}${ligneJoursXml}${ligneCreneauxXml}${nouvellesLignes}</w:tbl>`;
  const nouveauXml = xml.slice(0, tableauPlanning.debut) + nouveauTableau + xml.slice(tableauPlanning.fin);

  zip.file('word/document.xml', nouveauXml);

  /*
   * ⚠️ « APTOS » (LA POLICE PAR DÉFAUT DU CANEVAS) N'EST QUASIMENT JAMAIS
   * INSTALLÉE (2026-09-23, constaté ici même) : c'est la police récente
   * d'Office 365, absente de LibreOffice ET de la plupart des postes Word non
   * à jour. Sans elle, chaque moteur substitue une police de secours DIFFÉRENTE
   * — LibreOffice la rend nettement plus grasse que Calibri à 4 pt, d'où le
   * texte qui « devient gras » à la conversion PDF. « Calibri » est déjà
   * déclarée dans le canevas (`fontTable.xml`) : LibreOffice la rend via
   * « Carlito », sa remplaçante compatible au trait près, bien hintée aux
   * petites tailles.
   */
  const fichierStyles = zip.file('word/styles.xml');
  if (fichierStyles) {
    const stylesXml = await fichierStyles.async('string');
    zip.file('word/styles.xml', stylesXml.replaceAll('Aptos', 'Calibri'));
  }

  const tamponFinal = await zip.generateAsync({ type: 'nodebuffer' });

  return {
    tampon: tamponFinal,
    nomFichier: nomFichierExport(donnees, 'docx'),
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}
