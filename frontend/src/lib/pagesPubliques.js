/**
 * Les pages qu'on ouvre SANS session : il n'y a rien à expirer, et un 401 n'y est pas
 * une déconnexion mais l'état normal d'un visiteur.
 *
 * ⚠️ UNE SEULE LISTE, lue par tout ce qui pourrait renvoyer un visiteur à la porte :
 * la redirection d'expiration (`gererExpirationsession`) et le battement de cœur.
 * Elle doit suivre les routes publiques de `App.jsx` — une page publique oubliée ici
 * fait rebondir le visiteur vers la connexion, sans un mot, quelques secondes après
 * son arrivée.
 */
export const PAGES_PUBLIQUES = [
  '/connexion',
  '/inscription',
  '/verification',
  '/mot-de-passe-oublie',
  '/reinitialisation',
  '/essai',
];

/** Ce chemin est-il celui d'une page publique ? (`/verification?email=…` : le chemin seul.) */
export function estPagePublique(chemin) {
  const propre = String(chemin ?? '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return PAGES_PUBLIQUES.some((page) => propre === page || propre.startsWith(`${page}/`));
}
