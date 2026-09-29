/**
 * Le plan de la carte en ARBRE : l'établissement, puis une branche par année de
 * formation, puis les filières de chaque année avec leurs groupes.
 *
 * Pur, donc testé : la page ne fait que le dessiner.
 *
 * ⚠️ UNE ANNÉE SANS FILIÈRE N'A PAS DE BRANCHE (2026-09-19, demande du porteur). Une
 * première version montrait toujours les trois premières, vides comprises : un
 * bloc « Aucune filière » ne dit rien de plus que son absence. Les années viennent
 * donc des groupes, dans l'ordre — et il n'y en a aucune tant qu'aucun groupe
 * n'existe.
 *
 * ⚠️ UNE FILIÈRE QUI COMPTE DES GROUPES DE DEUX ANNÉES figure sous CHACUNE, avec
 * les seuls groupes de cette année — c'est bien ainsi que la carte les range.
 */
import { estActif } from 'shared/domain';

export function libelleAnnee(annee) {
  return annee === 1 ? '1ère année' : `${annee}ème année`;
}

/**
 * @param {Array<{nom: string, codeFiliere?: string, intituleFiliere?: string,
 *   anneeFormation?: number}>} groupes
 * @returns {Array<{annee: number, libelle: string, groupes: number,
 *   filieres: Array<{code: string, intitule: string, groupes: string[], modele: object,
 *     avancement: Object<string, {affectes: number, total: number}>}>}>}
 *   `avancement` : par groupe, ses modules ACTIFS et ceux qui ont un formateur
 *   présentiel — de quoi colorer sa pastille comme dans « Affectations ».
 *   `modele` : le premier groupe de cette filière et de cette année — le gabarit d'un
 *   groupe qu'on y ajoute (niveau, secteur, créneau, mode, modules).
 */
export function arbreDeLaCarte(groupes = []) {
  const annees = new Set();
  for (const groupe of groupes) {
    const annee = Number(groupe.anneeFormation);
    if (Number.isInteger(annee) && annee > 0) annees.add(annee);
  }

  return [...annees]
    .sort((a, b) => a - b)
    .map((annee) => {
      const filieres = new Map();

      for (const groupe of groupes) {
        if (Number(groupe.anneeFormation) !== annee) continue;

        const code = String(groupe.codeFiliere ?? '').trim() || 'Sans filière';
        if (!filieres.has(code)) {
          filieres.set(code, {
            code,
            intitule: String(groupe.intituleFiliere ?? '').trim(),
            groupes: [],
            modele: groupe,
            avancement: {},
          });
        }
        const filiere = filieres.get(code);
        filiere.groupes.push(groupe.nom);

        // Même compte que l'en-tête d'une colonne de la matrice : un module désactivé
        // n'est pas dispensé, il ne compte ni dans le total ni dans les affectés.
        const actifs = (groupe.modules ?? []).filter(estActif);
        filiere.avancement[groupe.nom] = {
          affectes: actifs.filter((module) => module.formateurPresentiel).length,
          total: actifs.length,
        };
      }

      const liste = [...filieres.values()]
        .map((filiere) => ({
          ...filiere,
          groupes: filiere.groupes.sort((a, b) => a.localeCompare(b, 'fr', { numeric: true })),
        }))
        .sort((a, b) => a.code.localeCompare(b.code, 'fr', { numeric: true }));

      return {
        annee,
        libelle: libelleAnnee(annee),
        groupes: liste.reduce((somme, filiere) => somme + filiere.groupes.length, 0),
        filieres: liste,
      };
    });
}
