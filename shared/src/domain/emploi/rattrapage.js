import { PAS, PLAFOND_CELLULE } from '../chronogramme/semaines.js';
import { TYPES, poserCellule } from '../chronogramme/planning.js';
import { separerFusion } from '../carte/reconstruction.js';

/**
 * Report d'une absence de formateur dans le chronogramme.
 * ← `chrono_ratt_appliquer()` de includes/chrono_modules.php
 *   et `RATTRAPAGE_DUREE` de api/data/update_rattrapage.php
 *
 * ═══ POURQUOI UNE ABSENCE TOUCHE LE CHRONOGRAMME ═══
 * Une séance non assurée n'est pas une séance perdue : elle est REPORTÉE. Tant
 * que le rattrapage n'est pas inscrit dans la semaine où il aura lieu, le
 * chronogramme annonce des heures au mauvais moment, et la comparaison
 * « planifié vs réalisé » (F7) accuse un retard qui n'existe pas.
 */

/** Une séance de rattrapage dure une séance — ← `RATTRAPAGE_DUREE`. */
export const DUREE_RATTRAPAGE = 2.5;

/**
 * Les groupes réellement concernés par une absence.
 *
 * ⚠️ LE CHAMP PEUT PORTER UNE FUSION. Une séance synchrone couvre plusieurs
 * groupes (« GM101 GM102 ») et chacun a SON chronogramme : n'en reporter qu'un
 * laisserait les autres avec des heures qui ne seront jamais données.
 * ← `chrono_ratt_groupes()`
 */
export function groupesConcernes(champ) {
  /*
   * ⚠️⚠️ `separerFusion`, ET NON UN DÉCOUPAGE SUR LES ESPACES. Un nom de groupe
   * en CONTIENT dès qu'il porte un suffixe — « ACADA101 (FQ) », et jusqu'à deux
   * quand il faut désambiguïser. Couper dessus fabriquait les groupes fantômes
   * « ACADA101 » et « (FQ) » : le report cherchait leurs chronogrammes, n'en
   * trouvait aucun, et rendait deux « sans_chronogramme » — pendant que le VRAI
   * groupe ne recevait jamais ses heures de rattrapage.
   *
   * La règle est écrite une seule fois, dans `carte/reconstruction.js`, qui
   * porte déjà l'avertissement.
   */
  return separerFusion(champ);
}

/**
 * Ajoute ou retire les heures d'un rattrapage dans le planning d'UN groupe.
 *
 * @param {object} params
 * @param {object} params.planning planning du groupe, `{module: {numero: {heures, type}}}`
 * @param {string} params.module code du module de la séance manquée
 * @param {number} params.numeroSemaine semaine du rattrapage (numérotation scolaire)
 * @param {number} params.delta `+DUREE_RATTRAPAGE` pour poser, `-` pour reprendre
 * @returns {{planning: object, etat: string, heures?: number}}
 *   `etat` ∈ `ajoute` · `retire` · `inchange` · `sans_module` · `cellule_pleine`
 */
export function reporterRattrapage({ planning, module, numeroSemaine, delta }) {
  const courant = planning ?? {};
  const recherche = String(module ?? '').trim().toUpperCase();

  /*
   * ⚠️ UNE ABSENCE SANS MODULE NE PEUT PAS ÊTRE REPORTÉE : le chronogramme est
   * indexé PAR module. Le cas existe en base — on le DIT plutôt que de ne rien
   * faire en silence, sans quoi le rattrapage paraîtrait enregistré.
   */
  if (recherche === '') return { planning: courant, etat: 'sans_module' };
  if (!Number.isInteger(numeroSemaine)) {
    return { planning: courant, etat: 'hors_annee' };
  }

  /*
   * ⚠️ LE CODE EST CHERCHÉ SANS TENIR COMPTE DE LA CASSE : la séance et la base
   * e-note ne s'accordent pas toujours, et une clé qui ne correspond pas
   * créerait un module fantôme à côté du vrai.
   */
  const cle = Object.keys(courant).find((existant) => existant.toUpperCase() === recherche) ?? module;

  const cellule = courant[cle]?.[numeroSemaine];
  const heures = Number(cellule?.heures ?? 0);
  /*
   * ⚠️ LE TYPE DE LA CELLULE EST CONSERVÉ. Une cellule ne porte qu'un type,
   * présentiel OU synchrone : rattraper du synchrone dans une case présentielle
   * en changerait la nature sans le dire.
   */
  const type = cellule?.type === TYPES.SYNCHRONE ? TYPES.SYNCHRONE : TYPES.PRESENTIEL;

  // Le pas de la grille est de 2,5 h : une valeur intermédiaire ne serait pas
  // re-sélectionnable à l'écran.
  const brut = heures + Number(delta ?? 0);
  const nouvelles = Math.max(0, Math.round(brut / PAS) * PAS);

  if (nouvelles === heures) return { planning: courant, etat: 'inchange', heures };

  /*
   * ⚠️ REFUS PLUTÔT QUE TRONCATURE SILENCIEUSE : la cellule ne peut pas porter
   * plus de 20 h, et rogner l'excédent ferait disparaître des heures que
   * personne ne viendrait chercher.
   */
  if (nouvelles > PLAFOND_CELLULE) {
    return { planning: courant, etat: 'cellule_pleine', heures };
  }

  return {
    planning: poserCellule(courant, cle, numeroSemaine, nouvelles, type),
    etat: delta > 0 ? 'ajoute' : 'retire',
    heures: nouvelles,
  };
}
