/**
 * Quelles semaines générer — la sélection, hors de tout composant.
 *
 * ⚠️ SORTIE DU RENDU POUR ÊTRE TESTÉE. Cette liste décide de ce qui sera
 *    ÉCRASÉ : une borne fausse remplacerait des semaines que personne n'a
 *    cochées. C'est le même choix que `etatPlannings` du chronogramme, où un
 *    calcul laissé dans le composant avait fini par vider des grilles.
 */

import { MOTEURS } from 'shared/constants';
import { FIN_SEMESTRE_1, NOMBRE_SEMAINES } from 'shared/domain';

export { FIN_SEMESTRE_1, NOMBRE_SEMAINES };

/** « 2026-W3 » pour la semaine 3 de l'année scolaire 2026. */
export const valeurDe = (anneeScolaire, numero) => `${anneeScolaire}-W${numero}`;

/**
 * Les 45 semaines de l'année, avec ce que chacune porte déjà.
 *
 * @param {number} anneeScolaire
 * @param {Array<{semaine: string, seances: number}>} existantes — `/seances/semaines`
 */
export function semainesDeLAnnee(anneeScolaire, existantes = []) {
  const parValeur = new Map(existantes.map((entree) => [entree.semaine, entree.seances ?? 0]));

  return Array.from({ length: NOMBRE_SEMAINES }, (_, index) => {
    const numero = index + 1;
    const valeur = valeurDe(anneeScolaire, numero);
    return {
      numero,
      valeur,
      seances: parValeur.get(valeur) ?? 0,
      semestre: numero <= FIN_SEMESTRE_1 ? 1 : 2,
    };
  });
}

/**
 * Les valeurs d'un raccourci.
 *
 * ⚠️ « TOUT » VEUT DIRE LES 45 SEMAINES, y compris celles que le chronogramme
 *    ne remplit pas : le service les rapporte « vides » sans rien écrire. Les
 *    filtrer ici demanderait de connaître les chronogrammes côté écran — une
 *    seconde lecture de la même donnée, qui divergerait du serveur.
 */
export function raccourci(cle, anneeScolaire) {
  const toutes = Array.from({ length: NOMBRE_SEMAINES }, (_, i) => valeurDe(anneeScolaire, i + 1));

  if (cle === 'tout') return toutes;
  if (cle === 'semestre1') return toutes.slice(0, FIN_SEMESTRE_1);
  if (cle === 'semestre2') return toutes.slice(FIN_SEMESTRE_1);
  return [];
}

/**
 * Ce que la génération va remplacer, tous comptes faits.
 *
 * ⚠️ ON NE COMPTE QUE LES SEMAINES COCHÉES. La prévisualisation peut porter sur
 *    une sélection plus large si l'utilisateur a décoché entre-temps : afficher
 *    son total ferait annoncer une perte qui n'aura pas lieu.
 */
export function bilanRemplacement(previsualisation = [], selection = []) {
  const cochees = new Set(selection);
  const retenues = previsualisation.filter((entree) => cochees.has(entree.semaine));

  return {
    remplacees: retenues.reduce((total, entree) => total + (entree.remplacees ?? 0), 0),
    preservees: retenues.reduce((total, entree) => total + (entree.preservees ?? 0), 0),
    semainesTouchees: retenues.filter((entree) => (entree.remplacees ?? 0) > 0).length,
  };
}

/**
 * Les semaines qui ont laissé des séances non placées — pour une relance ciblée.
 *
 * ⚠️ RELANCER TOUT SERAIT PIRE QUE NE RIEN FAIRE : les semaines réussies
 *    seraient réécrites, donc redistribuées, et le directeur perdrait des
 *    placements qu'il venait peut-être d'ajuster à la main.
 */
export function semainesIncompletes(rapport) {
  return (rapport?.semaines ?? [])
    .filter((semaine) => (semaine.nonPlacees?.length ?? 0) > 0 || semaine.echec)
    .map((semaine) => semaine.semaine);
}

/** Les codes de cause rencontrés, pour ne proposer que les assouplissements utiles. */
export function causesRencontrees(rapport) {
  const codes = new Set();
  for (const semaine of rapport?.semaines ?? []) {
    for (const non of semaine.nonPlacees ?? []) codes.add(non.cause);
  }
  return [...codes];
}

/**
 * Combien de temps une génération va durer, au PIRE.
 *
 * ═══ ⚠️ POURQUOI CETTE FONCTION EXISTE ═══
 * Au glouton, l'année entière se génère en une seconde : personne n'a besoin
 * d'être prévenu. En CP-SAT, chaque semaine incomplète coûte **20 secondes** —
 * 45 semaines font un quart d'heure. Sans ce chiffre AVANT le clic, le
 * directeur lancerait, verrait une barre immobile, fermerait l'onglet, et la
 * génération continuerait sans lui (le flux restitue, il ne pilote pas).
 *
 * ⚠️ C'EST UN MAJORANT, ET IL EST ANNONCÉ COMME TEL (« jusqu'à »). CP-SAT n'est
 *    lancé que sur les semaines que le glouton n'a pas remplies : mesuré sur
 *    l'année réelle, 20 semaines sur 37, soit 7 minutes là où ce calcul en
 *    annonce 12. Majorer est le bon sens de l'erreur — une attente plus courte
 *    que promise ne fâche personne.
 */
const SECONDES_PAR_SEMAINE_CPSAT = 22;

export function dureeMaximale(nombreDeSemaines, moteur) {
  if (moteur !== MOTEURS.CPSAT || nombreDeSemaines <= 0) return null;

  const secondes = nombreDeSemaines * SECONDES_PAR_SEMAINE_CPSAT;
  if (secondes < 90) return `environ ${secondes} secondes`;
  return `jusqu’à ${Math.ceil(secondes / 60)} minutes`;
}
