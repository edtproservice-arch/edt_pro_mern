import crypto from 'node:crypto';

import { SALLES_SANS_CONFLIT } from 'shared/domain';

/**
 * Pseudonymisation des traces de génération (F6 · étape d).
 *
 * ═══ POURQUOI UN HACHAGE PLUTÔT QU'UNE TABLE ═══ (décision du porteur,
 * 2026-09-21 : « pseudonymiser dès l'écriture ».) Une table de correspondance
 * devrait être tenue, protégée, et rendrait la trace réversible par quiconque y
 * accède. Un HMAC à sel stable donne les deux propriétés recherchées d'un coup :
 * le même formateur porte le même pseudonyme d'une semaine à l'autre — ce qu'un
 * modèle de préférence a besoin de voir — et le corpus reste irréversible tant
 * que le sel ne quitte pas la production.
 *
 * ⚠️ LE SEL VIT DANS `AutoGenConfig`, JAMAIS DANS LA TRACE. Le ranger à côté
 *    des données qu'il protège reviendrait à ne rien protéger du tout.
 */

const PREFIXES = {
  formateur: 'f',
  groupe: 'g',
  salle: 's',
};

/**
 * ⚠️ LE MODULE N'EST PAS PSEUDONYMISÉ, et c'est délibéré. « M107 » est un code
 *    du référentiel NATIONAL DRIF, pas une donnée d'établissement ni une donnée
 *    personnelle. Le garder en clair permet de recouper le corpus avec la
 *    répartition pour en tirer de vraies caractéristiques — masse horaire,
 *    métier, semestre. Le hacher rendrait ces jointures impossibles sans rien
 *    protéger de plus.
 */

/** Un sel neuf, tiré une fois par établissement. */
export const nouveauSel = () => crypto.randomBytes(32).toString('hex');

/**
 * @param {string} sel
 * @param {'formateur'|'groupe'|'salle'} type
 * @param {string} valeur
 * @returns {string} « f_3a9b2c1d4e », ou la chaîne vide si la valeur l'est.
 */
export function pseudonyme(sel, type, valeur) {
  const brut = String(valeur ?? '').trim();

  /*
   * ⚠️ UNE VALEUR ABSENTE RESTE ABSENTE. Lui fabriquer un pseudonyme créerait
   *    un formateur — ou une salle — qui n'existe pas, et le modèle
   *    apprendrait d'une entité inventée.
   */
  if (!brut) return '';

  /*
   * ⚠️ « TEAMS » ET « ABSENT » RESTENT EN CLAIR : ce ne sont pas des salles de
   *    l'établissement mais des valeurs de protocole, et c'est sur elles que se
   *    lit la nature d'une séance. Pseudonymisées, le corpus ne distinguerait
   *    plus le présentiel du distanciel sans jointure.
   */
  if (SALLES_SANS_CONFLIT.includes(brut)) return brut;

  /*
   * ⚠️ LE TYPE ENTRE DANS L'EMPREINTE : sans lui, un groupe et une salle
   *    portant le même libellé recevraient le même pseudonyme, et le corpus
   *    les confondrait.
   */
  const empreinte = crypto.createHmac('sha256', sel).update(`${type}|${brut}`).digest('hex');
  return `${PREFIXES[type] ?? 'x'}_${empreinte.slice(0, 10)}`;
}

/** L'identifiant d'une tâche, reconstruit sur les parties pseudonymisées. */
export const idTache = (sel, { groupeLibelle, module, formateurMatricule, type }) =>
  [
    pseudonyme(sel, 'groupe', groupeLibelle),
    module,
    pseudonyme(sel, 'formateur', formateurMatricule),
    type,
  ].join('||');

/**
 * Réécrit un problème et sa solution sur des pseudonymes.
 *
 * ⚠️ TOUT CE QUI NOMME DOIT Y PASSER — tâches, salles, incompatibilités,
 *    occupation, placements, non placées. Un seul champ oublié, et la trace
 *    porte encore un matricule en clair : la pseudonymisation ne vaut que par
 *    son exhaustivité.
 */
export function pseudonymiserTrace(sel, { probleme, taches, solution }) {
  const f = (v) => pseudonyme(sel, 'formateur', v);
  const g = (v) => pseudonyme(sel, 'groupe', v);
  const s = (v) => pseudonyme(sel, 'salle', v);

  /* L'ancien identifiant → le nouveau, pour réécrire la solution. */
  const ids = new Map(taches.map((t) => [t.id, idTache(sel, t)]));

  return {
    probleme: {
      ...probleme,
      salles: (probleme.salles ?? []).map((salle) => ({ ...salle, nom: s(salle.nom) })),
      taches: (probleme.taches ?? []).map((tache) => ({
        ...tache,
        id: ids.get(tache.id) ?? tache.id,
        formateur: f(tache.formateur),
        groupes: (tache.groupes ?? []).map(g),
        sallesPossibles: (tache.sallesPossibles ?? []).map(s),
        /*
         * ⚠️ LA LIGNE QUE LE SPREAD AURAIT LAISSÉE EN CLAIR (2026-09-23) :
         *    `...tache` recopie `sallesPreferees` telle quelle, et la trace
         *    aurait porté les vrais noms de salles à côté de leurs pseudonymes.
         *    « La pseudonymisation ne vaut que par son exhaustivité » — en-tête
         *    de ce fichier.
         *
         * ⚠️ ET LA TRACE SERAIT DEVENUE ILLISIBLE : les préférées doivent être
         *    un SOUS-ENSEMBLE des possibles, ce que `lecture.py` vérifie. Une
         *    trace rejouée aurait été refusée — un corpus d'entraînement muet.
         */
        sallesPreferees: (tache.sallesPreferees ?? []).map(s),
      })),
      incompatibilites: Object.fromEntries(
        Object.entries(probleme.incompatibilites ?? {}).map(([groupe, autres]) => [
          g(groupe),
          autres.map(g),
        ])
      ),
      occupation: (probleme.occupation ?? []).map((occ) => ({
        ...occ,
        formateur: f(occ.formateur),
        groupes: (occ.groupes ?? []).map(g),
        salle: occ.salle ? s(occ.salle) : null,
      })),
    },

    /*
     * Le descripteur enrichi, que le contrat Python ne porte pas : le module et
     * le type n'y voyagent pas, et sans eux ni l'écart ni les caractéristiques
     * d'entraînement ne se calculent.
     */
    taches: taches.map((tache) => ({
      id: ids.get(tache.id),
      formateur: f(tache.formateurMatricule),
      groupe: g(tache.groupeLibelle),
      groupes: (tache.groupes ?? []).map(g),
      module: tache.module,
      type: tache.type,
      heures: tache.heures,
      seancesRequises: tache.seancesRequises,
      estRegional: tache.estRegional,
      semestre: tache.semestre,
      priorite: tache.priorite,
    })),

    solution: {
      ...solution,
      placements: (solution.placements ?? []).map((p) => ({
        ...p,
        tacheId: ids.get(p.tacheId) ?? p.tacheId,
        salle: s(p.salle),
      })),
      nonPlacees: (solution.nonPlacees ?? []).map((n) => ({
        ...n,
        tacheId: ids.get(n.tacheId) ?? n.tacheId,
        groupe: n.groupe ? g(n.groupe) : undefined,
        formateur: n.formateur ? f(n.formateur) : undefined,
      })),
    },
  };
}
