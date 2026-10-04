/**
 * ⚠️ ANTI-ÉCHO du guidage à double sens (2026-10-04).
 *
 * Quand l'écran suit l'autre — il change de page, il défile —, ce mouvement
 * n'est pas un geste de CET utilisateur : le renvoyer ferait rebondir la même
 * navigation d'un écran à l'autre. Les clics et saisies rejoués n'en ont pas
 * besoin : ils sont synthétiques (`isTrusted === false`) et déjà écartés.
 */
let cheminAttendu = null;
let defilementApplique = 0;

/** Marque la navigation qu'on s'apprête à faire pour suivre l'autre écran. */
export function noterCheminRecu(chemin) {
  cheminAttendu = chemin;
}

/** Vrai — une seule fois — si ce chemin est celui qu'on vient de suivre. */
export function cheminRecu(chemin) {
  if (cheminAttendu !== chemin) return false;
  cheminAttendu = null;
  return true;
}

export function noterDefilementRecu() {
  defilementApplique = Date.now();
}

/** Un défilement dans la foulée d'un défilement reçu en est la conséquence. */
export const defilementRecu = () => Date.now() - defilementApplique < 250;
