/**
 * Écrire un nom DROIT dans une colonne étroite.
 * (demande du porteur, 2026-09-02 : « ne mets pas les noms des formateurs et
 * groupes en biais — si le nom est long, retourne à la ligne ou bien diminue sa
 * taille ».)
 *
 * ═══ ⚠️ POURQUOI C'ÉTAIT EN BIAIS, ET POURQUOI ÇA NE L'EST PLUS ═══
 * Un texte incliné à -45° ou vertical a une longueur ILLIMITÉE : il déborde sur
 * la marge basse au lieu de déborder sur ses voisins, et « ABDELGHANI LAASAL »
 * tient d'un trait. Le prix en est la lecture — on penche la tête — et la place :
 * 120 px de marge sous l'axe, prise sur le tracé.
 *
 * Droit, un nom doit tenir dans la largeur d'une colonne — 44 px. Deux leviers,
 * et le porteur les nomme tous les deux : le RETOUR À LA LIGNE, puis la TAILLE.
 *
 * ═══ ⚠️ ON NE CASSE PAS UN MOT TANT QU'ON PEUT RÉTRÉCIR ═══
 * « ABDELGHA / NI / LAASAL » est illisible ; « ABDELGHANI / LAASAL » à 7 px se
 * lit. On essaie donc les tailles de la plus grande à la plus petite, et on ne
 * coupe un mot qu'en tout dernier recours.
 *
 * ═══ ⚠️ UNE SEULE TAILLE POUR TOUT L'AXE ═══
 * Calculée sujet par sujet, elle donnerait « M101 » en 10 px à côté de
 * « ABDELGHANI LAASAL » en 7 px : une rangée de libellés de tailles différentes
 * se lit comme un défaut d'affichage, pas comme un ajustement. On retient donc
 * la plus grande taille à laquelle TOUS les noms tiennent.
 */

/**
 * Largeur d'un caractère, en fraction de la taille de police.
 *
 * ═══ ⚠️ MESURÉE SUR LES VRAIS NOMS, PAS SUR UNE MOYENNE ═══
 * La valeur héritée (5,2 px à 9 px, soit 0,578) venait d'une chaîne riche en
 * chiffres — les plus étroits de la police. Relevée dans le navigateur sur les
 * libellés réellement affichés : « GM101, GM1 » 0,574 · « ACADA101 » 0,626 ·
 * « OPCM102 +5 » 0,622 · « DEVOWFS101 » 0,643 · « ABDELGHANI » 0,657 ·
 * « MERYEM » 0,718. Les NOMS, tout en capitales, sont donc bien plus larges que
 * les codes — et c'est 0,578 qui laissait trois libellés se chevaucher.
 *
 * ⚠️ ON PREND 0,66, PAS LE PIRE CAS : « MMMMMMMMMM » monte à 0,90, mais aucun
 * nom réel n'est fait que de M. Viser le pire imposerait une police minuscule à
 * tout le monde pour un cas qui n'existe pas.
 */
const RATIO_CARACTERE = 0.66;

/** Combien de caractères tiennent sur une ligne, à cette taille. */
export const capacite = (largeur, taille) =>
  Math.max(1, Math.floor(largeur / (taille * RATIO_CARACTERE)));

/**
 * Le texte réparti en lignes — `null` s'il faudrait CASSER un mot ou dépasser
 * `lignesMax`. C'est ce `null` qui fait descendre d'un cran de taille.
 */
export function lignesDe(texte, { largeur, taille, lignesMax = 2 }) {
  const mots = String(texte ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (mots.length === 0) return [];

  const max = capacite(largeur, taille);
  const lignes = [];
  let courante = '';

  for (const mot of mots) {
    if (mot.length > max) return null; // il faudrait le couper : on rétrécira

    if (courante === '') courante = mot;
    else if (courante.length + 1 + mot.length <= max) courante += ` ${mot}`;
    else {
      lignes.push(courante);
      courante = mot;
    }
  }

  lignes.push(courante);
  return lignes.length <= lignesMax ? lignes : null;
}

/**
 * La plus grande taille à laquelle TOUS les textes tiennent — `tailleMin` si
 * aucune ne convient (le rendu coupera alors, cf. `lignesForcees`).
 */
export function tailleCommune(textes, { largeur, tailleMax = 10, tailleMin = 7, lignesMax = 2 }) {
  const utiles = textes.filter((t) => typeof t === 'string' && t.trim() !== '');
  if (utiles.length === 0) return tailleMax;

  for (let taille = tailleMax; taille >= tailleMin; taille -= 0.5) {
    if (utiles.every((texte) => lignesDe(texte, { largeur, taille, lignesMax }) !== null)) {
      return taille;
    }
  }

  return tailleMin;
}

/**
 * Le dernier recours : on coupe dans les mots et on tronque, plutôt que de
 * laisser un texte déborder sur les colonnes voisines.
 *
 * ⚠️ L'ELLIPSE EST INDISPENSABLE : un nom tronqué sans elle se lit comme un nom
 * COMPLET, et « ABDELGHANI LAASA » passerait pour l'orthographe exacte.
 */
export function lignesForcees(texte, { largeur, taille, lignesMax = 2 }) {
  const max = capacite(largeur, taille);
  const propre = String(texte ?? '').trim();
  if (propre === '') return [];

  const lignes = [];
  let reste = propre;

  while (reste !== '' && lignes.length < lignesMax) {
    /* ⚠️ `trimEnd` : couper au caractère près laisse une espace en fin de ligne,
       qui décale le centrage d'un demi-caractère. */
    lignes.push(reste.slice(0, max).trimEnd());
    reste = reste.slice(max);
  }

  if (reste !== '') {
    const derniere = lignes[lignes.length - 1];
    lignes[lignes.length - 1] = `${derniere.slice(0, Math.max(0, max - 1))}…`;
  }

  return lignes;
}

/** Ce qu'on écrit, à coup sûr : la répartition propre, ou le repli tronqué. */
export function decouper(texte, options) {
  return lignesDe(texte, options) ?? lignesForcees(texte, options);
}

/** L'écart d'une ligne à la suivante — assez pour que deux lignes ne se touchent pas. */
export const interligne = (taille) => taille + 2;
