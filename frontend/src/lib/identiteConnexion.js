/**
 * L'identifiant de la connexion temps réel de CET onglet.
 *
 * Le serveur le donne à l'ouverture de la socket, et `apiClient` le renvoie
 * dans l'en-tête `X-Connexion-Id` de chaque requête. C'est ce qui permet au
 * serveur d'écarter l'onglet auteur d'une écriture quand il l'annonce aux
 * autres : cet onglet relit déjà sa grille, une seconde relecture ne servirait
 * à rien.
 *
 * ⚠️ UN MODULE À PART, et c'est pour éviter un cycle : le client temps réel a
 * besoin d'`apiClient` (pour rafraîchir la session), et `apiClient` a besoin de
 * cet identifiant. Les deux importent ce module-ci, qui n'importe rien.
 */
let connexionId = null;

export const lireConnexionId = () => connexionId;

export function definirConnexionId(valeur) {
  connexionId = valeur ?? null;
}
