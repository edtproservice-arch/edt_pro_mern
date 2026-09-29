/**
 * Ce que les trois formats d'export ont en commun : le texte d'en-tête et le
 * nom du fichier. Une seule écriture — sinon le Word et le PDF d'une même
 * semaine pourraient finir par ne plus se ressembler.
 */

const deux = (n) => String(n).padStart(2, '0');

/** `Date` → « 14/09/2026 ». JAMAIS `toISOString()` : voir la règle du domaine
 *  sur l'heure locale — une date sérialisée en UTC rendrait la veille. */
export function dateFr(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${deux(date.getDate())}/${deux(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** Le libellé du sujet de l'export, au pluriel : « FORMATEURS », « GROUPES », « ESPACES ». */
export function entetePluriel(entete) {
  const majuscule = String(entete ?? '').toUpperCase();
  return majuscule.endsWith('S') ? majuscule : `${majuscule}S`;
}

/** Le bloc de titre, identique sur le Word, le PDF et l'en-tête du classeur Excel. */
export function texteEntete({ etablissement, anneeScolaire, semaineLabel, semaineDebut, entete }) {
  const morceaux = [
    etablissement?.complexe,
    etablissement?.nom,
    `EMPLOI GLOBAL ${entetePluriel(entete)}`,
    `Au titre de l'année ${anneeScolaire}-${anneeScolaire + 1}`,
    `Semaine ${semaineLabel} - à partir du : ${dateFr(semaineDebut)}`,
  ].filter(Boolean);

  return morceaux.join(' | ');
}

/** `Emploi_Global_Formateurs_S3_2026-2027.docx` — sans accent ni espace, pour tout système de fichiers. */
export function nomFichierExport({ anneeScolaire, semaineLabel, entete }, extension) {
  const sujet = String(entete ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_');
  return `Emploi_Global_${sujet}s_${semaineLabel}_${anneeScolaire}-${anneeScolaire + 1}.${extension}`;
}
