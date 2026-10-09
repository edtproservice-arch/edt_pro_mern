/**
 * Ce qu'il y a à placer cette semaine-là.
 *
 * ← l'étape 3 de `processSingleWeekGeneration` : le chronogramme dit COMBIEN
 * d'heures chaque groupe doit recevoir dans chaque module ; les affectations
 * disent QUI les assure. La jointure des deux donne les tâches.
 *
 * ⚠️ FONCTION PURE, SANS ACCÈS BASE : c'est la partie la plus délicate du pont
 *    — un module manqué, et des heures disparaissent de la semaine sans qu'aucune
 *    erreur ne le dise. Elle se teste donc sur des données littérales.
 */

import { MOTIFS_IGNOREE, PERIODES, TYPES_COURS } from 'shared/constants';
import { cleModule, DUREE_SOIR, estGroupeDuSoir, partsDeCellule } from 'shared/domain';
import { separerFusion, semestreDe } from 'shared/domain';

/** Durée d'une séance de jour, en heures. ← `Math.ceil(heures / 2.5)` de l'ancien. */
export const DUREE_SEANCE = 2.5;

/**
 * ═══ LE COURS DU SOIR (CDS) : JOUR OU SOIR, SELON LE VOLUME ═══
 * (2026-10-09, demande du porteur.) Pour un groupe « (CDS) », le présentiel
 * d'une cellule se lit sur son volume :
 *  · qui ne se découpe qu'en séances de 2 h (2, 4, 6, 8, 12) → le SOIR ;
 *  · qui ne se découpe qu'en séances de 2,5 h (2,5, 5, 7,5) → le JOUR, de
 *    préférence le samedi (voir `construireProbleme`).
 *
 * ⚠️ 10 H SE DÉCOUPE DES DEUX FAÇONS (5 × 2 ou 4 × 2,5). Règle du porteur :
 *    on regarde les AUTRES cellules du groupe cette semaine-là — de 2 h ou
 *    4 h, le soir ; de 2,5 h ou 5 h, le jour. Si la semaine ne tranche pas
 *    (10 h seul, ou les deux sortes à la fois), le jour : c'est ce que la
 *    génération faisait avant cette règle.
 */
const multiple = (heures, duree) =>
  heures > 0 && Math.abs(heures / duree - Math.round(heures / duree)) < 1e-9;
const seulementSoir = (heures) => multiple(heures, DUREE_SOIR) && !multiple(heures, DUREE_SEANCE);
const seulementJour = (heures) => multiple(heures, DUREE_SEANCE) && !multiple(heures, DUREE_SOIR);

/**
 * La période d'une part de cellule. Hors CDS ou hors présentiel : le jour.
 *
 * @param {{soir?: boolean, jour?: boolean}} semaineDuGroupe — la semaine du
 *   groupe compte-t-elle des cellules qui ne vont qu'au soir, qu'au jour ?
 */
export function periodeDe(groupe, type, heures, semaineDuGroupe = {}) {
  if (type !== TYPES_COURS.PRESENTIEL || !estGroupeDuSoir(groupe)) return PERIODES.JOUR;
  if (seulementSoir(heures)) return PERIODES.SOIR;
  if (seulementJour(heures)) return PERIODES.JOUR;
  if (multiple(heures, DUREE_SOIR) && semaineDuGroupe.soir && !semaineDuGroupe.jour) {
    return PERIODES.SOIR;
  }
  return PERIODES.JOUR;
}

/** Les cellules présentielles d'un groupe, cette semaine : y en a-t-il « soir seul », « jour seul » ? */
function sortesDeLaSemaine(planning, numero) {
  const sortes = { soir: false, jour: false };
  for (const cellules of Object.values(planning ?? {})) {
    const heures = partsDeCellule(cellules?.[numero]).P;
    if (seulementSoir(heures)) sortes.soir = true;
    if (seulementJour(heures)) sortes.jour = true;
  }
  return sortes;
}

/** Le chronogramme écrit 'P' / 'S' ; les affectations 'presentiel' / 'synchrone'. */
const TYPE_CHRONO = { P: TYPES_COURS.PRESENTIEL, S: TYPES_COURS.SYNCHRONE };

/**
 * L'ordre de traitement, repris à l'identique de `getPriorityLevel`.
 *
 * ⚠️ PLUS PETIT = TRAITÉ D'ABORD. Un EFM régional du premier semestre passe
 *    avant tout le reste : c'est une date nationale, il n'y a pas de latitude.
 *    Un module non régional du second semestre passe en dernier — s'il reste
 *    des séances non placées, c'est là qu'on veut qu'elles soient.
 */
const PRIORITES = {
  'regional:S1': 1,
  'regional:A': 2,
  'normal:S1': 3,
  'normal:A': 4,
  'regional:S2': 5,
  'normal:S2': 6,
};
const PRIORITE_PAR_DEFAUT = 7;

export function prioriteDe(estRegional, semestre) {
  return PRIORITES[`${estRegional ? 'regional' : 'normal'}:${semestre}`] ?? PRIORITE_PAR_DEFAUT;
}

/**
 * L'affectation qui porte ce (groupe, module, type).
 *
 * ⚠️ LE LIBELLÉ D'UNE AFFECTATION PEUT ÊTRE UNE FUSION (« GM101 GM102 ») : on
 *    cherche le groupe PARMI ses membres, avec `separerFusion` — qui ne coupe
 *    pas avant un suffixe. Découper sur les espaces fabriquerait les groupes
 *    fantômes « ACADA101 » et « (FQ) », et le vrai groupe ressortirait sans
 *    aucun module : le défaut déjà constaté sur les données réelles.
 */
function affectationDe(affectations, groupe, module, type) {
  const cherche = String(groupe).trim().toUpperCase();
  return affectations.find(
    (affectation) =>
      String(affectation.module ?? '').trim() === module &&
      (affectation.type ?? TYPES_COURS.PRESENTIEL) === type &&
      separerFusion(affectation.groupe).some((nom) => nom.toUpperCase() === cherche)
  );
}

/**
 * Construit les tâches de la semaine `numero`.
 *
 * @param {object} entrees
 * @param {Array<{groupe: string, planning: object}>} entrees.chronogrammes — `planning` déjà converti par `depuisMongo`
 * @param {Array} entrees.affectations — `Base.affectations`
 * @param {number} entrees.numero — numéro de semaine scolaire
 * @returns {{taches: Array, ignorees: Array}}
 */
export function tachesDeLaSemaine({
  chronogrammes = [],
  affectations = [],
  groupes = [],
  /**
   * `GROUPE||MODULE` → salles où ce cours doit se donner (2026-09-23).
   *
   * ⚠️ LA SALLE VIENT DU MODULE, PAS DU FORMATEUR. Jusqu'ici — et dans l'ancien
   *    EDT Pro — elle n'était attribuée qu'au formateur. Un atelier de soudure
   *    est pourtant imposé par la MATIÈRE, pas par la personne qui l'enseigne.
   */
  sallesAffectations = {},
  numero,
}) {
  const parEmpreinte = new Map();
  const ignorees = [];

  /*
   * ═══ ⚠️ QUELS GROUPES LA CARTE CONNAÎT-ELLE, TOUS MODULES CONFONDUS ═══
   * (2026-09-22) Sans cet ensemble, on ne peut pas distinguer « ce module n'est
   * affecté à personne » de « ce groupe n'existe pas ». Les deux arrivaient
   * sous le même message, et il envoyait chercher au mauvais endroit : mesuré
   * sur l'année réelle, **les 39 cas étaient des groupes absents**, aucun
   * n'était un module non affecté.
   *
   * ⚠️ MÊME RÈGLE D'APPARIEMENT QUE `affectationDe` — `separerFusion` puis
   *    majuscules. Une comparaison plus simple ferait passer pour absent un
   *    groupe que la carte porte dans une fusion (« OPCM101 OPCM102 »), et on
   *    conseillerait de supprimer un chronogramme parfaitement valide.
   */
  const groupesDeLaCarte = new Set();
  /*
   * ⚠️⚠️ `base.groupes` D'ABORD, ET C'EST UN CORRECTIF (2026-09-22, même jour) :
   *    la première version ne lisait que les AFFECTATIONS. Un groupe déclaré
   *    dans la carte mais dont aucun module n'est encore attribué serait alors
   *    passé pour « absent de la carte », et l'écran aurait conseillé de
   *    **supprimer son chronogramme** — alors qu'il suffit d'affecter ses
   *    modules. Détruire la planification d'un groupe vivant sur un mauvais
   *    diagnostic est le pire dégât que cet écran puisse causer.
   *
   * ⚠️ `chargerCommun` ne chargeait même pas ce champ : le défaut était donc
   *    invisible depuis `taches.js` seul.
   */
  for (const groupe of groupes) {
    for (const nom of separerFusion(groupe)) {
      groupesDeLaCarte.add(nom.toUpperCase());
    }
  }
  for (const affectation of affectations) {
    for (const nom of separerFusion(affectation.groupe)) {
      groupesDeLaCarte.add(nom.toUpperCase());
    }
  }

  for (const { groupe, planning } of chronogrammes) {
    const semaineDuGroupe = estGroupeDuSoir(groupe) ? sortesDeLaSemaine(planning, numero) : {};
    for (const [module, cellules] of Object.entries(planning ?? {})) {
      /*
       * ⚠️ UNE CASE MIXTE (2026-10-01) porte du présentiel ET du synchrone la
       * même semaine : chaque part devient sa propre tâche, avec SON
       * affectation — exactement comme deux cases.
       */
      const parts = partsDeCellule(cellules?.[numero]);
      for (const [cleType, heures] of [['P', parts.P], ['S', parts.S]]) {
      if (heures <= 0) continue;

      const type = TYPE_CHRONO[cleType] ?? TYPES_COURS.PRESENTIEL;
      const affectation = affectationDe(affectations, groupe, module, type);

      /*
       * ⚠️ UN MODULE PLANIFIÉ SANS AFFECTATION EST SIGNALÉ, PAS TU. L'ancien
       *    faisait `if (affectation)` sans `else` : les heures disparaissaient
       *    de la génération, et rien — ni rapport, ni journal — ne disait
       *    qu'un module entier n'avait pas été placé. C'est le cas typique
       *    d'une carte remaniée sous un chronogramme resté en place.
       */
      if (!affectation) {
        ignorees.push({
          groupe,
          module,
          type,
          heures,
          motif: groupesDeLaCarte.has(String(groupe).trim().toUpperCase())
            ? MOTIFS_IGNOREE.MODULE_NON_AFFECTE
            : MOTIFS_IGNOREE.GROUPE_ABSENT,
        });
        continue;
      }

      /*
       * ═══ ⚠️ C'EST LA FUSION QUI FAIT LA SÉANCE ═══
       * Une séance synchrone mutualisée figure dans le chronogramme de CHACUN
       * de ses groupes — elle n'est pourtant donnée qu'UNE fois. L'empreinte
       * porte donc le libellé fusionné, le module et le formateur.
       *
       * ⚠️ PAS LA CLÉ DE L'ANCIEN (`formateur|module|sessionsNeeded`), qui
       *    dédoublonnait sur le VOLUME : deux séances du même formateur dans le
       *    même module, de durées différentes, ne fusionnaient pas — et de
       *    durées égales fusionnaient à tort. C'est la correction du
       *    2026-08-19 sur le bilan de charge (`empreinteSeance`), appliquée
       *    ici.
       */
      const libelle = String(affectation.groupe ?? groupe).trim() || groupe;
      const formateur = String(affectation.formateur ?? '').trim();
      const periode = periodeDe(groupe, type, heures, semaineDuGroupe);
      // ⚠️ LA PÉRIODE ENTRE DANS L'EMPREINTE : un soir et un jour ne se fusionnent pas.
      const empreinte = `${libelle}||${module}||${formateur}||${type}||${periode}`;

      const existante = parEmpreinte.get(empreinte);
      if (existante) {
        /*
         * ⚠️ LE MAXIMUM, PAS LA SOMME. Les deux groupes d'une fusion portent la
         *    même séance : additionner leurs heures la compterait deux fois et
         *    doublerait le volume à poser. Si leurs chronogrammes divergent —
         *    état incohérent que rien n'empêche — on retient le plus grand,
         *    comme la feuille de charge du classeur.
         */
        existante.heures = Math.max(existante.heures, heures);
        if (!existante.groupes.includes(groupe)) existante.groupes.push(groupe);
        continue;
      }

      const semestre = semestreDe(affectation.s1Heures, affectation.s2Heures);

      parEmpreinte.set(empreinte, {
        id: empreinte,
        formateurMatricule: formateur,
        /** Le libellé à ÉCRIRE dans la séance — fusionné pour une séance mutualisée. */
        groupeLibelle: libelle,
        /** Les membres, pour les conflits de groupe. */
        groupes: [groupe],
        module,
        type,
        heures,
        estRegional: Boolean(affectation.estRegional),
        /*
         * ⚠️ LE LIBELLÉ DU CHRONOGRAMME, PAS CELUI DE LA FUSION : les salles
         *    sont déclarées groupe par groupe dans la carte, et une séance
         *    mutualisée porte un libellé fusionné qui n'y figure pas.
         */
        sallesModule: sallesAffectations[cleModule(groupe, module)] ?? [],
        semestre,
        priorite: prioriteDe(Boolean(affectation.estRegional), semestre),
        periode,
        /** Un groupe du cours du soir : son cours de JOUR se donne de préférence le samedi. */
        cds: estGroupeDuSoir(groupe),
      });
      }
    }
  }

  const taches = [...parEmpreinte.values()].map((tache) => ({
    ...tache,
    /*
     * ⚠️ LES MEMBRES VIENNENT DU LIBELLÉ, pas des chronogrammes lus. Un groupe
     *    d'une fusion peut n'avoir aucune cellule cette semaine-là — son
     *    chronogramme est en retard, ou il a été vidé : il reçoit quand même la
     *    séance, et son créneau doit être réservé. Ne compter que les groupes
     *    rencontrés laisserait poser un autre cours au même moment pour lui.
     */
    groupes: separerFusion(tache.groupeLibelle),
    // ⚠️ 2 H AU SOIR, 2,5 H LE JOUR (`DUREE_SOIR`, la durée de la grille du soir).
    seancesRequises: Math.ceil(
      tache.heures / (tache.periode === PERIODES.SOIR ? DUREE_SOIR : DUREE_SEANCE) - 1e-9
    ),
  }));

  return { taches, ignorees };
}
