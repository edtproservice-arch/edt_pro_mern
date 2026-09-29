import { analyserSemaine, datesDeLaSemaine, libelleSemaine } from 'shared/domain';

/**
 * Ce que les trois formats de la feuille d'absence hebdomadaire ont en
 * commun : dates et nom du fichier.
 *
 * ⚠️ DEUX FORMATS DE DATE COEXISTENT DANS LE MÊME CANEVAS (2026-09-29) : l'encart
 * « Semaine … » écrit le jour et le mois PADDÉS (« 14/09 »), l'en-tête du
 * tableau les écrit SANS padding (« 14/9/2026 ») — vérifié sur le canevas
 * transmis, `Feuille_Absence_Hebdomadaire_GMOEMFM201.docx`. Chacun garde donc
 * son propre formateur plutôt que d'en forcer un seul sur les deux.
 */

const deux = (n) => String(n).padStart(2, '0');

function dateCourtePaddee(date) {
  return `${deux(date.getDate())}/${deux(date.getMonth() + 1)}`;
}

function dateCourteNonPaddee(date) {
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}

/**
 * « Feuille_Absence_Hebdomadaire_GMOEMFM201_2026-S2.docx » pour un seul
 * groupe, « Feuilles_Absence_Hebdomadaire_2026-S2.docx » pour plusieurs
 * (2026-09-29, demande du porteur : le bouton télécharge tous les groupes que
 * le filtre laisse visibles — le nom d'un seul groupe n'aurait plus de sens).
 */
export function nomFichierFeuilleAbsence(groupes, semaine, extension) {
  const analyse = analyserSemaine(semaine);
  const libelle = analyse ? `${analyse.anneeScolaire}-S${analyse.numero}` : semaine;
  const liste = Array.isArray(groupes) ? groupes : [groupes];
  if (liste.length === 1) return `Feuille_Absence_Hebdomadaire_${liste[0]}_${libelle}.${extension}`;
  return `Feuilles_Absence_Hebdomadaire_${libelle}.${extension}`;
}

/** Les 6 dates ouvrées (LUN…SAM) de la semaine, au format court SANS padding — pour l'en-tête du tableau. */
export function datesJoursOuvres(semaine) {
  return datesDeLaSemaine(semaine).slice(0, 6).map(dateCourteNonPaddee);
}

/**
 * « 2.5 », « 5 » — jamais « 2.50 » ni « 5.00 » (2026-09-29, demande du
 * porteur : « T. A » compte des HEURES, pas des séances). Même règle que
 * `texteHeures` du rapport des absences (`../absences/exportAbsencesTexte.js`)
 * : `Number` ne porte pas de zéros inutiles.
 */
export function texteHeures(heures) {
  return String(Math.round((heures ?? 0) * 100) / 100);
}

/**
 * « S2 du 14/09 au 19/09/2026 » — le texte de l'encart Semaine.
 *
 * ⚠️ LE SAMEDI, PAS `analyserSemaine().fin` (2026-09-29, constaté ici même sur
 * le rendu) : `fin` est le DIMANCHE de la semaine civile complète, un jour que
 * cette grille ne porte jamais (voir `JOURS`, six jours ouvrés) — le canevas
 * transmis clôt lui-même son encart sur le SAMEDI, le dernier jour de sa
 * propre grille.
 */
export function libelleSemainePeriode(semaine) {
  const analyse = analyserSemaine(semaine);
  if (!analyse) return semaine;
  const samedi = datesDeLaSemaine(semaine)[5];
  return `${libelleSemaine(semaine, { court: true })} du ${dateCourtePaddee(analyse.debut)} au ${dateCourtePaddee(samedi)}/${samedi.getFullYear()}`;
}
