/**
 * Positions des curseurs dans la grille — calcul pur, sans DOM.
 *
 * ═══ ⚠️ UNE POSITION RELATIVE À UNE CASE, JAMAIS EN PIXELS ═══
 * Deux personnes n'ont ni la même largeur d'écran, ni le même zoom, ni la même
 * barre latérale ouverte. Un curseur envoyé en pixels tomberait deux colonnes à
 * côté chez l'autre. On envoie donc la CASE survolée et la fraction de sa
 * largeur et de sa hauteur ; chaque écran la reprojette sur SA grille.
 */

/** Le rectangle qui englobe les trois lignes (groupe, module, salle) d'une case. */
export function englober(rectangles) {
  if (rectangles.length === 0) return null;
  const gauche = Math.min(...rectangles.map((r) => r.left));
  const haut = Math.min(...rectangles.map((r) => r.top));
  const droite = Math.max(...rectangles.map((r) => r.right));
  const bas = Math.max(...rectangles.map((r) => r.bottom));
  return { left: gauche, top: haut, width: droite - gauche, height: bas - haut };
}

const borner = (valeur) => Math.min(1, Math.max(0, valeur));

/**
 * Où tombe le pointeur DANS la case, en fractions bornées à [0, 1] — le
 * serveur refuse le reste, et une case de largeur nulle rend le centre.
 */
export function fractionDansCase(boite, x, y) {
  if (!boite) return null;
  return {
    x: boite.width > 0 ? Number(borner((x - boite.left) / boite.width).toFixed(3)) : 0.5,
    y: boite.height > 0 ? Number(borner((y - boite.top) / boite.height).toFixed(3)) : 0.5,
  };
}

/**
 * La part d'une case qui reste VISIBLE dans une zone `{left, right, top, bottom}`
 * — `null` s'il n'en reste rien. Sans zone, la case entière.
 */
export function rognerBoite(boite, zone) {
  if (!boite) return null;
  if (!zone) return boite;
  const gauche = Math.max(boite.left, zone.left);
  const droite = Math.min(boite.left + boite.width, zone.right);
  const haut = Math.max(boite.top, zone.top);
  const bas = Math.min(boite.top + boite.height, zone.bottom);
  if (droite <= gauche || bas <= haut) return null;
  return { left: gauche, top: haut, width: droite - gauche, height: bas - haut };
}

/** Reprojette une fraction sur la case chez soi, relativement au conteneur. */
export function pointDansConteneur(boite, conteneur, { x, y }) {
  if (!boite || !conteneur) return null;
  return {
    left: boite.left - conteneur.left + x * boite.width,
    top: boite.top - conteneur.top + y * boite.height,
  };
}

/**
 * Un curseur ne se montre que s'il désigne la MÊME grille que la sienne.
 * ⚠️ La clé d'une case porte le matricule en vue par formateur, le groupe en vue
 * par groupe : sur deux axes différents, la même clé ne désigne rien — ou pire,
 * une autre case.
 */
export function memeVue(position, vue) {
  return Boolean(
    position &&
      vue &&
      position.semaine === vue.semaine &&
      position.periode === vue.periode &&
      position.axe === vue.axe
  );
}

/** Le prénom et l'initiale du nom : une étiquette de curseur tient en une ligne. */
export function etiquetteCurseur(nom) {
  const mots = String(nom ?? '').trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return '?';
  if (mots.length === 1) return mots[0];
  const [premier, ...reste] = mots;
  return `${premier[0]}${premier.slice(1).toLowerCase()} ${reste.at(-1)[0]}.`;
}
