import ExcelJS from 'exceljs';
import {
  ENTETES_MASSES,
  FIN_SEMESTRE_1,
  JOURS_PAR_SEMAINE,
  NOMBRE_SEMAINES,
  VALEURS_AUTORISEES,
  entetes,
  lignesClasseur,
} from 'shared/domain';
import { badRequest } from '../../lib/httpError.js';

/**
 * Le classeur du chronogramme.
 * ← api/profile/export_chronogramme.php (1 225 lignes)
 *
 * ═══ CE QUE CE FICHIER SERT À FAIRE ═══
 * Il n'est pas un document d'archive : il existe pour être RETOUCHÉ hors ligne
 * puis relu. Tout ce qui suit en découle — la liste déroulante qui contraint les
 * valeurs, les cellules verrouillées là où la grille refuserait la saisie,
 * l'état de chaque semaine écrit au-dessus de sa colonne, et le format des
 * lignes qui permet à Excel de sommer.
 *
 * ⚠️ LES DEUX RÈGLES QUI LE RENDENT RÉIMPORTABLE :
 *   1. Le sujet est écrit EN CLAIR en B1, pas seulement dans l'onglet — Excel
 *      interdit `: \ / ? * [ ]` dans un nom d'onglet et le tronque à 31
 *      caractères.
 *   2. La ligne d'en-tête se repère à son PREMIER LIBELLÉ, jamais à son numéro.
 */

/** Structure des lignes de tête. Une ligne vide sépare la légende de l'état. */
const L_LEGENDE = 2;
const L_ETAT = 4;
const L_DATES = 5;
const L_ENTETE = 6;
const L_DONNEES = 7;

/** Nom sans accent ni espace : une référence de plage vers une feuille qui en
 *  contient doit être mise entre apostrophes, et l'oubli est SILENCIEUX — la
 *  validation cesse simplement de fonctionner. */
const FEUILLE_VALEURS = 'Valeurs';

/** Barème de charge hebdomadaire, celui de la grille — le classeur et l'écran
 *  doivent basculer sur les mêmes bornes. */
const SEUIL_BAS = 25;
const SEUIL_HAUT = 30;

const TEINTES = {
  entete: 'FF5B9BD5',
  fixe: 'FFE5E7EB',
  presentiel: 'FFDBEAFE',
  synchrone: 'FFEDE9FE',
  ferme: 'FFFECACA',
  stage: 'FFCFFAFE',
};

/**
 * Construit le classeur.
 *
 * @param {object} donnees
 * @param {'groupe'|'formateur'} donnees.mode
 * @param {string} donnees.anneeScolaire  « 2026-2027 »
 * @param {Array<{sujet, modules, planning, semaines, stagesParGroupe}>} donnees.feuilles
 * @returns {Promise<Buffer>}
 */
export async function construireClasseur({ mode, anneeScolaire, feuilles }) {
  if (feuilles.length === 0) {
    throw badRequest('Aucun sujet à exporter', { code: 'AUCUN_SUJET' });
  }

  const classeur = new ExcelJS.Workbook();
  classeur.creator = 'EDT Pro';
  classeur.created = new Date();

  ajouterFeuilleValeurs(classeur);

  const enTete = entetes(mode);
  const nbFixes = enTete.length;
  const colPremiereSemaine = nbFixes + 1;
  const colDerniereSemaine = nbFixes + NOMBRE_SEMAINES;
  const nomsPris = new Map();

  /*
   * Adresses rendues, pour que les feuilles de bilan y pointent leurs formules.
   * DEUX jeux, parce que les deux bilans ne se calculent pas pareil (voir
   * `ajouterFeuilleCharge`).
   */
  const sources = { groupes: new Map(), formateurs: new Map() };

  for (const feuille of feuilles) {
    ecrireFeuilleSujet(classeur, {
      ...feuille,
      mode,
      anneeScolaire,
      enTete,
      nbFixes,
      colPremiereSemaine,
      colDerniereSemaine,
      nomsPris,
      sources,
    });
  }

  /*
   * ═══ LES DEUX BILANS, QUEL QUE SOIT LE MODE ═══
   * C'est le choix de l'existant, et il est juste : on exporte par groupe pour
   * saisir, mais la question « cette personne est-elle surchargée en S12 ? » se
   * pose sur le même fichier. L'inverse vaut tout autant en mode formateur.
   */
  ajouterFeuilleCharge(classeur, {
    titre: 'Charge groupes',
    entete: 'Groupe',
    sujets: [...sources.groupes.keys()].map((cle) => cle.split('||')[0]),
    sources: sources.groupes,
    mutualise: false,
    partiel: mode === 'formateur',
  });

  ajouterFeuilleCharge(classeur, {
    titre: 'Charge formateurs',
    entete: 'Formateur',
    sujets: [...sources.formateurs.keys()].map((cle) => cle.split('||')[0]),
    sources: sources.formateurs,
    mutualise: true,
    partiel: mode === 'groupe',
  });

  return Buffer.from(await classeur.xlsx.writeBuffer());
}

/**
 * Feuille cachée des valeurs autorisées.
 *
 * ⚠️ Une validation par LISTE NOMMÉE plutôt qu'une liste écrite dans la formule :
 * Excel plafonne la seconde à 255 caractères, et la dépasser fait disparaître la
 * validation sans erreur.
 */
function ajouterFeuilleValeurs(classeur) {
  const feuille = classeur.addWorksheet(FEUILLE_VALEURS);
  VALEURS_AUTORISEES.forEach((valeur, rang) => {
    feuille.getCell(`A${rang + 1}`).value = valeur;
  });
  feuille.state = 'veryHidden';
}

function ecrireFeuilleSujet(classeur, ctx) {
  const {
    sujet,
    modules,
    planning,
    semaines,
    stagesParGroupe = {},
    mode,
    anneeScolaire,
    enTete,
    nbFixes,
    colPremiereSemaine,
    colDerniereSemaine,
    nomsPris,
    sources,
  } = ctx;

  const feuille = classeur.addWorksheet(nomOnglet(sujet, nomsPris), {
    views: [{ state: 'frozen', xSplit: nbFixes, ySplit: L_ENTETE }],
  });

  // ═══ Identification. B1 EN CLAIR : c'est ce que la relecture lit d'abord.
  feuille.getCell('A1').value = mode === 'groupe' ? 'Groupe' : 'Formateur';
  feuille.getCell('B1').value = sujet;
  feuille.getCell('A2').value = 'Année scolaire';
  feuille.getCell('B2').value = anneeScolaire;
  feuille.getCell('A1').font = { bold: true };
  feuille.getCell('A2').font = { bold: true };
  feuille.getCell('B1').font = { bold: true, size: 12 };

  ecrireLegende(feuille, colPremiereSemaine, colDerniereSemaine);

  /*
   * ═══ CE QUE L'ÉCRAN MONTRE AU-DESSUS DE CHAQUE SEMAINE ═══
   * Son état et sa date. Sans ces deux lignes, on retouche un chronogramme hors
   * ligne sans savoir que la S15 est en vacances — et l'import refuse ensuite
   * des cellules sans qu'on comprenne pourquoi.
   */
  feuille.getCell(`A${L_ETAT}`).value = 'État de la semaine';
  feuille.getCell(`A${L_DATES}`).value = 'Semaine du';
  feuille.getCell(`A${L_ETAT}`).font = { bold: true };
  feuille.getCell(`A${L_DATES}`).font = { bold: true };

  const etatSemaine = new Map();

  semaines.forEach((semaine, rang) => {
    const colonne = colPremiereSemaine + rang;
    const etat = libelleEtat(semaine);
    etatSemaine.set(semaine.numero, semaine);

    const cellule = feuille.getCell(L_ETAT, colonne);
    cellule.value = etat;
    cellule.alignment = { horizontal: 'center', textRotation: 90 };
    cellule.font = { size: 8 };
    if (!semaine.disponible) remplir(cellule, TEINTES.ferme);

    const date = feuille.getCell(L_DATES, colonne);
    date.value = `${semaine.debut.slice(8, 10)}/${semaine.debut.slice(5, 7)}`;
    date.alignment = { horizontal: 'center' };
    date.font = { size: 8, color: { argb: 'FF6B7280' } };
  });

  // ═══ En-tête
  const ligneEntete = feuille.getRow(L_ENTETE);
  enTete.forEach((libelle, rang) => {
    ligneEntete.getCell(rang + 1).value = libelle;
  });
  semaines.forEach((semaine, rang) => {
    ligneEntete.getCell(colPremiereSemaine + rang).value = `S${semaine.numero}`;
  });
  ENTETES_MASSES.forEach((libelle, rang) => {
    ligneEntete.getCell(colDerniereSemaine + 1 + rang).value = libelle;
  });

  ligneEntete.eachCell((cellule) => {
    cellule.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    cellule.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    remplir(cellule, TEINTES.entete);
  });
  ligneEntete.height = 22;

  // ═══ Données
  const lignes = lignesClasseur(modules, planning, mode);
  let rang = L_DONNEES;

  const rangsParType = { P: [], S: [] };

  for (const ligne of lignes) {
    /* ⚠️ Les entrées portent désormais `{numero, jours}` : seule une semaine
       ENTIÈREMENT prise ferme la cellule du classeur, comme à l'écran. */
    const enStage = new Set(
      (stagesParGroupe[ligne.groupe] ?? [])
        .filter((entree) => (entree?.jours ?? JOURS_PAR_SEMAINE) >= JOURS_PAR_SEMAINE)
        .map((entree) => entree?.numero ?? entree)
    );
    const excel = feuille.getRow(rang);

    const fixes =
      mode === 'groupe'
        ? [ligne.code, ligne.intitule, ligne.semestre, ligne.regional, ligne.formateurs, ligne.type]
        : [ligne.groupe, ligne.code, ligne.intitule, ligne.semestre, ligne.regional, ligne.type];

    fixes.forEach((valeur, index) => {
      const cellule = excel.getCell(index + 1);
      cellule.value = valeur;
      remplir(cellule, TEINTES.fixe);
      cellule.font = { size: 9 };
    });

    semaines.forEach((semaine, index) => {
      const colonne = colPremiereSemaine + index;
      const cellule = excel.getCell(colonne);
      const heures = ligne.heures[semaine.numero];

      if (heures) cellule.value = heures;
      cellule.alignment = { horizontal: 'center' };
      cellule.font = { size: 9 };

      /*
       * ⚠️ UNE CELLULE FERMÉE EST VERROUILLÉE ET COLORÉE. La grille refuserait la
       * saisie ; le classeur doit refuser la même chose, sinon on planifie hors
       * ligne des heures que l'import rejettera ensuite une à une.
       *
       * Un férié ISOLÉ ne ferme pas : l'écran laisse la semaine saisissable avec
       * un plafond réduit.
       */
      const ferme = !semaine.disponible || enStage.has(semaine.numero);

      if (ferme) {
        remplir(cellule, enStage.has(semaine.numero) ? TEINTES.stage : TEINTES.ferme);
        cellule.protection = { locked: true };
      } else {
        if (heures) remplir(cellule, ligne.type === 'S' ? TEINTES.synchrone : TEINTES.presentiel);
        cellule.protection = { locked: false };
        cellule.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`${FEUILLE_VALEURS}!$A$1:$A$${VALEURS_AUTORISEES.length}`],
          showErrorMessage: true,
          errorTitle: 'Valeur refusée',
          error: `La grille n’accepte que ${VALEURS_AUTORISEES.join(', ')}.`,
        };

        /*
         * ═══ LA MÊME CELLULE ALIMENTE LES DEUX BILANS ═══
         * Elle compte pour SON groupe et pour SON formateur — mais pas de la
         * même façon : voir la règle de mutualisation dans `ajouterFeuilleCharge`.
         */
        const adresse = { feuille: feuille.name, adresse: `${lettre(colonne)}${rang}` };
        const groupeDeLaLigne = mode === 'groupe' ? sujet : ligne.groupe;

        pousser(sources.groupes, `${groupeDeLaLigne}||${semaine.numero}`, adresse);

        for (const titulaire of ligne.titulaires ?? []) {
          if (!titulaire) continue;
          pousser(sources.formateurs, `${titulaire}||${semaine.numero}`, {
            ...adresse,
            // Vide pour le présentiel : chaque groupe a sa séance, tout
            // s'additionne. Renseigné pour le synchrone, où plusieurs lignes
            // décrivent UNE séance.
            ensemble: ligne.ensemble ?? '',
          });
        }
      }
    });

    // ═══ Les cinq colonnes de masse. AFFEC et ECART sont des FORMULES : le
    // classeur reste juste après une retouche, au lieu de porter des totaux
    // figés qui contrediraient la grille dès la première correction.
    const plage = `${lettre(colPremiereSemaine)}${rang}:${lettre(colDerniereSemaine)}${rang}`;
    const estP = ligne.type === 'P';

    // Le rang de chaque ligne, avec son ensemble : c'est ce qui permet au TOTAL
    // de ne compter une séance mutualisée qu'une fois.
    rangsParType[estP ? 'P' : 'S'].push({ rang, ensemble: ligne.ensemble ?? '' });

    excel.getCell(colDerniereSemaine + 1).value = estP ? ligne.prevu : null;
    excel.getCell(colDerniereSemaine + 2).value = estP ? null : ligne.prevu;
    excel.getCell(colDerniereSemaine + 3).value = estP ? { formula: `SUM(${plage})` } : null;
    excel.getCell(colDerniereSemaine + 4).value = estP ? null : { formula: `SUM(${plage})` };
    excel.getCell(colDerniereSemaine + 5).value = {
      formula: `${lettre(colDerniereSemaine + (estP ? 3 : 4))}${rang}-${lettre(colDerniereSemaine + (estP ? 1 : 2))}${rang}`,
    };

    for (let i = 1; i <= ENTETES_MASSES.length; i += 1) {
      const cellule = excel.getCell(colDerniereSemaine + i);
      cellule.alignment = { horizontal: 'center' };
      cellule.font = { size: 9 };
      remplir(cellule, TEINTES.fixe);
    }

    rang += 1;
  }

  // ═══ Ligne de totaux. « TOTAL » en colonne A : la relecture la reconnaît et
  // l'écarte — ce n'est pas une donnée.
  const total = feuille.getRow(rang);
  total.getCell(1).value = 'TOTAL';
  total.getCell(1).font = { bold: true };

  semaines.forEach((semaine, index) => {
    const colonne = colPremiereSemaine + index;
    const cellule = total.getCell(colonne);
    cellule.value = {
      formula: `SUM(${lettre(colonne)}${L_DONNEES}:${lettre(colonne)}${rang - 1})`,
    };
    cellule.font = { bold: true, size: 9 };
    cellule.alignment = { horizontal: 'center' };
    remplir(cellule, TEINTES.fixe);
  });

  /*
   * ═══ ⚠️ LE TOTAL DES MASSES, SYNCHRONE MUTUALISÉ COMPTÉ UNE FOIS ═══
   * (2026-08-26, demande du porteur : « en export Excel formateur, traite aussi
   * le calcul doublant de la masse horaire synchrone ».)
   *
   * En mode formateur, une séance fusionnée occupe une LIGNE PAR GROUPE, chacune
   * portant la masse entière : additionner la colonne double la charge
   * synchrone. C'est la règle déjà tenue par la feuille « Charge formateurs »
   * — un `MAX` par ensemble — et elle manquait ici, sur la feuille qu'on lit
   * en premier.
   *
   * ⚠️ LE PRÉSENTIEL S'ADDITIONNE toujours : deux groupes en salle, ce sont deux
   * cours distincts.
   *
   * ⚠️ EN FORMULES, PAS EN VALEURS FIGÉES — comme les colonnes AFFEC : une heure
   * corrigée dans la grille remonte au total, au lieu de le contredire.
   */
  const totalMasse = (colonne, type) => {
    const rangs = rangsParType[type];
    if (rangs.length === 0) return null;

    const reference = ({ rang: r }) => `${lettre(colonne)}${r}`;

    // Mêmes règles que `formuleCharge`, mais DANS la feuille : les références y
    // sont locales, sans préfixe d'onglet.
    const additionnees = rangs.filter((x) => !x.ensemble).map(reference);
    const parEnsemble = new Map();
    for (const x of rangs) {
      if (!x.ensemble) continue;
      if (!parEnsemble.has(x.ensemble)) parEnsemble.set(x.ensemble, []);
      parEnsemble.get(x.ensemble).push(reference(x));
    }

    const termes = [];
    if (additionnees.length > 0) termes.push(`SUM(${additionnees.join(',')})`);
    for (const refs of parEnsemble.values()) {
      // Une seule ligne : `MAX` n'apporterait rien et alourdirait la formule.
      termes.push(refs.length === 1 ? refs[0] : `MAX(${refs.join(',')})`);
    }

    return { formula: termes.join('+') };
  };

  const colonnesMasse = [
    [colDerniereSemaine + 1, 'P'],
    [colDerniereSemaine + 2, 'S'],
    [colDerniereSemaine + 3, 'P'],
    [colDerniereSemaine + 4, 'S'],
  ];

  for (const [colonne, type] of colonnesMasse) {
    const cellule = total.getCell(colonne);
    cellule.value = totalMasse(colonne, type);
    cellule.font = { bold: true, size: 9 };
    cellule.alignment = { horizontal: 'center' };
    remplir(cellule, TEINTES.fixe);
  }

  // L'écart total : ce qui est posé moins ce qui est prévu, les deux types réunis.
  const ecart = total.getCell(colDerniereSemaine + 5);
  ecart.value = {
    formula:
      `${lettre(colDerniereSemaine + 3)}${rang}+${lettre(colDerniereSemaine + 4)}${rang}` +
      `-${lettre(colDerniereSemaine + 1)}${rang}-${lettre(colDerniereSemaine + 2)}${rang}`,
  };
  ecart.font = { bold: true, size: 9 };
  ecart.alignment = { horizontal: 'center' };
  remplir(ecart, TEINTES.fixe);

  // Le barème de la grille, en mise en forme conditionnelle : une semaine
  // surchargée se reconnaît dans le fichier comme à l'écran.
  feuille.addConditionalFormatting({
    ref: `${lettre(colPremiereSemaine)}${rang}:${lettre(colDerniereSemaine)}${rang}`,
    rules: [
      regleSeuil('greaterThan', SEUIL_HAUT, 'FFFECACA', 'FF9C0006'),
      regleSeuil('greaterThan', SEUIL_BAS, 'FFD1FAE5', 'FF065F46'),
    ],
  });

  // Filet rouge de fin de semestre 1 — le même repère qu'à l'écran.
  const colBascule = colPremiereSemaine + FIN_SEMESTRE_1 - 1;
  for (let r = L_ETAT; r <= rang; r += 1) {
    const cellule = feuille.getCell(r, colBascule);
    cellule.border = { ...(cellule.border ?? {}), right: { style: 'medium', color: { argb: 'FFD31212' } } };
  }

  largeurs(feuille, mode, nbFixes, colDerniereSemaine);
}

/** Légende, posée AU-DESSUS des colonnes de semaine. */
function ecrireLegende(feuille, colPremiereSemaine, colDerniereSemaine) {
  const legende = [
    ['Présentiel (P)', TEINTES.presentiel, 'FF1E40AF'],
    ['Synchrone (S)', TEINTES.synchrone, 'FF5B21B6'],
    ['Vacances / férié', TEINTES.ferme, 'FF9C0006'],
    ['Stage en entreprise', TEINTES.stage, 'FF155E75'],
  ];

  legende.forEach(([texte, fond, encre], index) => {
    const de = colPremiereSemaine + index * 7;
    const a = de + 6;
    if (a > colDerniereSemaine) return;

    feuille.mergeCells(L_LEGENDE, de, L_LEGENDE, a);
    const cellule = feuille.getCell(L_LEGENDE, de);
    cellule.value = texte;
    cellule.alignment = { horizontal: 'center' };
    cellule.font = { bold: true, size: 9, color: { argb: encre } };
    remplir(cellule, fond);
  });
}

/**
 * Feuille de bilan : une ligne par sujet, une colonne par semaine.
 *
 * ═══ LES VALEURS SONT DES FORMULES, PAS DES NOMBRES ═══
 * Chaque cellule pointe les cellules sources des onglets de ce classeur. Une
 * heure corrigée dans un onglet remonte donc immédiatement au bilan — un total
 * figé aurait fait mentir la feuille dès la première retouche, et c'est
 * justement pour retoucher hors ligne que le fichier existe.
 *
 * ═══ ⚠️ LE SYNCHRONE NE PEUT PAS ÊTRE UNE SIMPLE SOMME ═══
 * Une séance mutualisée est diffusée à plusieurs groupes : elle apparaît sur
 * autant de lignes qu'elle en couvre. Pour le GROUPE, tout s'additionne — il
 * reçoit bien ces heures. Pour le FORMATEUR, non : il ne la donne QU'UNE FOIS,
 * et les additionner multiplierait sa charge par le nombre de groupes.
 *
 * D'où un `MAX` par ensemble synchrone, et non une somme. MAX plutôt qu'un
 * représentant fixe : si les lignes d'un même ensemble portaient des durées
 * différentes — état incohérent que rien n'empêche — un représentant choisi
 * d'avance pourrait tomber sur une case vide, là où MAX rend la séance telle
 * qu'elle a été déclarée quelque part.
 */
function ajouterFeuilleCharge(classeur, { titre, entete, sujets, sources, mutualise, partiel }) {
  const feuille = classeur.addWorksheet(titre);
  const noms = [...new Set(sujets)].sort((a, b) => a.localeCompare(b, 'fr'));

  feuille.getCell('A1').value = entete;
  for (let numero = 1; numero <= NOMBRE_SEMAINES; numero += 1) {
    feuille.getCell(1, numero + 1).value = `S${numero}`;
  }
  feuille.getCell(1, NOMBRE_SEMAINES + 2).value = 'TOTAL';

  feuille.getRow(1).eachCell((cellule) => {
    cellule.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    cellule.alignment = { horizontal: 'center' };
    remplir(cellule, TEINTES.entete);
  });

  noms.forEach((sujet, index) => {
    const rang = index + 2;
    feuille.getCell(rang, 1).value = sujet;

    for (let numero = 1; numero <= NOMBRE_SEMAINES; numero += 1) {
      const formule = formuleCharge(sources.get(`${sujet}||${numero}`) ?? [], mutualise);

      const cellule = feuille.getCell(rang, numero + 1);
      if (formule) cellule.value = { formula: formule };
      cellule.alignment = { horizontal: 'center' };
      cellule.font = { size: 9 };
    }

    feuille.getCell(rang, NOMBRE_SEMAINES + 2).value = {
      formula: `SUM(${lettre(2)}${rang}:${lettre(NOMBRE_SEMAINES + 1)}${rang})`,
    };
  });

  feuille.addConditionalFormatting({
    ref: `${lettre(2)}2:${lettre(NOMBRE_SEMAINES + 1)}${noms.length + 1}`,
    rules: [
      regleSeuil('greaterThan', SEUIL_HAUT, 'FFFECACA', 'FF9C0006'),
      regleSeuil('greaterThan', SEUIL_BAS, 'FFD1FAE5', 'FF065F46'),
    ],
  });

  /*
   * ⚠️ UN BILAN NE COUVRE QUE CE QUE LE CLASSEUR CONTIENT. En mode groupe, la
   * feuille des formateurs ne voit que les groupes exportés : la charge d'une
   * personne qui enseigne ailleurs y paraît plus légère qu'elle ne l'est. Un
   * total partiel pris pour le total réel enverrait charger davantage quelqu'un
   * de déjà plein — la mention le dit, plutôt que de laisser conclure.
   */
  if (partiel) {
    const avertissement = feuille.getCell(noms.length + 3, 1);
    avertissement.value =
      `⚠ Ce bilan ne porte que sur les onglets de ce classeur. Un ${entete.toLowerCase()} ` +
      `intervenant hors de cet export y paraîtra moins chargé qu'il ne l'est.`;
    avertissement.font = { italic: true, size: 9, color: { argb: 'FF9C0006' } };
  }

  feuille.getColumn(1).width = 26;
  for (let i = 2; i <= NOMBRE_SEMAINES + 2; i += 1) feuille.getColumn(i).width = 6;
  feuille.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
}

/**
 * Formule d'UNE cellule de bilan.
 *
 * Sans mutualisation, tout s'additionne. Avec, les adresses sont d'abord
 * groupées par ENSEMBLE synchrone : chaque ensemble ne pèse que pour son
 * maximum, les ensembles s'additionnant entre eux.
 *
 * @returns {string} formule sans le `=` initial, ou chaîne vide s'il n'y a rien.
 */
function formuleCharge(adresses, mutualise) {
  if (adresses.length === 0) return '';

  const reference = ({ feuille, adresse }) => `'${feuille.replace(/'/g, "''")}'!${adresse}`;

  if (!mutualise) return `SUM(${adresses.map(reference).join(',')})`;

  // Ensemble vide = présentiel : chaque groupe a sa séance, tout s'additionne.
  const additionnees = adresses.filter((source) => !source.ensemble);
  const parEnsemble = new Map();

  for (const source of adresses) {
    if (!source.ensemble) continue;
    if (!parEnsemble.has(source.ensemble)) parEnsemble.set(source.ensemble, []);
    parEnsemble.get(source.ensemble).push(source);
  }

  const termes = [];
  if (additionnees.length > 0) termes.push(`SUM(${additionnees.map(reference).join(',')})`);

  for (const groupe of parEnsemble.values()) {
    const refs = groupe.map(reference);
    // Une seule cellule : `MAX` n'apporterait rien et alourdirait la formule.
    termes.push(refs.length === 1 ? refs[0] : `MAX(${refs.join(',')})`);
  }

  return termes.join('+');
}

/** État affiché au-dessus d'une colonne de semaine. */
function libelleEtat(semaine) {
  if (semaine.motif === 'vacances') return 'Vacances';
  if (semaine.motif === 'stage') return 'Stage';
  if (semaine.motif === 'formation') return 'Formation';
  if (semaine.joursDisponibles < 6) return `${semaine.joursDisponibles}J`;
  return '';
}

/**
 * Nom d'onglet acceptable par Excel : caractères interdits retirés, 31 max.
 *
 * ⚠️ Deux noms TRONQUÉS peuvent se rejoindre — Excel refuse alors le classeur
 * entier. On suffixe pour les séparer.
 */
function nomOnglet(nom, dejaPris) {
  const base = String(nom ?? '')
    .trim()
    .replace(/[:\\/?*[\]]/g, '-')
    .slice(0, 31) || 'Feuille';

  let candidat = base;
  let index = 2;
  while (dejaPris.has(candidat.toLowerCase())) {
    const suffixe = ` (${index})`;
    candidat = base.slice(0, 31 - suffixe.length) + suffixe;
    index += 1;
  }

  dejaPris.set(candidat.toLowerCase(), true);
  return candidat;
}

function largeurs(feuille, mode, nbFixes, colDerniereSemaine) {
  const colIntitule = mode === 'groupe' ? 2 : 3;

  for (let i = 1; i <= nbFixes; i += 1) {
    // SEM, REG et Type ne portent qu'un caractère : les laisser à 22 gaspille
    // trois colonnes de largeur sur un tableau qui en compte déjà cinquante.
    const libelle = entetes(mode)[i - 1];
    const etroite = ['SEM', 'REG', 'Type'].includes(libelle);
    feuille.getColumn(i).width = etroite ? 6 : i === colIntitule ? 38 : 22;
  }

  for (let i = nbFixes + 1; i <= colDerniereSemaine + ENTETES_MASSES.length; i += 1) {
    feuille.getColumn(i).width = 6.5;
  }
}

const regleSeuil = (operateur, valeur, fond, encre) => ({
  type: 'cellIs',
  operator: operateur,
  formulae: [valeur],
  priority: valeur,
  style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: fond } }, font: { color: { argb: encre } } },
});

const remplir = (cellule, argb) => {
  cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
};

const pousser = (table, cle, valeur) => {
  if (!table.has(cle)) table.set(cle, []);
  table.get(cle).push(valeur);
};

/** Index de colonne (1 = A) → lettre Excel. */
function lettre(index) {
  let reste = index;
  let nom = '';

  while (reste > 0) {
    const modulo = (reste - 1) % 26;
    nom = String.fromCharCode(65 + modulo) + nom;
    reste = Math.floor((reste - modulo) / 26);
  }

  return nom;
}
