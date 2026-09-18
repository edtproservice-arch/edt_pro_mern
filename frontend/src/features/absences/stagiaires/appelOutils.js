/**
 * Les règles de l'écran d'appel qui décident de ce qui s'écrit — sorties du
 * composant pour être vérifiables autrement qu'à l'œil (même choix que
 * `etatPlannings.js`).
 */

/**
 * Le créneau qui suit dans la MÊME demi-journée de cours — ou `null`.
 *
 * ⚠️ PAS AU-DELÀ DE S4 : S5 est le créneau du SOIR, un autre service ; un
 * stagiaire absent en S4 n'est pas pour autant absent le soir.
 */
const SUIVANTS = { S1: 'S2', S2: 'S3', S3: 'S4' };
export const creneauSuivant = (seance) => SUIVANTS[seance] ?? null;

/**
 * Les marques à écrire sur le créneau suivant quand on y DUPLIQUE l'appel.
 *
 * ═══ L'ÉTAT DE LA LISTE EST RECOPIÉ TEL QUEL ═══ (2026-09-14, demande du
 * porteur : « si je fais un changement, il m'affiche dupliquer — pas forcément
 * un stagiaire absent ».) Absents, retards ET présents : dupliquer, c'est rendre
 * le créneau suivant identique à celui-ci. REVIENT sur la première version, qui
 * ne reportait que les absents sur les présents de la cible — une modification
 * quelconque n'y avait alors rien à dupliquer.
 *
 * ⚠️ UNE MARQUE DÉJÀ POSÉE SUR LA CIBLE PEUT DONC ÊTRE REMPLACÉE — c'est le sens
 * de « dupliquer » — mais elle est COMPTÉE (`remplacees`), et l'écran le dit.
 * ⚠️ UN STAGIAIRE ABSENT DE L'ORIGINE garde sa marque de la cible : une fusion
 * peut réunir en S2 des groupes que S1 n'avait pas.
 *
 * @param {Array<{matricule: string, marque: {type: string}|null}>} cible la liste du créneau suivant
 * @param {Record<string, string|null>} etats l'état de la liste d'origine, par CEF
 * @returns {{marques: Array<{matricule, type}>, changees: number, remplacees: number}}
 */
export function marquesCopiees(cible, etats) {
  let changees = 0;
  let remplacees = 0;
  const marques = cible.map((s) => {
    const deja = s.marque?.type ?? null;
    if (!Object.hasOwn(etats, s.matricule)) return { matricule: s.matricule, type: deja };

    const type = etats[s.matricule] ?? null;
    if (type !== deja) {
      changees += 1;
      if (deja !== null) remplacees += 1;
    }
    return { matricule: s.matricule, type };
  });
  return { marques, changees, remplacees };
}

/** Deux états de liste identiques, stagiaire par stagiaire. */
export const memesEtats = (a, b, matricules) => matricules.every((m) => (a[m] ?? null) === (b[m] ?? null));

/**
 * Ce que la liste affiche quand le serveur rend une NOUVELLE version de l'appel
 * (duplication, collègue, relecture après enregistrement).
 *
 * Sans saisie en cours — l'écran montre encore la version précédente — on adopte
 * la nouvelle. Avec une saisie en cours, on la garde : c'est elle qui partira.
 *
 * ⚠️⚠️ `precedente` DOIT ÊTRE LA RÉFÉRENCE D'AVANT, figée par l'appelant avant
 * qu'il ne la remplace (2026-09-14, trouvé en vérifiant la duplication en
 * direct). Lue au moment où React exécute le calcul différé, elle valait déjà la
 * nouvelle version : l'écran se croyait « en saisie », gardait la copie en cache,
 * et l'enregistrement automatique la RÉÉCRIVAIT par-dessus le serveur — la
 * duplication vers S2 disparaissait à la réouverture de S2.
 */
export const adopterVersion = (courant, precedente, nouvelle, matricules) =>
  memesEtats(courant, precedente, matricules) ? nouvelle : courant;
