/**
 * Registre des salles — en mémoire, dans le processus.
 *
 * Une SALLE = une page d'un établissement pour une année scolaire. Deux
 * directeurs de deux EFP différents ne se croisent jamais : l'établissement
 * fait partie de la clé, et il a été résolu par `resoudreContexte`, jamais lu
 * tel que le client l'envoie.
 *
 * ⚠️ LA SALLE EST LA PAGE ENTIÈRE, PAS UNE SEMAINE. On veut voir qu'un collègue
 * est sur l'emploi du temps même s'il regarde une autre semaine — c'est ce que
 * fait Notion, où la présence est celle de la page. La semaine consultée voyage
 * dans la `vue` de chacun, et l'écran en tire « sur la même semaine que vous ».
 * Et une écriture sur une AUTRE semaine concerne tout le monde quand même : les
 * heures posées de l'année changent, donc les taux d'avancement des cases.
 */
export const cleSalle = (etablissementId, anneeScolaire, page) =>
  `${etablissementId}:${anneeScolaire}:${page}`;

export function creerRegistre() {
  /** cle → Set<connexion> */
  const salles = new Map();

  function ajouter(cle, connexion) {
    if (!salles.has(cle)) salles.set(cle, new Set());
    salles.get(cle).add(connexion);
  }

  function retirer(cle, connexion) {
    const membres = salles.get(cle);
    if (!membres) return;
    membres.delete(connexion);
    // Une salle vide disparaît : sans cela, le registre grossirait d'une entrée
    // par page jamais refermée, pendant toute la vie du processus.
    if (membres.size === 0) salles.delete(cle);
  }

  const connexionsDe = (cle) => [...(salles.get(cle) ?? [])];

  /**
   * La liste des présents, UNE ENTRÉE PAR PERSONNE.
   *
   * ⚠️ DEUX ONGLETS NE FONT PAS DEUX PRÉSENCES. Un directeur qui a la grille
   * ouverte deux fois apparaîtrait sinon deux fois dans la pile d'avatars, et on
   * croirait à un collègue. On garde la vue la PLUS RÉCENTE — c'est celle de
   * l'onglet où il travaille.
   */
  function presence(cle) {
    const parPersonne = new Map();

    for (const connexion of connexionsDe(cle)) {
      const etat = connexion.salles.get(cle);
      const existant = parPersonne.get(connexion.utilisateur.id);

      if (!existant || etat.misAJour > existant.misAJour) {
        parPersonne.set(connexion.utilisateur.id, {
          id: connexion.utilisateur.id,
          nom: connexion.utilisateur.nom,
          role: connexion.utilisateur.role,
          usurpePar: connexion.usurpePar,
          // Dit aux autres qui peut modifier et qui ne fait que regarder.
          droit: etat.droit,
          vue: etat.vue,
          misAJour: etat.misAJour,
          onglets: (existant?.onglets ?? 0) + 1,
        });
      } else {
        existant.onglets += 1;
      }
    }

    return [...parPersonne.values()]
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
      .map(({ misAJour, ...membre }) => membre);
  }

  const taille = () => salles.size;

  return { ajouter, retirer, connexionsDe, presence, taille };
}
