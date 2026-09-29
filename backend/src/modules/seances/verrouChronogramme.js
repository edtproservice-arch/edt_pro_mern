import { AutoGenConfig } from '../../models/AutoGenConfig.js';
import { Chronogramme } from '../../models/Chronogramme.js';
import { Seance } from '../../models/Seance.js';
import { conflict } from '../../lib/httpError.js';

/**
 * Le verrou du chronogramme, côté SERVEUR.
 * ← `chronoVerrou` d'`emploi.html` (lignes 5051-5105)
 *
 * ═══ ⚠️ L'ANCIEN NE VÉRIFIAIT QU'À L'ÉCRAN ═══
 * `chronoVerrouBloque()` est appelé depuis sept gestionnaires d'événement, et
 * rien d'autre. Une requête forgée, un onglet resté ouvert avant que le
 * chronogramme soit planifié, un client qui n'a pas rechargé : tout passait.
 * Ici la règle est au serveur, et l'écran ne fait plus que l'annoncer.
 *
 * ═══ CE QUE LE VERROU REFUSE ═══
 * Le chronogramme fixe COMBIEN d'heures chaque module reçoit par semaine. Est
 * donc refusé tout ce qui change cette allocation : poser une séance neuve, en
 * retirer une, changer le groupe ou le module d'une case, importer une autre
 * semaine, réinitialiser.
 *
 * ═══ CE QU'IL LAISSE PASSER, ET POURQUOI ═══
 * Le DÉPLACEMENT — la même séance change de créneau —, le changement de SALLE
 * et le marquage d'ABSENCE. Aucun ne touche au cours attribué ; les interdire
 * empêcherait de rattraper un conflit de salle sans tout dissocier.
 *
 * ═══ ⚠️⚠️ DEUX FUITES CONNUES, ASSUMÉES ═══ (2026-09-27)
 * « Déplacer ne change pas les volumes » est vrai en général et FAUX deux fois :
 *   1. **Salle → TEAMS** fait passer la séance du présentiel au synchrone. Les
 *      deux ont leur quota propre (`verifierQuota`), donc le volume PAR TYPE
 *      change.
 *   2. **Un créneau de jour vers S5** fait passer la séance de 2,5 h à 2 h.
 * Les fermer contredirait ce qui a été validé — « changer sa salle ou déplacer
 * reste permis » — et bloquerait des gestes légitimes et fréquents. Le RAPPORT
 * DE COMPLÉTUDE les signale l'un comme l'autre : le verrou garde l'allocation
 * des cours, le rapport mesure les heures. Deux outils, deux échelles.
 *
 * ⚠️ **LE VERROU N'EST PAS UNE RÈGLE DE SÉCURITÉ** mais une règle de cohérence :
 *    il protège d'une divergence involontaire, pas d'une intention. La voie
 *    normale reste de modifier le chronogramme puis de régénérer.
 */

export const CODE_VERROU = 'CHRONOGRAMME_VERROUILLE';

/**
 * Le verrou mord-il ?
 *
 * ⚠️ IL FAUT LES DEUX : une liaison active ET un chronogramme planifié. Un
 *    établissement « lié » qui n'a rien planifié n'a rien à quoi se conformer.
 *
 * ⚠️ L'ABSENCE D'`AutoGenConfig` VAUT « LIÉ » — Mongoose n'applique pas un
 *    défaut de schéma à un document qui n'existe pas.
 *
 * ⚠️ « ENREGISTRÉ » N'EST PAS « PLANIFIÉ » : une ligne peut exister avec un
 *    planning vide, après une réinitialisation. On cherche une cellule qui
 *    porte des heures, pas une ligne.
 */
export async function verrouActif(etablissementId, anneeScolaire, session = null) {
  const config = await AutoGenConfig.findOne({ etablissementId, anneeScolaire })
    .select('chronogrammeLie')
    .session(session)
    .lean();

  if ((config?.chronogrammeLie ?? true) === false) return false;

  const chronogrammes = await Chronogramme.find({ etablissementId, anneeScolaire })
    .select('planning')
    .session(session)
    .lean();

  for (const chrono of chronogrammes) {
    const planning = chrono?.planning;
    const semaines = planning instanceof Map ? planning.values() : Object.values(planning ?? {});
    for (const cellules of semaines) {
      for (const cellule of cellules ?? []) {
        if ((Number(cellule?.heures) || 0) > 0) return true;
      }
    }
  }

  return false;
}

/**
 * Le refus, toujours formulé de la même façon.
 *
 * ⚠️ IL DIT CE QUI EST BLOQUÉ **ET LA VOIE À SUIVRE**. « Action impossible »
 *    ferait chercher une panne ; ici le directeur sait qu'il doit passer par le
 *    chronogramme, ou dissocier.
 */
export function refuser(geste) {
  return conflict(`Chronogramme planifié : ${geste} n’est pas possible.`, {
    code: CODE_VERROU,
    details: [
      {
        type: 'verrou',
        message:
          `Modifiez le chronogramme, puis relancez la génération automatique — ou ` +
          `dissociez l’emploi du temps du chronogramme. Le déplacement des séances, ` +
          `l’espace et les absences restent libres.`,
      },
    ],
  });
}

/** Deux séances portent-elles le MÊME cours ? (le reste peut changer) */
const memeCours = (avant, apres) =>
  String(avant?.groupe ?? '').trim() === String(apres?.groupe ?? '').trim() &&
  String(avant?.module ?? '').trim() === String(apres?.module ?? '').trim();

/**
 * Une écriture de séance est-elle permise sous verrou ?
 *
 * ⚠️ ELLE DOIT REMPLACER UNE SÉANCE EXISTANTE, ET GARDER SON COURS. Une case
 *    vide qu'on garnit ajoute des heures ; un module qu'on change les déplace
 *    d'un module à l'autre. Les deux rompent la correspondance avec le
 *    chronogramme sans que rien ne le signale.
 *
 * @returns {Promise<void>} lève un 409 si le geste est refusé
 */
export async function exigerCoursInchange(
  etablissementId,
  anneeScolaire,
  semaine,
  donnees,
  session = null
) {
  /*
   * ⚠️ LA CIBLE SE LIT COMME `poser()` LA CALCULE, sans quoi le verrou
   *    jugerait une autre case que celle qui sera écrite : avec un `id` c'est
   *    la séance désignée (un déplacement, ou une édition en vue par groupe),
   *    sinon la case du créneau.
   */
  const cible = donnees.id
    ? { _id: donnees.id, etablissementId, anneeScolaire }
    : {
        etablissementId,
        anneeScolaire,
        semaine,
        jour: donnees.jour,
        seance: donnees.seance,
        periode: donnees.periode,
        formateurMatricule: donnees.formateurMatricule,
      };

  const avant = await Seance.findOne(cible).select('groupe module').session(session).lean();

  if (!avant) throw refuser('ajouter une séance');
  if (!memeCours(avant, donnees)) {
    throw refuser(
      String(avant.module ?? '').trim() === String(donnees.module ?? '').trim()
        ? 'changer le groupe d’une séance'
        : 'changer le module d’une séance'
    );
  }
}
