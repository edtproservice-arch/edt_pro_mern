import { cleEnsemble, estActif } from './bilanCharge.js';
import { separerFusion } from './reconstruction.js';

/**
 * Opérations d'affectation en masse sur la carte.
 * ← copyFormateursFromGroup() et l'onglet synchrone de affectation-carte.js
 *
 * Ce sont des RÈGLES, pas de la plomberie d'écran : qui couvre quoi, et ce que
 * la copie a le droit d'écraser. Elles vivent donc ici, testées, plutôt que
 * dans le composant — c'est la règle de couches du §10.1.
 *
 * Toutes rendent un NOUVEAU tableau de groupes ; aucune ne modifie l'entrée.
 */

/** Un module est identifié par son code, à défaut par son intitulé. */
function cleModule(module) {
  return module?.code || module?.nom || '';
}

/**
 * Reporte les formateurs présentiels d'un groupe sur les autres groupes de son
 * ensemble.
 *
 * C'est l'affectation en masse : les groupes d'un même ensemble suivent les
 * mêmes modules, et au-delà de deux groupes, ressaisir la même colonne module
 * par module n'est pas praticable.
 *
 * ⚠️ Un module que la source ne porte PAS est laissé tel quel. La copie
 * remplace ce qu'elle recouvre, elle n'efface pas ce qu'elle ignore — sinon
 * copier depuis un groupe amputé d'un module viderait ce module partout.
 *
 * @returns {{groupes: Array, touches: number}}
 */
export function copierAffectationsPresentiel(groupes, nomSource) {
  const source = groupes.find((groupe) => groupe.nom === nomSource);
  if (!source) return { groupes, touches: 0 };

  const parModule = new Map(
    (source.modules ?? []).map((module) => [cleModule(module), module.formateurPresentiel ?? ''])
  );

  let touches = 0;

  const resultat = groupes.map((groupe) => {
    if (groupe.nom === nomSource || cleEnsemble(groupe) !== cleEnsemble(source)) return groupe;

    touches += 1;

    return {
      ...groupe,
      modules: (groupe.modules ?? []).map((module) => {
        const formateur = parModule.get(cleModule(module));
        return formateur === undefined ? module : { ...module, formateurPresentiel: formateur };
      }),
    };
  });

  return { groupes: resultat, touches };
}

/**
 * Séances synchrones d'un module, telles qu'elles sont enregistrées.
 * ← `synchroneAssignments[filiereKey][moduleKey]` de affectation-carte.js:1860
 *
 * ═══ POURQUOI DES LIGNES, ET PAS UN FORMATEUR PAR ENSEMBLE ═══
 * Un module synchrone peut donner lieu à PLUSIEURS séances dans le même
 * ensemble : dix groupes ne tiennent pas dans une seule classe Teams, et deux
 * formateurs peuvent se partager la promotion. Chaque ligne est une séance :
 * un formateur, et les groupes qu'elle couvre. C'était le modèle de l'existant,
 * et le réduire à un formateur unique retirait une possibilité réellement
 * utilisée.
 *
 * @returns {Array<{formateur: string, groupes: string[]}>}
 */
export function lignesSynchrone(groupes, cle, module) {
  const parSeance = new Map();

  for (const groupe of groupes) {
    if (cleEnsemble(groupe) !== cle) continue;

    const trouve = (groupe.modules ?? []).find((m) => cleModule(m) === module);
    const formateur = trouve?.formateurSynchrone;
    if (!formateur) continue;

    /*
     * ⚠️ UNE SÉANCE = UN FORMATEUR **ET** UNE FUSION (corrigé le 2026-08-19).
     *
     * Le regroupement se faisait sur le seul formateur. Deux séances distinctes
     * assurées par la même personne — GM101 sur l'une, GM102 sur l'autre —
     * étaient donc RÉUNIES en une ligne unique portant les deux groupes : la
     * séparation faite à l'écran disparaissait au rechargement, et les groupes
     * repartaient fusionnés.
     *
     * `groupeFusion` vide ne veut pas dire « inconnu » mais « fusionné avec
     * personne » : c'est ce qu'écrit la reconstruction pour une affectation à un
     * seul groupe. Le nom du groupe fait alors l'identité de la séance.
     */
    const fusion = String(trouve.groupeFusion ?? '').trim() || groupe.nom;
    const empreinte = `${formateur}||${fusion}`;

    if (!parSeance.has(empreinte)) parSeance.set(empreinte, { formateur, groupes: [] });
    parSeance.get(empreinte).groupes.push(groupe.nom);
  }

  return [...parSeance.values()];
}

/**
 * Formateur présentiel le plus représenté sur un module, dans un ensemble.
 * ← formateurPresentielDominant()
 *
 * « Dominant » et non « le premier » : si trois groupes sur quatre ont le même
 * formateur, c'est lui qui assurera vraisemblablement la séance synchrone.
 */
export function formateurPresentielDominant(groupes, cle, module) {
  const comptes = new Map();

  for (const groupe of groupes) {
    if (cleEnsemble(groupe) !== cle) continue;

    const trouve = (groupe.modules ?? []).find((m) => cleModule(m) === module);
    const formateur = trouve?.formateurPresentiel;
    if (!formateur) continue;

    comptes.set(formateur, (comptes.get(formateur) ?? 0) + 1);
  }

  let meilleur = '';
  let maximum = 0;
  for (const [nom, n] of comptes) {
    if (n > maximum) {
      maximum = n;
      meilleur = nom;
    }
  }

  return meilleur;
}

/**
 * Séance synchrone proposée par défaut pour un module.
 * ← appliquerDefautsSynchrone()
 *
 * Le formateur présentiel dominant, et TOUS les groupes de l'ensemble : c'est
 * le cas courant, celui qui fait gagner le plus de saisie. La proposition ne
 * vaut que tant que le directeur n'a pas touché au synchrone de ce module —
 * l'appelant le sait en regardant si une entrée explicite existe.
 *
 * @returns {{formateur: string, groupes: string[]}|null}
 */
export function defautSynchrone(groupes, cle, module) {
  const formateur = formateurPresentielDominant(groupes, cle, module);
  if (!formateur) return null;

  const couverts = groupes
    .filter(
      (groupe) =>
        cleEnsemble(groupe) === cle && (groupe.modules ?? []).some((m) => cleModule(m) === module)
    )
    .map((groupe) => groupe.nom);

  return couverts.length > 0 ? { formateur, groupes: couverts } : null;
}

/**
 * Table des séances effectivement retenues : les choix explicites du directeur,
 * complétés par les propositions par défaut pour les modules qu'il n'a pas
 * touchés.
 *
 * Une entrée explicite — même un tableau vide — l'emporte toujours : elle
 * signifie « j'ai décidé », y compris « aucune séance ». C'est le rôle que
 * `synchroneTouched` jouait dans l'existant.
 */
export function synchronesEffectifs(groupes, table = {}) {
  const effectifs = {};

  for (const groupe of groupes) {
    const cle = cleEnsemble(groupe);

    for (const module of groupe.modules ?? []) {
      if (!estActif(module)) continue;
      if ((module.mhsynS1 ?? 0) + (module.mhsynS2 ?? 0) <= 0) continue;

      const code = cleModule(module);
      if (effectifs[cle]?.[code] !== undefined) continue;

      const explicite = table[cle]?.[code];

      let lignes = explicite;
      if (lignes === undefined) {
        /*
         * ⚠️ CE QUI EST DÉJÀ AFFECTÉ PASSE AVANT LA PROPOSITION
         * (corrigé le 2026-08-19)
         *
         * `table` ne contient que ce que le directeur a touché DEPUIS
         * l'ouverture de l'écran. Au rechargement d'une carte enregistrée, elle
         * est vide — et on retombait droit sur `defautSynchrone`, c'est-à-dire
         * le formateur présentiel dominant et TOUS les groupes de l'ensemble.
         *
         * Autrement dit : les séances réellement enregistrées étaient écrasées
         * à l'affichage par une proposition, et deux séances séparées
         * réapparaissaient fusionnées. La proposition n'a de sens que lorsque
         * RIEN n'est affecté — c'est ce que faisait `appliquerDefautsSynchrone`,
         * qui ne s'appliquait qu'aux modules encore vierges.
         */
        const existantes = lignesSynchrone(groupes, cle, code);

        if (existantes.length > 0) {
          lignes = existantes;
        } else {
          const propose = defautSynchrone(groupes, cle, code);
          lignes = propose ? [propose] : [];
        }
      }

      effectifs[cle] = { ...effectifs[cle], [code]: lignes };
    }
  }

  // Entrées explicites portant sur des modules absents des groupes : conservées
  // telles quelles plutôt que perdues silencieusement.
  for (const [cle, modules] of Object.entries(table)) {
    for (const [code, lignes] of Object.entries(modules)) {
      if (effectifs[cle]?.[code] === undefined) {
        effectifs[cle] = { ...effectifs[cle], [code]: lignes };
      }
    }
  }

  return effectifs;
}

/**
 * Projette toutes les séances synchrones sur les groupes, avant enregistrement.
 *
 * ═══ POURQUOI LES LIGNES SONT UN ÉTAT À PART ═══
 * Une ligne en cours de saisie — formateur non choisi, aucun groupe coché — ne
 * laisse aucune trace sur les groupes. Si l'écran la DÉDUISAIT d'eux, elle
 * disparaîtrait à l'instant où on l'ajoute : le bouton « + Formateur »
 * semblerait sans effet. L'existant tenait donc ces lignes dans sa propre
 * structure (`synchroneAssignments`), et elles ne sont reportées sur les
 * groupes qu'au moment d'enregistrer. Même choix ici.
 *
 * @param {Array} groupes
 * @param {Record<string, Record<string, Array>>} table  cle d'ensemble → module → lignes
 */
export function projeterSynchrones(groupes, table = {}) {
  let resultat = groupes;

  for (const [cle, modules] of Object.entries(table)) {
    for (const [module, lignes] of Object.entries(modules)) {
      resultat = definirLignesSynchrone(resultat, cle, module, lignes);
    }
  }

  return resultat;
}

/**
 * Enregistre les séances synchrones d'un module pour un ensemble.
 *
 * Chaque groupe reçoit le formateur de la ligne qui le couvre, et la liste des
 * groupes de CETTE ligne dans `groupeFusion` — la colonne « FusionGroupe » que
 * l'import e-note relit. Un groupe absent de toute ligne est remis à zéro.
 *
 * ⚠️ Un groupe ne peut appartenir qu'à UNE ligne : il ne suit qu'une séance.
 * En cas de doublon, la première ligne l'emporte — silencieusement le priver
 * des deux serait pire.
 *
 * N'écrit JAMAIS `formateurPresentiel` : présentiel et synchrone sont deux
 * affectations distinctes, portées par deux champs distincts.
 *
 * @param {Array<{formateur: string, groupes: string[]}>} lignes
 */
export function definirLignesSynchrone(groupes, cle, module, lignes = []) {
  const parGroupe = new Map();

  for (const ligne of lignes) {
    if (!ligne?.formateur) continue;

    for (const nom of ligne.groupes ?? []) {
      if (parGroupe.has(nom)) continue;
      parGroupe.set(nom, {
        formateur: ligne.formateur,
        fusion: (ligne.groupes ?? []).join(' '),
      });
    }
  }

  return groupes.map((groupe) => {
    if (cleEnsemble(groupe) !== cle) return groupe;

    const seance = parGroupe.get(groupe.nom);

    return {
      ...groupe,
      modules: (groupe.modules ?? []).map((m) =>
        cleModule(m) === module
          ? {
              ...m,
              formateurSynchrone: seance?.formateur ?? '',
              groupeFusion: seance?.fusion ?? '',
            }
          : m
      ),
    };
  });
}

/**
 * Active ou désactive un module dans tous les groupes d'un ensemble.
 * ← setModuleActif() + le commutateur de la matrice, affectation-carte.js:1748
 *
 * Un établissement ne dispense pas toujours tous les modules de la répartition
 * DRIF : stage reporté, module mutualisé ailleurs, filière allégée. L'existant
 * RETIRAIT alors le module des groupes ; ici il est marqué inactif et reste
 * visible — le réactiver ne demande donc pas de le retrouver dans la
 * répartition, et son historique d'affectation n'est pas perdu entre-temps.
 *
 * Un module inactif est ignoré partout : bilan de charge, et lignes e-note
 * produites à l'enregistrement.
 */
export function activerModule(groupes, cle, module, actif) {
  return groupes.map((groupe) => {
    if (cleEnsemble(groupe) !== cle) return groupe;

    return {
      ...groupe,
      modules: (groupe.modules ?? []).map((m) =>
        cleModule(m) === module ? { ...m, actif } : m
      ),
    };
  });
}

/**
 * Modes de formation dont la masse horaire s'écarte de la répartition DRIF.
 * ← getGroupsWithEditableHours() : tout sauf « Résidentiel »
 *
 * Un groupe alterné ou par apprentissage passe une partie de l'année en
 * entreprise : ses heures de présentiel ne sont pas celles du référentiel, et
 * les y forcer fausse l'avancement (F7) autant que l'emploi du temps.
 */
export const MODES_MASSE_MODIFIABLE = ['Alterné', 'Par apprentissage'];

/** La masse horaire de ce groupe peut-elle être ajustée ? */
export function masseModifiable(groupe) {
  return MODES_MASSE_MODIFIABLE.includes(groupe?.mode);
}

/**
 * Ajuste la masse horaire présentielle d'un module, pour UN groupe.
 * ← setModuleMhp()
 *
 * ⚠️ Différence assumée avec l'existant : il appliquait l'ajustement à tous les
 * groupes non résidentiels de l'ensemble d'un coup. Depuis qu'un ensemble peut
 * mélanger les modes — un groupe résidentiel et un groupe alterné dans la même
 * filière — cette maille est trop grossière : deux groupes alternés peuvent
 * avoir des rythmes d'alternance différents. L'ajustement est donc par groupe.
 *
 * `valeur` à `null` rétablit la masse de la répartition DRIF, conservée dans
 * `reference` à la génération du groupe.
 */
export function definirMasseHoraire(groupes, nomGroupe, module, champ, valeur) {
  if (champ !== 'mhpS1' && champ !== 'mhpS2') {
    throw new TypeError('definirMasseHoraire attend le champ mhpS1 ou mhpS2');
  }

  return groupes.map((groupe) => {
    if (groupe.nom !== nomGroupe) return groupe;

    // Un groupe résidentiel suit la répartition à la lettre : lui laisser
    // modifier ses heures ferait diverger l'avancement du référentiel.
    if (!masseModifiable(groupe)) return groupe;

    return {
      ...groupe,
      modules: (groupe.modules ?? []).map((m) => {
        if (cleModule(m) !== module) return m;

        if (valeur === null) {
          const reference = m.reference ?? {};
          return {
            ...m,
            mhpS1: reference.mhpS1 ?? m.mhpS1,
            mhpS2: reference.mhpS2 ?? m.mhpS2,
            masseAjustee: false,
          };
        }

        const nombre = Math.max(0, Number.parseFloat(valeur) || 0);
        return { ...m, [champ]: nombre, masseAjustee: true };
      }),
    };
  });
}

/**
 * Libère les affectations qui désignent un formateur absent de la liste.
 * ← ce que faisait `supprimerFormateur()` avant d'enregistrer
 *
 * Un nom resté sur un module après le retrait de son formateur produirait un
 * formateur inconnu à l'enregistrement — l'import le recréerait alors sans
 * matricule ni masse horaire.
 */
export function libererFormateursInconnus(groupes, formateurs) {
  const connus = new Set(
    formateurs.map((formateur) =>
      String(formateur?.nom ?? '')
        .trim()
        .toUpperCase()
    )
  );

  const estConnu = (nom) => nom !== '' && connus.has(String(nom).trim().toUpperCase());

  return groupes.map((groupe) => ({
    ...groupe,
    modules: (groupe.modules ?? []).map((module) => ({
      ...module,
      formateurPresentiel: estConnu(module.formateurPresentiel) ? module.formateurPresentiel : '',
      formateurSynchrone: estConnu(module.formateurSynchrone) ? module.formateurSynchrone : '',
    })),
  }));
}

/**
 * Applique des renommages de groupes PARTOUT où la carte cite un groupe.
 * ← desambiguiserFilieresExistantes(), côté état de l'écran
 *
 * ⚠️ LE NOM DU GROUPE NE SUFFIT PAS (2026-09-11). Une séance synchrone cite ses
 * groupes à deux autres endroits : la fusion portée par chaque module
 * (« GE101 GE102 »), et la table des séances saisies à l'écran. Renommer le
 * seul groupe laissait ces deux-là sur l'ancien nom — la séance ne couvrait plus
 * personne et disparaissait au rendu suivant, sans un message.
 *
 * @param {Array} groupes
 * @param {Record<string, Record<string, Array<{formateur, groupes}>>>} table
 * @param {Array<{ancien: string, nouveau: string}>} renommages
 * @returns {{groupes: Array, table: object}}
 */
export function renommerGroupes(groupes, table, renommages = []) {
  const correspondance = new Map(renommages.map(({ ancien, nouveau }) => [ancien, nouveau]));
  if (correspondance.size === 0) return { groupes, table };

  const renomme = (nom) => correspondance.get(nom) ?? nom;
  // `separerFusion`, jamais un découpage sur les espaces : « GE101 (GC) » en
  // contient une, et serait coupé en deux groupes fantômes.
  const renommeFusion = (fusion) =>
    fusion ? separerFusion(fusion).map(renomme).join(' ') : fusion;

  return {
    groupes: groupes.map((groupe) => ({
      ...groupe,
      nom: renomme(groupe.nom),
      modules: (groupe.modules ?? []).map((module) =>
        module.groupeFusion ? { ...module, groupeFusion: renommeFusion(module.groupeFusion) } : module
      ),
    })),
    table: Object.fromEntries(
      Object.entries(table ?? {}).map(([cle, modules]) => [
        cle,
        Object.fromEntries(
          Object.entries(modules).map(([code, lignes]) => [
            code,
            (lignes ?? []).map((ligne) => ({ ...ligne, groupes: (ligne.groupes ?? []).map(renomme) })),
          ])
        ),
      ])
    ),
  };
}
