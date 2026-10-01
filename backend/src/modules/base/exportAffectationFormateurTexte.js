/** Petits textes communs aux trois formats de l'affectation d'un formateur. */

/** Les heures comme sur le canevas : deux décimales, point décimal — « 22.50 ». */
export const texteHeures = (heures) => Number(heures ?? 0).toFixed(2);

/** « Affectation_ABDELHAK_CHARKAOUI.docx » — le nom du canevas transmis. */
export function nomFichierAffectation(formateur, extension) {
  const nom = String(formateur ?? '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_');
  return `Affectation_${nom || 'formateur'}.${extension}`;
}
