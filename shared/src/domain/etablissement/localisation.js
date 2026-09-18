/**
 * Où se trouve un établissement — sa ville, et ses coordonnées.
 *
 * ═══ ⚠️ POURQUOI DÉDUIRE PLUTÔT QUE DEMANDER ═══
 * `Etablissement` ne porte NI ville NI coordonnées : il a `region`, `complexe`
 * et `nom`. Ajouter un champ obligerait chaque établissement déjà configuré à
 * repasser par un écran de réglages pour une icône. Or la ville est presque
 * toujours DANS le nom — « Centre de Formation dans les métiers du Bâtiment
 * **Fes** » — et c'est déjà ce que `nomAbrege` exploite pour la retirer du nom
 * abrégé. À défaut, la région donne sa capitale : toutes deux sont en nombre
 * fini et connu.
 *
 * ⚠️ UNE TABLE PLUTÔT QU'UNE API DE GÉOCODAGE : les villes marocaines qui
 * portent un EFP tiennent en une trentaine d'entrées, elles ne bougent pas, et
 * un second appel réseau ajouterait un mode de panne pour une donnée constante.
 */

/** Sans accent ni apostrophe, en minuscules — la forme de comparaison. */
export const normaliserLieu = (texte) =>
  String(texte ?? '')
    .normalize('NFD')
    /* `\p{Diacritic}` plutot qu'une plage ecrite en marques combinantes :
       celles-ci sont invisibles a la relecture, et le moindre outil qui recode
       le fichier les efface sans bruit. */
    .replace(/\p{Diacritic}/gu, '')
    .replace(/['’]/gu, '')
    .toLowerCase();

/**
 * Coordonnées des villes marocaines qui accueillent un établissement.
 *
 * ⚠️ LES CLÉS SONT COLLÉES (`benimellal`) : un nom de ville en deux mots doit
 * pouvoir être reconnu dans un nom d'établissement où il est écrit en deux
 * mots — c'est l'appariement qui recolle, pas la table qui se dédouble.
 */
export const COORDONNEES = {
  agadir: { latitude: 30.42, longitude: -9.6 },
  benimellal: { latitude: 32.34, longitude: -6.36 },
  berrechid: { latitude: 33.27, longitude: -7.59 },
  casablanca: { latitude: 33.57, longitude: -7.59 },
  dakhla: { latitude: 23.68, longitude: -15.96 },
  eljadida: { latitude: 33.25, longitude: -8.51 },
  errachidia: { latitude: 31.93, longitude: -4.42 },
  essaouira: { latitude: 31.51, longitude: -9.77 },
  fes: { latitude: 34.04, longitude: -5.0 },
  guelmim: { latitude: 28.99, longitude: -10.06 },
  kenitra: { latitude: 34.26, longitude: -6.58 },
  khouribga: { latitude: 32.88, longitude: -6.91 },
  laayoune: { latitude: 27.15, longitude: -13.2 },
  marrakech: { latitude: 31.63, longitude: -8.01 },
  meknes: { latitude: 33.9, longitude: -5.55 },
  mohammedia: { latitude: 33.69, longitude: -7.38 },
  nador: { latitude: 35.17, longitude: -2.93 },
  ouarzazate: { latitude: 30.93, longitude: -6.94 },
  oujda: { latitude: 34.68, longitude: -1.91 },
  rabat: { latitude: 34.02, longitude: -6.84 },
  safi: { latitude: 32.3, longitude: -9.24 },
  sale: { latitude: 34.05, longitude: -6.8 },
  settat: { latitude: 33.0, longitude: -7.62 },
  tanger: { latitude: 35.77, longitude: -5.8 },
  taza: { latitude: 34.21, longitude: -4.01 },
  temara: { latitude: 33.93, longitude: -6.91 },
  tetouan: { latitude: 35.58, longitude: -5.37 },
};

/**
 * Les douze régions et leur chef-lieu — le repli quand le nom ne dit rien.
 *
 * ⚠️ UNE RÉGION N'EST PAS UN POINT : on prend son chef-lieu, faute de mieux.
 * L'écart avec la ville réelle se compte en dizaines de kilomètres, ce qui est
 * sans conséquence pour une icône de météo — et infiniment préférable à ne rien
 * afficher.
 */
export const CHEFS_LIEUX = {
  'tanger-tetouan-al hoceima': 'tanger',
  'tanger-tetouan-alhoceima': 'tanger',
  oriental: 'oujda',
  "l'oriental": 'oujda',
  'fes-meknes': 'fes',
  'rabat-sale-kenitra': 'rabat',
  'beni mellal-khenifra': 'benimellal',
  'benimellal-khenifra': 'benimellal',
  'casablanca-settat': 'casablanca',
  'marrakech-safi': 'marrakech',
  'draa-tafilalet': 'errachidia',
  'souss-massa': 'agadir',
  'guelmim-oued noun': 'guelmim',
  'laayoune-sakia el hamra': 'laayoune',
  'dakhla-oued ed dahab': 'dakhla',
  'dakhla-oued eddahab': 'dakhla',
};

/**
 * La ville d'un établissement, puis ses coordonnées.
 *
 * ⚠️ LE NOM D'ABORD, LA RÉGION ENSUITE : « ISTA NTIC Sidi Maârouf **Casablanca** »
 * est plus précis que « Casablanca-Settat », et une région couvre plusieurs
 * villes. On ne retombe sur le chef-lieu que faute de mieux.
 *
 * @returns {{ville: string, latitude: number, longitude: number}|null}
 *   `null` quand rien n'est reconnu — l'appelant s'en passe alors, il ne devine
 *   pas : une météo affichée pour une ville qui n'est pas la bonne est pire
 *   qu'une absence de météo.
 */
export function localiserEtablissement({ nom, region } = {}) {
  const ville = villeDuNom(nom) ?? CHEFS_LIEUX[normaliserLieu(region)] ?? null;
  if (!ville) return null;

  const point = COORDONNEES[ville];
  return point ? { ville, ...point } : null;
}

/**
 * La première ville reconnue dans un nom d'établissement.
 *
 * ⚠️ ON ESSAIE AUSSI LES PAIRES DE MOTS : « Beni Mellal » n'est une ville qu'une
 * fois recollé. Sans cela, seules les villes d'un seul mot seraient reconnues —
 * et « Beni » seul ne veut rien dire.
 */
function villeDuNom(nom) {
  const mots = normaliserLieu(nom)
    .split(/[\s-]+/u)
    .filter((mot) => mot !== '');

  for (let index = 0; index < mots.length; index += 1) {
    const paire = mots[index] + (mots[index + 1] ?? '');
    if (COORDONNEES[paire]) return paire;
    if (COORDONNEES[mots[index]]) return mots[index];
  }

  return null;
}
