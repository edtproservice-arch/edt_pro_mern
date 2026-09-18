import { nomBase, prenom } from './nomBase.js';

/**
 * Résolution des homonymes : deux formateurs partageant le même nom de base
 * reçoivent un préfixe de prénom qui les distingue.
 *
 *   AHMED CHERKAOUI  ┐
 *   AMINE CHERKAOUI  ┘ →  « AH CHERKAOUI » et « AM CHERKAOUI »
 *
 * ═══ IMPLÉMENTATION UNIQUE ═══
 * Remplace `resolveNameConflicts()` (includes/functions.php:101) et
 * `pb_resolveNameConflicts()` (includes/parse_base_rows.php:53), qui faisaient
 * la même chose sous deux noms — et écrivaient leur résultat dans deux champs
 * différents (`nom` et `nom_unique`), ce qui obligeait chaque appelant à savoir
 * lequel il manipulait.
 *
 * Caractérisation : les deux implémentations donnent des résultats IDENTIQUES
 * sur les 4 groupes réels (79 formateurs, 2 établissements, 2 années scolaires).
 * Le portage est donc sûr — c'est l'un des rares endroits où l'existant était
 * cohérent avec lui-même.
 *
 * ⚠️ UN DÉFAUT CORRIGÉ, à connaître
 * La boucle PHP d'élargissement du préfixe ne termine pas dans un cas : si deux
 * formateurs partagent le même nom de base ET les 4 premières lettres de leur
 * prénom, `$prefixLength` est incrémenté puis ramené à `min(4, len)` — donc à 4
 * — et la condition de boucle reste vraie. Le processus PHP part alors en
 * boucle infinie. Le cas ne se présente pas dans les données actuelles, mais
 * rien ne l'empêche (« MOHAMMED ALAMI » et « MOHAMMED ALAOUI » suffisent).
 * Ici, la boucle est bornée : au-delà, on garde le préfixe le plus long
 * disponible, quitte à ce que deux entrées restent identiques — un doublon
 * visible vaut mieux qu'un serveur figé.
 */

const PREFIXE_MINIMUM = 2;
const PREFIXE_MAXIMUM = 4;

/**
 * @param {Array<{nomComplet: string, matricule?: string}>} formateurs
 * @returns {Array<{nomComplet: string, matricule?: string, nomUnique: string}>}
 *   Même ordre qu'en entrée, enrichi de `nomUnique`.
 */
export function resoudreHomonymes(formateurs) {
  if (!Array.isArray(formateurs)) {
    throw new TypeError('resoudreHomonymes attend un tableau');
  }

  // Regroupement par nom de base : c'est lui qui crée l'homonymie.
  const parNomBase = new Map();

  formateurs.forEach((formateur, index) => {
    const nomComplet = formateur?.nomComplet ?? '';
    const base = nomBase(nomComplet);

    if (!parNomBase.has(base)) parNomBase.set(base, []);
    parNomBase.get(base).push({ index, prenom: prenom(nomComplet), formateur });
  });

  const resultat = new Array(formateurs.length);

  for (const [base, groupe] of parNomBase) {
    // Cas courant : un seul porteur de ce nom, aucun préfixe nécessaire.
    if (groupe.length === 1) {
      const { index, formateur } = groupe[0];
      resultat[index] = { ...formateur, nomUnique: base };
      continue;
    }

    for (const membre of groupe) {
      const longueur = longueurPrefixeDistinctive(membre, groupe);
      const prefixe = membre.prenom.slice(0, longueur);

      resultat[membre.index] = {
        ...membre.formateur,
        nomUnique: prefixe ? `${prefixe} ${base}` : base,
      };
    }
  }

  return resultat;
}

/**
 * Plus court préfixe de prénom (2 à 4 lettres) qui distingue ce membre des
 * autres du groupe. Reproduit l'élargissement progressif de l'existant, mais
 * borné — voir la note sur la boucle infinie en tête de fichier.
 */
function longueurPrefixeDistinctive(membre, groupe) {
  const maximum = Math.min(PREFIXE_MAXIMUM, membre.prenom.length);

  for (let longueur = PREFIXE_MINIMUM; longueur <= maximum; longueur += 1) {
    const prefixe = membre.prenom.slice(0, longueur);

    const collision = groupe.some(
      (autre) => autre.index !== membre.index && autre.prenom.slice(0, longueur) === prefixe
    );

    if (!collision) return longueur;
  }

  // Aucun préfixe ne sépare ces prénoms : on prend le plus long disponible.
  // L'existant bouclait indéfiniment dans ce cas.
  return Math.max(PREFIXE_MINIMUM, maximum);
}
