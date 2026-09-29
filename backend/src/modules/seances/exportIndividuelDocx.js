import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { contenuLigne } from 'shared/domain';
import { JOURS } from 'shared/constants';
import { dateFr } from './exportGlobalTexte.js';
import { nomFichierIndividuel } from './exportIndividuelTexte.js';
import { celluleDeuxParagraphes, celluleDonnee, celluleTexteSimple, echapperXml } from './xmlCellules.js';
import { chargerCanevasTampon } from './canevasCache.js';
import { assemblerLigne, avecHauteurMinimale, extraireLignes, extraireTableaux, remplacerBalise } from './xmlTableaux.js';

/**
 * Le Word de la vue DÉTAILLÉE — GREFFÉ dans le canevas transmis, UNE PAGE PAR
 * SUJET affiché à l'écran (2026-09-24, demande du porteur : « le même bouton
 * Imprimer, en vue détaillée télécharge le détaillé selon le filtre » —
 * c'est-à-dire TOUS les sujets actuellement filtrés, pas un seul).
 *
 * ═══ COMMENT CE CANEVAS-CI EST FAIT ═══ Voir `exportIndividuel.service.js`.
 * Trois tableaux (titre, identité, grille) forment UNE page. Pour en rendre
 * plusieurs, on découpe le document en trois morceaux — tout ce qui précède le
 * corps, LE CORPS lui-même (un gabarit qu'on clone), et tout ce qui suit (la
 * mise en page, `<w:sectPr>`) — et on clone le corps une fois par sujet,
 * séparés par un saut de page. Les trois tableaux partagent la MÊME mise en
 * page (portrait/paysage, marges) : un seul `<w:sectPr>`, à la fin, suffit
 * pour tout le document.
 *
 * ⚠️ TROIS AXES, PAS UN SEUL (2026-09-24, demande du porteur) : le canevas
 * écrit « Formateur : NOM » en dur, mais la vue détaillée existe aussi pour
 * Groupe et Salle. L'étiquette (`entete`) ET les trois lignes du triplet
 * (`lignes`, depuis `AXES_CONSULTATION[axe].lignes`) sont donc réinjectées à
 * chaque page — jamais supposées correctes par défaut.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHEMIN_CANEVAS = path.join(__dirname, 'canevas', 'emploiIndividuelFormateur.docx');

const HAUTEUR_LIGNE_NORMALE = 130;
const SAUT_DE_PAGE = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/*
 * ⚠️ LE TEXTE DES CASES EST BIEN PLUS GRAND ICI QUE SUR LA VUE GLOBALE
 * (2026-09-24, demande du porteur : « il faut agrandir la taille du texte »).
 * `celluleDonnee` sert par défaut du 4 pt, taillé pour tenir 24 colonnes sur
 * une page — ce canevas-ci n'en a que 4, largement assez de place pour un
 * texte lisible. La hauteur de ligne reste « au moins » (`avecHauteurMinimale`) :
 * elle s'agrandit d'elle-même si le texte, plus grand, en a besoin.
 */
const TAILLE_TEXTE_DONNEE = 18; // 9 pt

/*
 * ⚠️ DEUX CRÉNEAUX FUSIONNENT PAR DEMI-JOURNÉE, PAS QUATRE UN À UN
 * (2026-09-24, demande du porteur : « fusionner les créneaux vides »). Le
 * canevas ne porte qu'UN gabarit de case fusionnée : les deux blocs
 * demi-semaine d'un jour entièrement creux (vus dans « Mardi »). On le
 * réutilise aussi pour une demi-journée VIDE d'un jour par ailleurs actif —
 * deux cases vides côte à côte ne se distinguent pas d'un jour entièrement
 * vide, elles doivent donc se fondre en une seule, comme lui.
 *
 * ⚠️ PAS DE FUSION À CHEVAL SUR LES DEUX DEMI-JOURNÉES : matin et après-midi
 * n'ont pas la même pause méridienne d'un jour à l'autre (vendredi, la
 * prière) — les fondre en un seul bloc de 4 laisserait croire à une pause
 * continue qui n'existe pas forcément. Le canevas ne porte d'ailleurs qu'un
 * gabarit fusionné de LARGEUR 2, jamais 4.
 */
const MOITIES = [
  { debut: 0, indexGabaritCreux: 2 },
  { debut: 2, indexGabaritCreux: 3 },
];

/** Les trois lignes (Groupe/Module/Espace…) d'UN jour, créneau par créneau. */
function construireLignesJour(gabaritPlein, gabaritCreux, jour, casesJour, lignes, nomsFormateurs) {
  const moitieVide = MOITIES.map(
    ({ debut }) => casesJour[debut].seances.length === 0 && casesJour[debut + 1].seances.length === 0
  );

  return lignes
    .map((ligneNom, rang) => {
      const pleines = gabaritPlein[rang].tcs;
      const creuses = gabaritCreux[rang].tcs;
      const neuves = [pleines[0], pleines[1]];

      // ⚠️ Seule la PREMIÈRE des trois lignes porte le nom du jour : `vMerge`
      // fusionne les deux suivantes sur elle, comme dans le canevas.
      if (rang === 0) neuves[0] = celluleTexteSimple(neuves[0], jour);
      // ⚠️ Le libellé de la ligne dépend de l'AXE (Formateur/Groupe/Module/
      // Espace) — plus du texte figé du canevas, qui ne vaut que sur l'axe
      // formateur d'origine.
      neuves[1] = celluleTexteSimple(neuves[1], ligneNom);

      MOITIES.forEach(({ debut, indexGabaritCreux }, indexMoitie) => {
        if (moitieVide[indexMoitie]) {
          neuves.push(creuses[indexGabaritCreux]);
          return;
        }
        for (let i = debut; i < debut + 2; i += 1) {
          const caseCreneau = casesJour[i];
          const aDistance = String(caseCreneau.seances[0]?.salle ?? '').toUpperCase() === 'TEAMS';
          neuves.push(
            celluleDonnee(
              pleines[2 + i],
              contenuLigne(caseCreneau.seances, ligneNom, nomsFormateurs),
              aDistance,
              TAILLE_TEXTE_DONNEE
            )
          );
        }
      });

      return assemblerLigne(avecHauteurMinimale(gabaritPlein[rang].avantPremierTc, HAUTEUR_LIGNE_NORMALE), neuves);
    })
    .join('');
}

/** UNE PAGE — le triplet titre/identité/grille d'un seul sujet, depuis un gabarit vierge. */
function construirePage(modelePage, { etablissement, anneeScolaire, semaineDebut, entete, lignes, creneaux, page, nomsFormateurs, horaireDuCreneau }) {
  let xml = modelePage;

  // ⚠️ LE TITRE SUIT L'AXE LUI AUSSI — « Emploi du Temps Formateur » ne vaut
  // que sur l'axe formateur, d'où vient le canevas.
  xml = remplacerBalise(xml, 'Emploi du Temps Formateur', `Emploi du Temps ${entete}`);
  xml = remplacerBalise(
    xml,
    "Au Titre de l'année 2026-2027",
    `Au Titre de l'année ${anneeScolaire}-${anneeScolaire + 1}`
  );
  xml = remplacerBalise(xml, ' Casablanca-Settat', ` ${echapperXml(etablissement?.region)}`);
  xml = remplacerBalise(xml, ' CF MEDIOUNA CASABLANCA', ` ${echapperXml(etablissement?.complexe)}`);
  xml = remplacerBalise(
    xml,
    ' INSTITUT SPECIALISE DE TECHNOLOGIE APPLIQUEE SIDI HAJJAJ OUED HASSAR',
    ` ${echapperXml(etablissement?.nom)}`
  );
  // ⚠️ « Masse Horaire » = LA SEMAINE exportée (jour + soir combinés, comme
  // l'entête de chaque tableau de `GrilleDetaillee` à l'écran), PAS la
  // capacité statutaire annuelle du formateur. Voir `exportIndividuel.service.js`.
  xml = remplacerBalise(xml, ' 40.00 H', ` ${page.heures.toFixed(2)} H`);
  // ⚠️ L'ÉTIQUETTE DÉPEND DE L'AXE — « Formateur : », « Groupe : » ou « Espace : ».
  xml = remplacerBalise(xml, 'Formateur : ', `${entete} : `);
  xml = remplacerBalise(xml, 'ABDELHAK CHARKAOUI', echapperXml(page.libelle));
  xml = remplacerBalise(xml, '21/09/2026', dateFr(semaineDebut));

  const tableaux = extraireTableaux(xml);
  const tableauPlanning = tableaux[2];
  if (!tableauPlanning) {
    throw new Error('Canevas Word illisible : la grille attendue est absente');
  }

  const [ligneCreneaux, ...blocsJours] = extraireLignes(tableauPlanning.contenu);
  // ⚠️ Lundi (actif) sert de gabarit « plein », Mardi (creux) de gabarit
  // « vide » — les deux formes que porte le canevas, dans cet ordre.
  const gabaritActif = blocsJours.slice(0, 3);
  const gabaritCreux = blocsJours.slice(3, 6);
  if (gabaritActif.length !== 3 || gabaritCreux.length !== 3) {
    throw new Error('Canevas Word illisible : les gabarits de jour attendus sont absents');
  }

  /*
   * ⚠️ L'HORAIRE VIENT DU RÉGLAGE ADMIN — même règle que `exportGlobalDocx.js`.
   * Le canevas n'a QU'UNE ligne d'en-tête pour les 6 jours : elle ne peut donc
   * pas refléter l'écart du vendredi (la prière de midi) ; on y affiche
   * l'horaire de Lundi, commun à la semaine hors ce jour-là.
   */
  const ligneCreneauxTcs = [...ligneCreneaux.tcs];
  creneaux.forEach((creneau, index) => {
    const { debut, fin } = horaireDuCreneau('Lundi', creneau);
    ligneCreneauxTcs[1 + index] = celluleDeuxParagraphes(
      ligneCreneauxTcs[1 + index],
      debut.replace(':', 'h'),
      fin.replace(':', 'h')
    );
  });
  const ligneCreneauxXml = assemblerLigne(avecHauteurMinimale(ligneCreneaux.avantPremierTc, 180), ligneCreneauxTcs);

  const nouveauxBlocsJours = JOURS.map((jour) => {
    const casesJour = page.cases.filter((c) => c.jour === jour);
    return construireLignesJour(gabaritActif, gabaritCreux, jour, casesJour, lignes, nomsFormateurs);
  }).join('');

  const preambule = tableauPlanning.contenu.slice(0, tableauPlanning.contenu.indexOf(ligneCreneaux.avantPremierTc));
  const nouveauTableau = `${preambule}${ligneCreneauxXml}${nouveauxBlocsJours}</w:tbl>`;
  return xml.slice(0, tableauPlanning.debut) + nouveauTableau + xml.slice(tableauPlanning.fin);
}

export async function construireDocxIndividuel(donnees) {
  const { etablissement, anneeScolaire, semaineDebut, entete, lignes, creneaux, pages, nomsFormateurs, horaireDuCreneau } =
    donnees;

  const tampon = await chargerCanevasTampon(CHEMIN_CANEVAS);
  const zip = await JSZip.loadAsync(tampon);
  const fichierDocument = zip.file('word/document.xml');
  if (!fichierDocument) {
    throw new Error('Canevas Word illisible : word/document.xml absent du modèle');
  }

  const xmlCanevas = await fichierDocument.async('string');
  const debutBody = xmlCanevas.indexOf('<w:body>') + '<w:body>'.length;
  const debutSectPr = debutBody > 0 ? xmlCanevas.indexOf('<w:sectPr', debutBody) : -1;
  if (debutBody <= 0 || debutSectPr === -1) {
    throw new Error('Canevas Word illisible : structure de page inattendue');
  }

  const prefixe = xmlCanevas.slice(0, debutBody);
  const modelePage = xmlCanevas.slice(debutBody, debutSectPr);
  const suffixe = xmlCanevas.slice(debutSectPr);

  const pagesXml = pages.map((page) =>
    construirePage(modelePage, {
      etablissement,
      anneeScolaire,
      semaineDebut,
      entete,
      lignes,
      creneaux,
      page,
      nomsFormateurs,
      horaireDuCreneau,
    })
  );

  zip.file('word/document.xml', prefixe + pagesXml.join(SAUT_DE_PAGE) + suffixe);

  // ⚠️ MÊME SUBSTITUTION QUE LES DEUX AUTRES CANEVAS : « Aptos » n'est presque
  // jamais installée — voir `exportGlobalDocx.js`.
  const fichierStyles = zip.file('word/styles.xml');
  if (fichierStyles) {
    const stylesXml = await fichierStyles.async('string');
    zip.file('word/styles.xml', stylesXml.replaceAll('Aptos', 'Calibri'));
  }

  const tamponFinal = await zip.generateAsync({ type: 'nodebuffer' });

  return {
    tampon: tamponFinal,
    nomFichier: nomFichierIndividuel(donnees, 'docx'),
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}
