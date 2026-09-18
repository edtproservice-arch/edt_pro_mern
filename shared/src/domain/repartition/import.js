import {
  CHAMPS_NUMERIQUES,
  COLONNES,
  COLONNES_OBLIGATOIRES,
  estRegional,
  FEUILLE_PREFEREE,
  nombre,
} from './colonnes.js';

/**
 * Lecture et confrontation d'un classeur de répartition DRIF.
 * ← `rep_lire_classeur()`, `rep_cle_ligne()` et `rep_completer()` de
 *   `includes/repartition_import.php`.
 *
 * ═══ ⚠️ CE MODULE NE LIT AUCUN FICHIER ═══
 * Il reçoit des feuilles DÉJÀ décodées (`lireToutesLesFeuilles`) : le domaine ne
 * touche ni au disque ni à `exceljs`. C'est ce qui permet de le tester sur des
 * tableaux écrits à la main, et de changer de lecteur de classeur sans le
 * réécrire.
 */

/**
 * La feuille à lire.
 *
 * ⚠️ « RepartitionHoraire » D'ABORD, PUIS LA PREMIÈRE QUI PORTE LES COLONNES
 * OBLIGATOIRES : les classeurs officiels contiennent des feuilles de SYNTHÈSE
 * qui ne portent que des totaux, sans ventilation S1 / S2. Prendre la première
 * feuille venue reviendrait à importer des masses annuelles à la place des
 * masses semestrielles — un écart qu'aucun message d'erreur ne signalerait.
 *
 * ⚠️ ET L'EN-TÊTE SE CHERCHE SUR LES PREMIÈRES LIGNES, pas seulement la
 * première : les classeurs portent souvent un titre ou une ligne vide au-dessus.
 *
 * @param {Array<{nom: string, lignes: string[][]}>} feuilles
 * @returns {{nom: string, entetes: string[], indexEntete: number} | null}
 */
export function choisirFeuille(feuilles = []) {
  const candidates = [...feuilles].sort((a, b) => {
    const prefere = (f) => (String(f.nom).toLowerCase() === FEUILLE_PREFEREE.toLowerCase() ? 0 : 1);
    return prefere(a) - prefere(b);
  });

  for (const feuille of candidates) {
    const trouvee = repererEntete(feuille.lignes ?? []);
    if (trouvee) return { nom: feuille.nom, ...trouvee };
  }

  return null;
}

/** Nombre de lignes examinées au sommet d'une feuille pour y trouver l'en-tête. */
const LIGNES_SONDEES = 10;

function repererEntete(lignes) {
  for (let index = 0; index < Math.min(lignes.length, LIGNES_SONDEES); index += 1) {
    const entetes = (lignes[index] ?? []).map((cellule) => String(cellule ?? '').trim());
    const presentes = new Set(entetes);

    if (COLONNES_OBLIGATOIRES.every((colonne) => presentes.has(colonne))) {
      return { entetes, indexEntete: index };
    }
  }

  return null;
}

/**
 * Les lignes d'une feuille, converties aux champs du modèle.
 *
 * ⚠️ ON APPARIE PAR INTITULÉ, JAMAIS PAR INDEX : les classeurs officiels
 * comptent 43 colonnes dont l'ordre a déjà changé d'une année à l'autre, et un
 * import lu par position poserait les masses horaires dans les mauvais champs
 * sans rien signaler.
 *
 * ⚠️ UNE LIGNE SANS CODE DE FILIÈRE OU SANS CODE DE MODULE EST ÉCARTÉE : les
 * classeurs portent des lignes de sous-total et des séparateurs, qui
 * deviendraient des modules fantômes.
 *
 * @returns {{lignes: object[], ignorees: number, colonnesAbsentes: string[]}}
 */
export function lireLignes(feuille, entetes, indexEntete = 0) {
  const position = new Map();
  entetes.forEach((intitule, index) => {
    if (!position.has(intitule)) position.set(intitule, index);
  });

  const colonnesAbsentes = Object.keys(COLONNES).filter((intitule) => !position.has(intitule));

  const lignes = [];
  let ignorees = 0;

  for (const brute of (feuille ?? []).slice(indexEntete + 1)) {
    const ligne = {};

    for (const [intitule, champ] of Object.entries(COLONNES)) {
      const index = position.get(intitule);
      const valeur = index === undefined ? '' : brute[index];

      if (champ === 'anneeFormation') {
        ligne[champ] = Number.parseInt(String(valeur ?? '').trim(), 10) || 1;
      } else if (champ === 'efmRegional') {
        ligne[champ] = estRegional(valeur);
      } else if (CHAMPS_NUMERIQUES.includes(champ)) {
        ligne[champ] = nombre(valeur);
      } else {
        ligne[champ] = String(valeur ?? '').trim();
      }
    }

    if (ligne.codeFiliereDrif === '' || ligne.codeModule === '') {
      ignorees += 1;
      continue;
    }

    lignes.push(ligne);
  }

  return { lignes, ignorees, colonnesAbsentes };
}

/**
 * L'identité d'une ligne : filière, année, module.
 * ← `rep_cle_ligne()`.
 *
 * ═══ ⚠️ L'INTITULÉ DU MODULE N'EN FAIT PAS PARTIE ═══
 * Deux lignes qui ne diffèrent que par leur libellé décrivent LE MÊME module :
 * l'une corrige l'autre. Inclure l'intitulé — ce que faisait l'index unique du
 * modèle jusqu'au 2026-09-02 — ferait insérer un doublon à chaque correction de
 * libellé, et le module apparaîtrait deux fois dans la cascade de la carte.
 */
export function cleLigne(ligne) {
  const texte = (valeur) => String(valeur ?? '').trim().toUpperCase();
  return `${texte(ligne.codeFiliereDrif)}||${ligne.anneeFormation ?? ''}||${texte(ligne.codeModule)}`;
}

/**
 * Les lignes du fichier, une par identité.
 *
 * ⚠️ LA DERNIÈRE L'EMPORTE, comme le ferait une écriture successive — et c'est
 * la même règle que dans `analyser`, sans quoi le remplacement écrirait un jeu
 * de lignes différent de celui qui vient d'être annoncé.
 *
 * ⚠️ ET C'EST INDISPENSABLE AU REMPLACEMENT : l'index unique refuserait le
 * second exemplaire d'une clé répétée, et l'insertion échouerait après avoir
 * vidé le référentiel.
 */
export function dedoublonner(lignes = []) {
  const parCle = new Map();
  for (const ligne of lignes) parCle.set(cleLigne(ligne), ligne);
  return [...parCle.values()];
}

/** Les champs qu'une correction peut faire varier — tout sauf l'identité. */
const CHAMPS_COMPARES = Object.values(COLONNES).filter(
  (champ) => !['codeFiliereDrif', 'anneeFormation', 'codeModule'].includes(champ)
);

/**
 * Confronte le classeur à ce qui est déjà en base.
 * ← `rep_completer()`, à qui il manquait la notion de CORRECTION.
 *
 * ═══ TROIS SORTS, PAS DEUX ═══
 * L'existant ne connaissait que « nouvelle » et « déjà connue » : une masse
 * horaire corrigée par la DRIF était donc IGNORÉE en silence, et il fallait
 * modifier la ligne à la main pour en tenir compte. On distingue désormais ce
 * qui est nouveau, ce qui DIFFÈRE, et ce qui est identique — l'appelant choisit
 * ensuite ce qu'il applique.
 *
 * ⚠️ RIEN N'EST ÉCRIT ICI : cette fonction décrit, elle n'applique pas. C'est ce
 * qui permet à l'écran d'annoncer « 120 ajouts, 12 corrections » AVANT de
 * toucher au référentiel.
 *
 * ⚠️ UN DOUBLON DANS LE FICHIER LUI-MÊME est écarté : la dernière ligne portant
 * une clé l'emporte, comme le ferait une écriture successive.
 */
export function analyser(existantes = [], nouvelles = []) {
  const connues = new Map(existantes.map((ligne) => [cleLigne(ligne), ligne]));
  /*
   * ⚠️ UN ENSEMBLE DE CODES, PAS UN PARCOURS PAR LIGNE : le référentiel compte
   * 13 359 lignes et un classeur peut en apporter autant. Chercher la filière
   * en reparcourant les lignes connues, c'était plus de cent millions de
   * comparaisons — le coût qui avait figé la carte d'affectations.
   */
  const codesConnus = new Set(
    existantes.map((ligne) => String(ligne.codeFiliereDrif ?? '').trim().toUpperCase())
  );

  const ajouts = new Map();
  const corrections = new Map();
  let identiques = 0;
  let doublonsFichier = 0;

  for (const ligne of nouvelles) {
    const cle = cleLigne(ligne);
    if (ajouts.has(cle) || corrections.has(cle)) doublonsFichier += 1;

    const connue = connues.get(cle);
    if (!connue) {
      ajouts.set(cle, ligne);
      continue;
    }

    const ecarts = CHAMPS_COMPARES.filter((champ) => !memeValeur(connue[champ], ligne[champ]));
    if (ecarts.length === 0) {
      identiques += 1;
      corrections.delete(cle);
      continue;
    }

    corrections.set(cle, { cle, ancienne: connue, nouvelle: ligne, champs: ecarts });
  }

  const listeAjouts = [...ajouts.values()];
  const listeCorrections = [...corrections.values()];

  return {
    ajouts: listeAjouts,
    corrections: listeCorrections,
    identiques,
    doublonsFichier,
    /*
     * Les filières touchées, séparées en NOUVELLES et COMPLÉTÉES : ← les deux
     * listes de `rep_completer()`. « Le fichier ajoute une filière » et « il
     * complète une filière existante » n'appellent pas la même vigilance.
     */
    filieresAjoutees: filieres(listeAjouts.filter((l) => !connaitFiliere(codesConnus, l))),
    filieresCompletees: filieres(listeAjouts.filter((l) => connaitFiliere(codesConnus, l))),
  };
}

/** ⚠️ Les nombres se comparent en NOMBRES : « 15 » et 15 sont la même masse. */
function memeValeur(a, b) {
  if (typeof a === 'number' || typeof b === 'number') return nombre(a) === nombre(b);
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
  return String(a ?? '').trim() === String(b ?? '').trim();
}

function connaitFiliere(codesConnus, ligne) {
  return codesConnus.has(String(ligne.codeFiliereDrif ?? '').trim().toUpperCase());
}

function filieres(lignes) {
  return [...new Set(lignes.map((ligne) => ligne.codeFiliereDrif))].sort();
}
