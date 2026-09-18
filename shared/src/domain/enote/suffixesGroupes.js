/**
 * Renommage des groupes issus de la base e-note.
 *
 * ← includes/parse_base_rows.php (pb_stripSuffixeGroupe, pb_extractFilierePrefix,
 *   et la partie renommage de pb_buildBaseStructureFromRows)
 *
 * Le nom d'un groupe dans l'application n'est PAS celui du fichier e-note :
 * l'import lui ajoute un suffixe de désambiguïsation. Ce nom renommé devient
 * l'identifiant du groupe dans les emplois du temps — s'il change, toutes les
 * séances qui le référencent deviennent orphelines.
 *
 * Trois règles, dans cet ordre :
 *   1. filière se terminant par CDS  → « NOM (CDS) »
 *   2. filière se terminant par FQ   → « NOM (FQ) »
 *   3. nom porté par PLUSIEURS filières → « NOM (PRÉFIXE_FILIÈRE) »
 *
 * Caractérisé sur les 24 imports réels de production.
 */

/** Suffixe généré par nous : parenthèses finales, majuscules/chiffres, ≤ 12 signes. */
const SUFFIXE_GENERE = /\s*\([A-Z0-9_]{1,12}\)$/u;

/**
 * Retire les suffixes déjà présents sur un nom de groupe.
 *
 * Indispensable au RÉIMPORT : une carte d'établissement exportée puis
 * réimportée contient déjà des noms renommés. Sans ce nettoyage, le suffixe
 * s'appliquerait une seconde fois (« ACADA101 (FQ) (FQ) »), le groupe
 * deviendrait introuvable, et toutes ses séances disparaîtraient de l'affichage.
 *
 * 5 groupes de la base de production sont dans ce cas.
 */
export function retirerSuffixe(groupe) {
  const origine = String(groupe ?? '').trim();

  let precedent = null;
  let courant = origine;

  // Boucle : un nom peut avoir accumulé plusieurs suffixes.
  while (courant !== precedent) {
    precedent = courant;
    courant = courant.replace(SUFFIXE_GENERE, '').trim();
    // Garde-fou : ne jamais vider le nom. « (FQ) » seul reste « (FQ) ».
    if (courant === '') return origine;
  }

  return courant;
}

/** Préfixe d'un code filière : ce qui précède le premier souligné. */
export function prefixeFiliere(codeFiliere) {
  const code = String(codeFiliere ?? '').trim();
  if (code === '') return '';
  return code.split('_')[0];
}

function estCds(codeFiliere) {
  return codeFiliere.endsWith('CDS');
}

function estFq(codeFiliere) {
  return codeFiliere.endsWith('FQ');
}

/**
 * Construit la table « nom de groupe → filières qui le portent ».
 *
 * Les filières CDS et FQ en sont exclues : elles sont déjà désambiguïsées par
 * leur propre suffixe, les compter fausserait la détection d'ambiguïté.
 */
function indexerFilieresParGroupe(lignes) {
  const index = new Map();

  for (const ligne of lignes) {
    const groupe = retirerSuffixe(ligne.groupe);
    const codeFiliere = String(ligne.codeFiliere ?? '').trim().toUpperCase();

    if (groupe === '' || codeFiliere === '') continue;
    if (estCds(codeFiliere) || estFq(codeFiliere)) continue;

    if (!index.has(groupe)) index.set(groupe, new Set());
    index.get(groupe).add(codeFiliere);
  }

  return index;
}

/**
 * Nom final d'un groupe.
 *
 * @param {string} groupeBrut   Nom tel qu'il figure dans le fichier.
 * @param {string} codeFiliere  Code filière de la même ligne.
 * @param {Map<string, Set<string>>} filieresParGroupe  Table d'ambiguïté.
 */
export function renommerGroupe(groupeBrut, codeFiliere, filieresParGroupe) {
  const groupe = retirerSuffixe(groupeBrut);
  if (groupe === '') return '';

  const code = String(codeFiliere ?? '').trim().toUpperCase();

  if (estCds(code)) return `${groupe} (CDS)`;
  if (estFq(code)) return `${groupe} (FQ)`;

  const filieres = filieresParGroupe?.get(groupe);
  if (filieres && filieres.size > 1) {
    const prefixe = prefixeFiliere(code);
    if (prefixe !== '') return `${groupe} (${prefixe})`;
  }

  return groupe;
}

/**
 * Renomme l'ensemble des groupes d'un import et en extrait les listes.
 *
 * @param {Array<{groupe: string, codeFiliere: string, fusion?: string, mode?: string}>} lignes
 * @returns {{groupes: string[], fusionGroupes: string[], groupeModes: Record<string, string>}}
 */
export function construireGroupes(lignes) {
  if (!Array.isArray(lignes)) {
    throw new TypeError('construireGroupes attend un tableau de lignes');
  }

  const filieresParGroupe = indexerFilieresParGroupe(lignes);

  const groupes = new Set();
  const fusionGroupes = new Set();
  const groupeModes = {};

  for (const ligne of lignes) {
    const groupe = renommerGroupe(ligne.groupe, ligne.codeFiliere, filieresParGroupe);
    if (groupe === '') continue;

    groupes.add(groupe);

    // Le groupe fusionné n'est PAS renommé : il porte déjà son propre nom dans
    // le fichier, et sert de clé de regroupement pour les cours synchrones.
    const fusion = String(ligne.fusion ?? '').trim();
    if (fusion !== '') fusionGroupes.add(fusion);

    const mode = String(ligne.mode ?? '').trim();
    if (mode !== '') {
      // « dernier gagne » : conforme à l'existant, où chaque ligne écrase la
      // précédente pour un même groupe.
      groupeModes[groupe] = /ALT/i.test(mode) ? 'Alterné' : 'Résidentiel';
    }
  }

  return {
    // Tri par octets, comme le `sort()` de PHP : les noms sont en ASCII, les
    // deux ordres coïncident.
    groupes: [...groupes].sort(),
    fusionGroupes: [...fusionGroupes].sort(),
    groupeModes,
  };
}
