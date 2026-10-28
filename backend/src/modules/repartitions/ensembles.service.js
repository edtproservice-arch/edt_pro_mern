import { Repartition } from '../../models/Repartition.js';

/*
 * Les modules de la répartition DRIF, par (filière, année) — extraits de
 * `repartitions.routes.js` (2026-10-27) : le tableau de bord du directeur de
 * complexe reconstruit les cartes de ses établissements avec EXACTEMENT ce que
 * charge l'écran d'affectation, pour que l'offre et la demande y soient les mêmes.
 */

/** Filière et modules portés par un lot de lignes de répartition. */
export function ensembleDepuisLignes(lignes) {
  const premiere = lignes[0];

  return {
    filiere: premiere
      ? {
          code: premiere.codeFiliereCarte,
          /* Conservé pour l'affichage et le rapprochement avec le document DRIF. */
          codeDrif: premiere.codeFiliereDrif,
          intitule: premiere.intituleFiliere,
          secteur: premiere.secteur,
          niveau: premiere.niveauFormation,
          typeFormation: premiere.typeFormation,
          creneau: premiere.creneau,
        }
      : null,
    modules: lignes.map((ligne) => ({
      code: ligne.codeModule,
      nom: ligne.module,
      mhpS1: ligne.mhpS1,
      mhpS2: ligne.mhpS2,
      mhsynS1: ligne.mhsynS1,
      mhsynS2: ligne.mhsynS2,
      mhasynS1: ligne.mhasynS1,
      mhasynS2: ligne.mhasynS2,
      mhpTotale: ligne.mhpTotale,
      mhdTotale: ligne.mhdTotale,
      estRegional: ligne.efmRegional,
      metier: ligne.metier,
    })),
  };
}

/**
 * Les ensembles demandés, en UNE requête : `{ "CODE||ANNEE": {filiere, modules} }`.
 * Un ensemble sans aucune ligne est rendu VIDE plutôt qu'omis : l'appelant doit
 * pouvoir distinguer « pas de modules » de « pas demandé ».
 */
export async function chargerEnsembles(demandes) {
  if (demandes.length === 0) return {};

  const lignes = await Repartition.find({
    $or: demandes.map(({ codeFiliere, anneeFormation }) => ({
      codeFiliereCarte: codeFiliere,
      anneeFormation,
    })),
  }).sort({ codeModule: 1 });

  // Regroupement en mémoire : une passe sur quelques centaines de lignes coûte
  // moins qu'un aller-retour réseau supplémentaire.
  const parEnsemble = new Map();
  for (const ligne of lignes) {
    const cle = `${ligne.codeFiliereCarte}||${ligne.anneeFormation}`;
    if (!parEnsemble.has(cle)) parEnsemble.set(cle, []);
    parEnsemble.get(cle).push(ligne);
  }

  const ensembles = {};
  for (const { codeFiliere, anneeFormation } of demandes) {
    const cle = `${codeFiliere}||${anneeFormation}`;
    ensembles[cle] = ensembleDepuisLignes(parEnsemble.get(cle) ?? []);
  }
  return ensembles;
}
