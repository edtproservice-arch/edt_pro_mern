import { creerStockage } from './stockageLocal';

/**
 * Date du dernier enregistrement, par page.
 * ← « Modifié à l'instant » de l'en-tête Notion
 *
 * ⚠️ C'EST UNE TRACE LOCALE, PAS LA VÉRITÉ DU SERVEUR. Elle dit « vous avez
 * enregistré cette page à telle heure », pas « la donnée a été modifiée à telle
 * heure ». Un collègue qui enregistre depuis son poste ne l'y inscrit pas.
 *
 * C'est un choix assumé pour l'instant : aucune de nos routes ne rend encore de
 * date de modification. Le jour où `updatedAt` remontera avec la donnée, cette
 * trace devra CÉDER LA PLACE — pas s'y ajouter, sinon deux dates se
 * contrediront à l'écran.
 */
const MODIFICATIONS = creerStockage('edtpro.modifications', {});

export const useModifications = MODIFICATIONS.utiliser;

export function marquerModifiee(chemin) {
  MODIFICATIONS.definir((courantes) => ({ ...courantes, [chemin]: Date.now() }));
}

/** « à l'instant », « il y a 5 min », « il y a 2 h », puis la date. */
export function depuis(horodatage) {
  if (!horodatage) return null;

  const secondes = Math.max(0, Math.round((Date.now() - horodatage) / 1000));

  if (secondes < 60) return 'à l’instant';
  if (secondes < 3600) return `il y a ${Math.floor(secondes / 60)} min`;
  if (secondes < 86400) return `il y a ${Math.floor(secondes / 3600)} h`;

  // Au-delà d'un jour, « il y a 3 j » est moins utile que la date elle-même :
  // on cherche alors à savoir QUAND, pas depuis combien de temps.
  return new Date(horodatage).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
