/**
 * Deux initiales, faute de photo — le projet n'en stocke aucune.
 * Un avatar vide se confondrait avec un chargement.
 *
 * ⚠️ ELLE VIT ICI, PAS DANS UN COMPOSANT : le menu du compte de la barre
 * latérale et l'avatar de la barre de navigation en ont besoin tous les deux.
 * Recopiée, elle finirait par ne plus donner les mêmes lettres aux deux
 * endroits — la cause n°1 d'instabilité du §4.2, appliquée à deux caractères.
 */
export function initiales(nomComplet) {
  const mots = String(nomComplet ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (mots.length === 0) return '?';
  return (mots[0][0] + (mots[1]?.[0] ?? '')).toUpperCase();
}
