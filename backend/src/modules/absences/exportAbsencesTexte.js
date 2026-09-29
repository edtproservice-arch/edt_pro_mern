import { analyserSemaine } from 'shared/domain';

/** Ce que les trois formats de l'export ont en commun : dates et nom du fichier. */

const deux = (n) => String(n).padStart(2, '0');

/** `Date` → « 27/09/2026 ». JAMAIS `toISOString()` : voir la règle du domaine
 *  sur l'heure locale — une date sérialisée en UTC rendrait la veille. */
export function dateFr(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${deux(date.getDate())}/${deux(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** `2026-09-29` — pour le nom de fichier, en heure locale elle aussi. */
function dateIsoLocale(date) {
  return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}`;
}

/** `Rapport_Absences_2026-09-29.docx` — daté du jour de génération, comme le canevas transmis. */
export function nomFichierAbsences(extension) {
  return `Rapport_Absences_${dateIsoLocale(new Date())}.${extension}`;
}

/** `145`, `12.5` — jamais `145.00` ni `12.50` : `Number` ne porte pas de zéros inutiles. */
export function texteHeures(heures) {
  return String(Math.round((heures ?? 0) * 100) / 100);
}

/**
 * « 2026-W4 » (l'identifiant INTERNE, celui que la grille manipule) → « 2026-S4 »
 * (celui qu'on montre — 2026-09-29, demande du porteur). Un identifiant
 * illisible ressort tel quel plutôt que de disparaître.
 */
export function libelleSemaineAnnee(semaine) {
  const analyse = analyserSemaine(semaine);
  return analyse ? `${analyse.anneeScolaire}-S${analyse.numero}` : semaine;
}
