import { DUREE_RATTRAPAGE, reporterRattrapage, separerFusion } from 'shared/domain';

/**
 * La séance de rattrapage posée DIRECTEMENT au chronogramme, depuis la modale
 * (2026-09-28, demandes du porteur : « je clique, ça s'ajoute automatiquement »,
 * puis « un seul bouton pour enregistrer rattrapage et chronogramme »).
 *
 * 2,5 h dans la semaine choisie, dans le type de la case — `reporterRattrapage`,
 * la règle du report serveur —, sur CHAQUE groupe de l'absence : une fusion
 * synchrone a un chronogramme par groupe. Ceci n'est que l'APERÇU : l'écriture
 * passe par la date de rattrapage de l'absence, que le serveur reporte au
 * chronogramme lui-même.
 */

/** Les lignes du chronogramme du formateur qui portent l'absence. */
export function lignesDeLAbsence(lignes, absence) {
  const membres = separerFusion(absence.groupe);
  return (lignes ?? []).filter(
    (ligne) => membres.includes(ligne.groupe) && ligne.code === absence.module
  );
}

/** Les plannings, la séance ajoutée en semaine `numero` — pour l'AFFICHAGE. */
export function planningsAvecAjout(plannings, lignes, numero) {
  if (!plannings || !numero) return plannings ?? {};
  const suivants = { ...plannings };
  for (const ligne of lignes ?? []) {
    const resultat = reporterRattrapage({
      planning: suivants[ligne.groupe] ?? {},
      module: ligne.code,
      numeroSemaine: numero,
      delta: DUREE_RATTRAPAGE,
    });
    if (resultat.etat === 'ajoute') suivants[ligne.groupe] = resultat.planning;
  }
  return suivants;
}
