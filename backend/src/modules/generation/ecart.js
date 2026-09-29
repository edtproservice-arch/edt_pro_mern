import { CRENEAUX_GENERES } from './probleme.js';

/**
 * L'écart entre ce que le solveur a proposé et ce que le directeur a gardé
 * (F6 · étape d).
 *
 * ═══ C'EST LUI, LE SIGNAL D'APPRENTISSAGE ═══ Enregistrer le problème et la
 * solution n'apprend qu'à IMITER le glouton, c'est-à-dire à reproduire ses
 * défauts. Ce qu'un modèle de préférence peut apprendre, c'est la DIFFÉRENCE :
 * les séances que l'humain a déplacées, et vers où.
 *
 * ⚠️ « DÉPLACÉE » EST UNE INTERPRÉTATION, PAS UN FAIT. Rien ne dit que le
 *    directeur a bougé CETTE séance-là plutôt que d'en supprimer une et d'en
 *    ajouter une autre : on ne voit que l'état d'arrivée. L'appariement se fait
 *    donc par créneau croissant des deux côtés — déterministe, et documenté
 *    comme tel pour que personne ne prenne ce champ pour un journal des gestes.
 */

const parTache = (entrees) => {
  const groupes = new Map();
  for (const entree of entrees) {
    if (!groupes.has(entree.tacheId)) groupes.set(entree.tacheId, []);
    groupes.get(entree.tacheId).push(entree);
  }
  return groupes;
};

/**
 * @param {object[]} creneaux    `probleme.creneaux` — (id, jour, rang)
 * @param {object[]} placements  `solution.placements` — (tacheId, creneauId, salle)
 * @param {object[]} seances     la grille retenue — (tacheId, jour, seance, salle)
 */
export function ecartGrille({ creneaux = [], placements = [], seances = [] }) {
  const idDuCreneau = new Map(
    creneaux.map((creneau) => [`${creneau.jour}||${CRENEAUX_GENERES[creneau.rang]}`, creneau.id])
  );

  /*
   * ⚠️ CE QUI N'EST PAS DANS LA GRILLE GÉNÉRÉE EST ÉCARTÉ, pas compté comme
   *    « ajouté » : une séance du SOIR, ou posée un jour que le problème avait
   *    fermé, n'a jamais été proposée au solveur. La compter reviendrait à lui
   *    reprocher de ne pas avoir placé ce qu'on ne lui a pas demandé.
   */
  const retenues = seances
    .map((seance) => ({ ...seance, creneauId: idDuCreneau.get(`${seance.jour}||${seance.seance}`) }))
    .filter((seance) => seance.creneauId !== undefined);

  const proposees = parTache(placements);
  const gardees = parTache(retenues);

  const bilan = { conservees: 0, changementSalle: 0, deplacees: 0, retirees: 0, ajoutees: 0 };
  const details = [];

  for (const tacheId of new Set([...proposees.keys(), ...gardees.keys()])) {
    const ordre = (a, b) => a.creneauId - b.creneauId;
    let restantProposees = [...(proposees.get(tacheId) ?? [])].sort(ordre);
    let restantGardees = [...(gardees.get(tacheId) ?? [])].sort(ordre);

    // ── 1. Même créneau : conservée, à la salle près.
    const survivantes = [];
    for (const propose of restantProposees) {
      const rang = restantGardees.findIndex((g) => g.creneauId === propose.creneauId);
      if (rang === -1) {
        survivantes.push(propose);
        continue;
      }
      const gardee = restantGardees[rang];
      restantGardees.splice(rang, 1);
      if (gardee.salle === propose.salle) bilan.conservees += 1;
      else {
        bilan.changementSalle += 1;
        details.push({
          tacheId,
          type: 'salle',
          creneauId: propose.creneauId,
          de: propose.salle,
          vers: gardee.salle,
        });
      }
    }
    restantProposees = survivantes;

    // ── 2. Ce qui reste des DEUX côtés : la séance a changé de créneau.
    while (restantProposees.length && restantGardees.length) {
      const propose = restantProposees.shift();
      const gardee = restantGardees.shift();
      bilan.deplacees += 1;
      details.push({
        tacheId,
        type: 'deplacee',
        de: propose.creneauId,
        vers: gardee.creneauId,
        salleDe: propose.salle,
        salleVers: gardee.salle,
      });
    }

    // ── 3. Le reliquat : proposé et jeté, ou apparu sans avoir été proposé.
    for (const propose of restantProposees) {
      bilan.retirees += 1;
      details.push({ tacheId, type: 'retiree', creneauId: propose.creneauId });
    }
    for (const gardee of restantGardees) {
      bilan.ajoutees += 1;
      details.push({ tacheId, type: 'ajoutee', creneauId: gardee.creneauId, salle: gardee.salle });
    }
  }

  return {
    ...bilan,
    proposees: placements.length,
    retenues: retenues.length,
    /**
     * Part des placements que l'humain a gardés TELS QUELS. C'est la mesure à
     * suivre d'une version du solveur à l'autre — et celle qu'un modèle de
     * préférence cherchera à faire monter.
     */
    fidelite: placements.length ? Number((bilan.conservees / placements.length).toFixed(4)) : null,
    details,
  };
}
