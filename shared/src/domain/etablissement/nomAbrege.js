/**
 * Propositions de nom abrégé pour un établissement.
 *
 * ═══ POURQUOI PLUSIEURS, ET PAS UNE ═══
 * Ma première version tronquait les mots significatifs à 30 caractères et
 * rendait « PROFESSIONNELLE HASSANIA DANS » — une coupure au milieu d'une
 * phrase, ni un sigle ni un nom. Aucune règle unique ne convient : un
 * établissement se désigne tantôt par son sigle, tantôt par son quartier,
 * tantôt par les deux. On propose donc quelques formes, et le directeur choisit
 * celle qui correspond à l'usage de sa maison.
 *
 * ═══ LA RÈGLE PRINCIPALE ═══
 * Les mots ADMINISTRATIFS se réduisent à leur initiale, les mots DISTINCTIFS
 * restent entiers :
 *
 *   CENTRE DE FORMATION PROFESSIONNELLE HASSANIA DANS LES METIERS DE GESTION
 *   ET DU DIGITAL CASABLANCA
 *     → C F P  ·  HASSANIA  ·  M G D  ·  CASABLANCA
 *     → « CFP MGD HASSANIA »
 *
 * Les initiales se regroupent en sigles, les noms propres passent après : c'est
 * ce qui distingue « CFP MGD HASSANIA » de « CFP HASSANIA MGD », illisible.
 */

/** Longueur maximale — même borne que `nomAbregeSchema` côté serveur. */
export const LONGUEUR_MAXIMALE = 30;

/** Mots de liaison : ils ne portent rien, pas même une initiale. */
const LIAISONS = new Set([
  'de', 'du', 'des', 'd', 'la', 'le', 'les', 'l', 'et', 'en', 'au', 'aux',
  'dans', 'pour', 'sur', 'a', 'à', 'par', 'avec',
]);

/**
 * Vocabulaire administratif de l'OFPPT : ces mots reviennent dans presque tous
 * les intitulés, donc ils ne distinguent rien — mais leur initiale, oui.
 */
const ADMINISTRATIFS = new Set([
  'centre', 'institut', 'ecole', 'école', 'complexe', 'etablissement', 'établissement',
  'formation', 'professionnelle', 'professionnel', 'specialise', 'spécialisé',
  'specialisee', 'spécialisée', 'technologie', 'appliquee', 'appliquée',
  'qualification', 'metiers', 'métiers', 'metier', 'métier',
  'gestion', 'digital', 'numerique', 'numérique', 'commerce', 'industrie',
  'batiment', 'bâtiment', 'agriculture', 'tourisme', 'sante', 'santé',
  'artisanat', 'textile', 'hotellerie', 'hôtellerie', 'transport', 'logistique',
]);

/*
 * Villes : elles ferment souvent l'intitulé sans le distinguer, parce que la
 * région et le complexe sont déjà affichés à côté. On propose donc une forme
 * SANS, et une AVEC — deux établissements de même nom dans deux villes
 * différentes ont besoin de la seconde.
 */
const VILLES = new Set([
  'casablanca', 'rabat', 'fes', 'fès', 'marrakech', 'tanger', 'agadir', 'meknes',
  'meknès', 'oujda', 'kenitra', 'kénitra', 'tetouan', 'tétouan', 'safi', 'sale',
  'salé', 'temara', 'témara', 'mohammedia', 'eljadida', 'jadida', 'nador',
  'settat', 'berrechid', 'khouribga', 'beni', 'mellal', 'taza', 'laayoune',
  'laâyoune', 'dakhla', 'errachidia', 'ouarzazate', 'essaouira', 'guelmim',
]);

const normaliser = (mot) => mot.toLowerCase().replace(/['’]/g, '');

/**
 * Découpe le nom en segments : suites d'initiales et mots distinctifs.
 * @returns {{sigles: string[], propres: string[]}}
 */
function decouper(nom) {
  const mots = String(nom ?? '')
    .split(/[\s-]+/)
    .filter((mot) => mot !== '');

  const sigles = [];
  const propres = [];
  let courant = '';

  for (const mot of mots) {
    const cle = normaliser(mot);
    if (cle === '' || LIAISONS.has(cle)) continue;

    if (ADMINISTRATIFS.has(cle)) {
      courant += mot[0].toUpperCase();
      continue;
    }

    // Un mot distinctif ferme le sigle en cours : « CFP » puis « HASSANIA »,
    // et non « CFPH ».
    if (courant !== '') {
      sigles.push(courant);
      courant = '';
    }
    propres.push(mot.toUpperCase());
  }

  if (courant !== '') sigles.push(courant);

  return { sigles, propres };
}

/**
 * Formes proposées, de la plus courte à la plus complète, sans doublon et
 * toutes dans la limite de longueur.
 *
 * @param {string} nom  Nom officiel de l'établissement.
 * @returns {string[]}  0 à 4 propositions.
 */
export function propositionsNomAbrege(nom) {
  const { sigles, propres } = decouper(nom);
  if (sigles.length === 0 && propres.length === 0) return [];

  /*
   * Ma première version prenait « les sigles + le PREMIER nom propre ». Elle
   * donnait bien « CFP MGD HASSANIA », mais coupait « HAY MOHAMMADI ANFA » en
   * « HAY » et réduisait « ISTA NTIC » à « ISTA » — un nom propre en plusieurs
   * mots n'est pas une liste de candidats. La ville est le seul mot qu'on
   * retire vraiment, et elle se reconnaît.
   */
  const sansVille = propres.filter((mot) => !VILLES.has(normaliser(mot)));

  const candidats = [
    // 1. Sigles + noms propres, sans la ville — la forme de l'exemple.
    [...sigles, ...sansVille],
    // 2. La même, ville comprise : elle distingue deux établissements
    //    homonymes de deux villes.
    [...sigles, ...propres],
    // 3. Les noms propres seuls, pour qui se désigne par son quartier.
    sansVille,
    propres,
    // 4. Le sigle seul.
    sigles,
  ];

  const vues = new Set();
  const propositions = [];

  for (const candidat of candidats) {
    const texte = candidat.filter(Boolean).join(' ').trim();
    if (texte === '' || texte.length > LONGUEUR_MAXIMALE) continue;
    if (vues.has(texte)) continue;

    vues.add(texte);
    propositions.push(texte);

    // Au-delà de quatre, la rangée de boutons devient un formulaire de choix
    // multiple : on montre les formes les plus courantes, pas toutes.
    if (propositions.length === 4) break;
  }

  return propositions;
}
