/** Ce que les trois formats de l'export détaillé ont en commun : le nom du fichier. */

/** `Emploi_Detaille_Formateurs_S4_2026-2027.docx` — sans accent ni espace, pour
 *  tout système de fichiers. ← demande du porteur : « au lieu de teacher met
 *  formateur » (le canevas transmis s'appelait `EDT_TEACHER_…`) — satisfaite
 *  puisque `entete` porte déjà « Formateur » sur cet axe. */
export function nomFichierIndividuel({ anneeScolaire, semaineLabel, entete }, extension) {
  const sujet = String(entete ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `Emploi_Detaille_${sujet}s_${semaineLabel}_${anneeScolaire}-${anneeScolaire + 1}.${extension}`;
}
