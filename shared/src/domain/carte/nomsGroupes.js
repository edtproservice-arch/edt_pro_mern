/**
 * Nommage des groupes de la carte d'établissement.
 * ← public/assets/js/affectation-carte.js:414-560, 613-720
 *
 * Le nom d'un groupe n'est pas décoratif : c'est la CLÉ qui relie une séance,
 * une affectation et un avancement. Deux filières qui produisent le même nom
 * mélangent leurs emplois du temps, et un nom qui change rétroactivement fait
 * disparaître les séances déjà planifiées. D'où les règles ci-dessous, reprises
 * telles quelles.
 *
 * Forme d'un nom : PRÉFIXE + (année × 100 + rang) + suffixes.
 *   DEVOWFS_S, année 2, 3 groupes → DEV201, DEV202, DEV203
 */

/** Niveaux qui peuvent occuper le second segment d'un code à deux segments. */
const NIVEAUX = ['TS', 'T', 'FQ', 'S', 'CQ', 'B', 'AP'];

/**
 * Préfixe d'un nom de groupe, déduit du code filière DRIF.
 * ← extractFiliereCodePrefix()
 *
 * ⚠️ À ne pas confondre avec `prefixeFiliere` de `domain/enote`, qui rend le
 * PREMIER segment. L'existant portait les deux règles sous deux noms très
 * proches — `extractFiliereCodePrefix` et `extractFilierePrefix` — dans le même
 * fichier. Les noms sont ici explicitement distincts.
 *
 * Trois segments ou plus  → deuxième segment  (GE_GE_TS → GE)
 * Deux segments           → celui qui n'est pas un niveau  (DEVOWFS_S → DEVOWFS)
 * Aucun séparateur        → quatre premiers caractères alphanumériques
 */
export function prefixeNomGroupe(codeFiliere) {
  const code = String(codeFiliere ?? '').trim();
  if (!code) return 'GRP';

  const segments = code.split('_');

  if (segments.length >= 3) return segments[1].toUpperCase();

  if (segments.length === 2) {
    const second = segments[1].toUpperCase();
    return NIVEAUX.includes(second) ? segments[0].toUpperCase() : second;
  }

  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'GRP';
}

/** Code secteur d'une filière : son premier segment. ← codeSecteurDeFiliere() */
export function codeSecteur(codeFiliere) {
  const premier = String(codeFiliere ?? '').split('_')[0] ?? '';
  return premier.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Filière de cours du soir ? Son code officiel se termine par « _RCDS ».
 * ← estCoursDuSoir()
 *
 * Ses groupes portent « (CDS) », comme le fait déjà l'import e-note : même
 * filière, même année que le cours du jour, mais séances et formateurs
 * différents. Sans ce suffixe les deux se confondraient.
 */
export function estCoursDuSoir(codeFiliere) {
  return /_RCDS$/i.test(String(codeFiliere ?? '').trim());
}

/** Nom sans ses suffixes entre parenthèses. « BECM101 (CDS) (GM) » → « BECM101 ». */
export function sansSuffixe(nom) {
  return String(nom ?? '')
    .replace(/(\s*\([^()]*\))+\s*$/, '')
    .trim();
}

/** Préfixe alphabétique d'un nom de groupe. « GE101 (FGT) » → « GE ». */
export function prefixeDuNom(nom) {
  const base = sansSuffixe(nom);
  const trouve = /^([A-Za-zÀ-ÿ]+)/.exec(base);
  return trouve ? trouve[1].toUpperCase() : base.toUpperCase();
}

/**
 * Suffixe complet d'un nom de groupe.
 * ← suffixeNomGroupe()
 *
 * `(CDS)` pour le cours du soir, puis le code secteur quand deux filières se
 * disputent le même préfixe : GE_GE_TS, FGT_GE_TS et GC_GE_TS donnent tous
 * « GE » — trois filières de secteurs différents, un seul nom de groupe.
 */
export function suffixeGroupe(codeFiliere, { desambiguiser = false } = {}) {
  let suffixe = estCoursDuSoir(codeFiliere) ? ' (CDS)' : '';
  if (desambiguiser) {
    const secteur = codeSecteur(codeFiliere);
    if (secteur) suffixe += ` (${secteur})`;
  }
  return suffixe;
}

/**
 * Filières déjà dans la carte qui utilisent le même préfixe.
 * ← filieresEnConflitDePrefixe()
 *
 * @param {Array<{nom: string, codeFiliere: string}>} groupesExistants
 * @returns {Map<string, string[]>} code filière → noms de groupes concernés
 */
export function conflitsDePrefixe(prefixe, codeFiliere, groupesExistants = []) {
  const conflits = new Map();

  for (const groupe of groupesExistants) {
    const code = groupe?.codeFiliere ?? '';
    if (!groupe?.nom || code === codeFiliere) continue;
    if (prefixeDuNom(groupe.nom) !== prefixe) continue;

    if (!conflits.has(code)) conflits.set(code, []);
    conflits.get(code).push(groupe.nom);
  }

  return conflits;
}

/**
 * Noms des groupes à créer pour une filière et une année.
 * ← la boucle de generateGroupsAndModules()
 *
 * ⚠️ La numérotation REPREND après les groupes déjà présents de la même filière
 * et de la même année. Sans cela, générer un second groupe rend le nom du
 * premier — et le remplace au lieu de s'y ajouter. C'est ce qui empêchait de
 * créer un groupe résidentiel et un groupe alterné dans la même filière : les
 * deux s'appelaient GM101, le second écrasait le premier.
 *
 * @returns {{noms: string[], prefixe: string, suffixe: string,
 *            conflits: Map<string, string[]>, depart: number}}
 */
export function genererNomsGroupes({
  codeFiliere,
  anneeFormation,
  nombre = 1,
  groupesExistants = [],
}) {
  const nb = Number(nombre);
  if (!Number.isInteger(nb) || nb < 1 || nb > 20) {
    throw new TypeError('genererNomsGroupes attend un nombre de groupes entre 1 et 20');
  }

  const prefixe = prefixeNomGroupe(codeFiliere);
  const conflits = conflitsDePrefixe(prefixe, codeFiliere, groupesExistants);
  const suffixe = suffixeGroupe(codeFiliere, { desambiguiser: conflits.size > 0 });

  const annee = Number.parseInt(anneeFormation, 10) || 1;
  const base = annee * 100;

  const depart = prochainRang(groupesExistants, { codeFiliere, prefixe, base });

  const noms = [];
  for (let rang = depart; rang < depart + nb; rang += 1) {
    noms.push(`${prefixe}${base + rang}${suffixe}`);
  }

  return { noms, prefixe, suffixe, conflits, depart };
}

/**
 * Premier rang libre, d'après les groupes déjà créés pour CETTE filière.
 *
 * Seule la même filière fait avancer le compteur : deux filières qui partagent
 * un préfixe (GE_GE_TS et FGT_GE_TS) sont déjà séparées par leur suffixe de
 * désambiguïsation, « GE101 (GE) » et « GE101 (FGT) » ne se confondent pas.
 */
function prochainRang(groupesExistants, { codeFiliere, prefixe, base }) {
  let maximum = 0;

  for (const groupe of groupesExistants) {
    if ((groupe?.codeFiliere ?? '') !== codeFiliere) continue;

    const nom = sansSuffixe(groupe?.nom);
    if (prefixeDuNom(nom) !== prefixe) continue;

    const numero = Number.parseInt(nom.slice(prefixe.length), 10);
    if (!Number.isInteger(numero)) continue;

    // La centaine porte l'année : GM201 appartient à l'année 2, pas au rang 101
    // de l'année 1. Hors de sa centaine, un numéro ne compte pas.
    const rang = numero - base;
    if (rang >= 1 && rang <= 99 && rang > maximum) maximum = rang;
  }

  return maximum + 1;
}

/**
 * Renomme les groupes d'une filière homonyme en leur ajoutant son code secteur.
 * ← desambiguiserFilieresExistantes()
 *
 * Seuls les noms SANS suffixe sont touchés : un groupe déjà désambiguïsé ne
 * doit pas recevoir un second suffixe — c'est le défaut « ACADA101 (FQ) (FQ) »
 * relevé en Phase 2, qui rend le groupe introuvable et fait disparaître ses
 * séances.
 *
 * @returns {Array<{ancien: string, nouveau: string}>}
 */
export function renommagesDesambiguisation(conflits) {
  const renommages = [];

  for (const [code, noms] of conflits) {
    const secteur = codeSecteur(code);
    if (!secteur) continue;

    for (const nom of noms) {
      if (/\s*\([^()]*\)\s*$/.test(nom)) continue;
      renommages.push({ ancien: nom, nouveau: `${nom} (${secteur})` });
    }
  }

  return renommages;
}

/**
 * Nom « brut » à écrire dans la colonne Groupe d'une ligne e-note.
 * ← nomGroupeBrut()
 *
 * Les suffixes que l'import RECALCULE à partir du code filière sont retirés :
 * les laisser les ferait ajouter une seconde fois. Un suffixe de
 * désambiguïsation, lui, n'est pas déductible du code seul — il reste.
 */
export function nomGroupeBrut(nom, codeFiliere) {
  const complet = String(nom ?? '').trim();
  const code = String(codeFiliere ?? '')
    .trim()
    .toUpperCase();

  const trouve = /^(.*?)\s+\(([^()]+)\)$/.exec(complet);
  if (!trouve) return complet;

  const base = trouve[1].trim();
  const suffixe = trouve[2].trim().toUpperCase();
  if (!base) return complet;

  if (suffixe === 'CDS' && code.endsWith('CDS')) return base;
  if (suffixe === 'FQ' && code.endsWith('FQ')) return base;

  // Ici c'est bien le PREMIER segment — `extractFilierePrefix` dans l'existant,
  // et non `extractFiliereCodePrefix`. Prendre le préfixe du nom de groupe à sa
  // place laisserait passer « GE101 (GE) » avec son suffixe, que l'import
  // ajouterait alors une seconde fois.
  if (suffixe === (code.split('_')[0] || code)) return base;

  return complet;
}
