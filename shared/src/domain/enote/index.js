/**
 * Lecture de la base e-note.
 *
 * ← includes/parse_base_rows.php + includes/functions.php
 *
 * C'est le module F4 du plan, classé en risque **critique** : un import qui
 * produit des identifiants différents de ceux déjà en base casse rétroactivement
 * tous les emplois du temps saisis.
 *
 * Chaque règle portée ici est vérifiée par un test de caractérisation rejouant
 * l'implémentation PHP sur les données réelles de production — 24 imports,
 * 139 noms de groupes, 522 combinaisons d'heures.
 */

export {
  retirerSuffixe,
  prefixeFiliere,
  renommerGroupe,
  construireGroupes,
} from './suffixesGroupes.js';

export { massesHoraires, arrondir, COLONNES_MASSES } from './massesHoraires.js';

export { construireBase, cleGroupeLigne, emailDeduit } from './parseBase.js';
export { COLONNES, ENTETES_ENOTE, indexColonne, resoudreColonnes } from './colonnes.js';
