import { libelleSemaine } from 'shared/domain';

/**
 * Ce que l'écran DIT d'une modification faite par quelqu'un d'autre.
 *
 * ⚠️ LA PLUPART NE DISENT RIEN. Poser ou vider une case, c'est le geste courant
 * — un collage en produit vingt d'un coup. Un message par case ferait défiler
 * vingt notifications pour un seul geste. La grille se met à jour, c'est tout,
 * comme dans Notion.
 *
 * Ce qui touche une SEMAINE ENTIÈRE, en revanche, doit être dit : voir sa grille
 * se vider ou se remplir sans explication se lit comme une panne.
 *
 * @returns {string|null} le message, ou `null` quand il n'y a rien à dire
 */
export function annonceDeModification(message) {
  const auteur = message?.auteur?.nom ?? 'Quelqu’un';
  const semaine = message?.semaine ? libelleSemaine(message.semaine, { court: true }) : null;

  switch (message?.action) {
    case 'importer':
      return `${auteur} a importé une semaine dans ${semaine ?? 'l’emploi du temps'}`;
    case 'reinitialiser':
      return message.portee === 'annee'
        ? `${auteur} a effacé l’emploi du temps de l’année`
        : `${auteur} a effacé ${semaine ?? 'une semaine'}`;
    case 'publication':
      return semaine
        ? `${auteur} a publié ${semaine}`
        : `${auteur} a retiré la publication de la semaine`;
    default:
      return null;
  }
}
