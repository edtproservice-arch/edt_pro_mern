/**
 * L'écriture des heures de l'écran d'avancement.
 *
 * ⚠️ UNE SEULE DÉFINITION. Elle était écrite DEUX FOIS — dans la page et dans le
 * tableau — et les deux se seraient contredites au premier ajustement : c'est le
 * §4.2 du plan appliqué à un formatage, et l'écart s'y voit d'autant moins qu'il
 * ne porte que sur une virgule.
 *
 * ⚠️ EN FRANÇAIS, TOUJOURS : « 14 465,5 h », jamais « 14465.5 ». Un tableau qui
 * mêle les deux notations dans la même rangée se lit comme deux grandeurs
 * différentes — et le taux rendait bien « 0.6 % » à côté d'un bandeau qui
 * écrivait « 14 465,5 ».
 */
export function nombre(valeur) {
  return Number(valeur ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}
