/**
 * L'état local des plannings de la page Chronogramme.
 *
 * ═══ POURQUOI CE FICHIER EXISTE SÉPARÉMENT ═══
 * Ces deux fonctions décident CE QUI SERA ÉCRIT EN BASE. Laissées dans le
 * composant, elles n'étaient vérifiables qu'à l'œil — et un défaut y a coûté une
 * perte de données réelle (voir ci-dessous). Pures et sorties du rendu, elles se
 * testent.
 *
 * ⚠️⚠️ L'INVARIANT À NE JAMAIS ROMPRE :
 *   « pas encore chargé » et « chargé et vide » sont DEUX ÉTATS DIFFÉRENTS.
 *
 * Ce qui s'est passé quand ils ont été confondus : un groupe dont la requête
 * n'avait pas répondu recevait `{}` en repli. L'amorçage l'écrivait dans l'état
 * local et ne le reprenait plus — la clé existait. À l'arrivée des données,
 * l'écart entre ce `{}` et le planning réel le faisait passer pour MODIFIÉ, et
 * l'enregistrement automatique écrivait une grille VIDE par-dessus le
 * chronogramme du groupe. Sans un clic, et sans rien à l'écran qui le dise.
 *
 * C'est l'ABSENCE DE LA CLÉ qui sépare les deux états — jamais une valeur vide.
 */

/**
 * Fond le planning des groupes qui viennent d'arriver dans l'état courant.
 *
 * ═══ ET SUIT LE SERVEUR QUAND UN COLLÈGUE ÉCRIT (Phase 5bis, étape d2) ═══
 * Le chronogramme se partage désormais : un invité enregistre un groupe, une
 * annonce fait relire la grille chez les autres. Sans ce qui suit, la copie
 * locale — déjà présente — l'emportait toujours, et l'écran restait sur l'état
 * d'avant : la relecture avait lieu, mais rien ne changeait à l'écran.
 *
 * La règle : un groupe dont la copie locale est ENCORE celle que le serveur
 * rendait (`precedents`) n'a pas de saisie en cours — il suit la nouvelle
 * version. Un groupe modifié localement garde sa saisie : l'enregistrement
 * automatique la réécrira, et la dernière écriture l'emporte (le verrou
 * optimiste des pages « tout ou rien » est l'étape d3).
 *
 * @param {object} courants    état local, saisie en cours comprise
 * @param {object} charges     plannings REÇUS du serveur — un groupe absent de
 *                             cet objet n'a pas encore répondu
 * @param {object} [precedents] ce que le serveur rendait AU TOUR D'AVANT
 * @returns {object} le MÊME objet `courants` si rien ne change, pour que React
 *                   n'ait pas de rendu à faire
 */
export function amorcerPlannings(courants, charges, precedents = {}) {
  const suivants = {};
  let change = false;

  for (const groupe of Object.keys(charges)) {
    if (groupe in courants) {
      // Une saisie en cours l'emporte TOUJOURS sur ce que le serveur renvoie :
      // un rafraîchissement de cache ne doit pas effacer ce qu'on est en train
      // d'écrire.
      const sansSaisie =
        groupe in precedents && empreinte(courants[groupe]) === empreinte(precedents[groupe]);
      const nouvelleVersion =
        groupe in precedents && empreinte(charges[groupe]) !== empreinte(precedents[groupe]);

      if (sansSaisie && nouvelleVersion) {
        suivants[groupe] = charges[groupe];
        change = true;
      } else {
        suivants[groupe] = courants[groupe];
      }
    } else {
      suivants[groupe] = charges[groupe];
      change = true;
    }
  }

  // Un groupe décoché disparaît : le garder ferait repartir une re-sélection de
  // sa saisie précédente plutôt que de ce qui est en base.
  if (Object.keys(suivants).length !== Object.keys(courants).length) change = true;

  return change ? suivants : courants;
}

/**
 * Quels groupes diffèrent de ce que porte la base ?
 *
 * ⚠️ On n'interroge QUE les groupes chargés. Un groupe en vol n'a pas d'état de
 * référence : le déclarer modifié revient à demander son écriture avant de
 * savoir ce qu'il contient.
 */
/**
 * La version sur laquelle repose la copie locale de chaque groupe
 * (Phase 5bis, étape d3).
 *
 * C'est elle qu'on renvoie à l'enregistrement : si un collègue a enregistré le
 * groupe entre-temps, le serveur refuse en 409 au lieu d'effacer son travail.
 *
 * ═══ LA RÈGLE ═══
 *   - la copie locale est IDENTIQUE à ce que le serveur rend → elle repose sur
 *     la version du serveur (adoptée, ou rejointe) ;
 *   - elle DIFFÈRE → une saisie est en cours : elle garde la version qu'elle
 *     avait. Prendre celle du serveur ferait passer la saisie par-dessus
 *     l'enregistrement du collègue — exactement ce qu'on veut refuser.
 *
 * ⚠️ PAR CONTENU, PAS PAR RÉFÉRENCE : un collègue qui enregistre la même chose
 * que nous nous remet d'accord avec le serveur, alors que les objets diffèrent.
 *
 * @param {Record<string, number>} versions  les versions retenues au tour d'avant
 * @param {Record<string, object>} plannings les copies locales, APRÈS amorçage
 * @param {Record<string, object>} charges   les plannings rendus par le serveur
 * @param {Record<string, number>} versionsServeur
 */
export function amorcerVersions(versions, plannings, charges, versionsServeur) {
  const suivantes = {};

  for (const groupe of Object.keys(plannings)) {
    if (!(groupe in charges)) continue;
    suivantes[groupe] =
      empreinte(plannings[groupe]) === empreinte(charges[groupe])
        ? (versionsServeur[groupe] ?? 0)
        : (versions[groupe] ?? versionsServeur[groupe] ?? 0);
  }

  return suivantes;
}

/**
 * Retire des groupes d'une copie locale — pour qu'`amorcerPlannings` les
 * reprenne du serveur comme s'ils arrivaient. C'est l'ADOPTION forcée qui suit
 * un 409 : la saisie refusée est abandonnée, la page repart de la base.
 */
export function omettreGroupes(plannings, groupes) {
  if (groupes.length === 0) return plannings;
  const reste = { ...plannings };
  for (const groupe of groupes) delete reste[groupe];
  return reste;
}

export function groupesModifies(plannings, charges) {
  return Object.keys(charges).filter(
    (groupe) =>
      plannings[groupe] &&
      empreinte(plannings[groupe]) !== empreinte(charges[groupe])
  );
}

/**
 * ═══ ⚠️⚠️ LA COMPARAISON DOIT PARLER LA LANGUE DU SERVEUR ═══
 * (défaut trouvé le 2026-08-26, signalé par le porteur : « les modifications ne
 * s'enregistrent pas, il reste en attente ».)
 *
 * `poserCellule` VIDE une cellule en retirant sa clé — le module reste, à `{}`.
 * `versMongo`, côté serveur, DROPPE un module sans séance. Après avoir effacé la
 * dernière heure d'un module, l'écran porte donc `{ M1: {} }` et la base rend
 * `{}` : la comparaison brute les déclare différents À TOUT JAMAIS.
 *
 * Conséquence exacte, et c'est le symptôme : `modifie` reste vrai, la minuterie
 * de `CadreReglage` ne se ré-arme pas, et l'en-tête affiche « Modification en
 * attente… » indéfiniment — alors que l'écriture a bien eu lieu.
 *
 * ⚠️ ON NORMALISE, ON NE « CORRIGE » PAS `poserCellule` : garder la clé à vide
 * est utile — c'est ce qui distingue un module qu'on vient de vider d'un module
 * jamais touché, et l'écran s'en sert. C'est la COMPARAISON qui doit appliquer
 * la même règle que l'écriture.
 */
function empreinte(planning) {
  const retenu = {};

  for (const module of Object.keys(planning ?? {}).sort()) {
    const cellules = {};
    for (const semaine of Object.keys(planning[module] ?? {}).sort((a, b) => Number(a) - Number(b))) {
      const cellule = planning[module][semaine];
      // Même filtre que `versMongo` : une cellule à zéro n'est pas enregistrée.
      if (Number(cellule?.heures) > 0) {
        cellules[semaine] = { heures: Number(cellule.heures), type: cellule.type };
      }
    }
    // ⚠️ Un module SANS séance disparaît, exactement comme à l'écriture.
    if (Object.keys(cellules).length > 0) retenu[module] = cellules;
  }

  return JSON.stringify(retenu);
}

/**
 * Pose dans une réponse du serveur le planning qu'un collègue vient
 * d'enregistrer, reçu avec l'annonce temps réel (2026-09-13).
 *
 * ═══ POURQUOI ═══ Relire le groupe coûtait un aller-retour après le
 * regroupement des annonces : la cellule changeait chez les autres une à deux
 * secondes plus tard. L'annonce porte désormais le planning et sa version ; on
 * les pose dans le cache, et l'amorçage fait le reste — la page les ADOPTE s'il
 * n'y a pas de saisie en cours, les garde pour le 409 sinon.
 *
 * Deux formes de réponse : celle d'UN groupe (`planning`, `version`) et celle
 * d'un formateur (`plannings`, `versions`, par groupe).
 *
 * ⚠️ JAMAIS UNE VERSION PLUS ANCIENNE : une annonce arrivée après une relecture
 * plus récente la ferait reculer. Rend le MÊME objet quand il n'y a rien à
 * poser — le cache ne re-rend alors rien.
 *
 * @param {object | undefined} donnees
 * @param {{ groupe: string, planning: object, version: number }} annonce
 */
export function integrerPlanning(donnees, { groupe, planning, version }) {
  if (!donnees || !planning || typeof version !== 'number') return donnees;

  if ('plannings' in donnees) {
    /*
     * ⚠️ UN GROUPE JAMAIS ENREGISTRÉ n'a pas d'entrée dans `plannings` (le serveur
     * ne rend que les chronogrammes existants), mais il a bien des LIGNES chez ce
     * formateur : son premier enregistrement doit s'y poser aussi.
     */
    const concerne =
      groupe in (donnees.plannings ?? {}) || (donnees.lignes ?? []).some((ligne) => ligne.groupe === groupe);
    if (!concerne) return donnees;
    if ((donnees.versions?.[groupe] ?? 0) >= version) return donnees;
    return {
      ...donnees,
      plannings: { ...donnees.plannings, [groupe]: planning },
      versions: { ...donnees.versions, [groupe]: version },
    };
  }

  if (donnees.groupe !== undefined && donnees.groupe !== groupe) return donnees;
  if ((donnees.version ?? 0) >= version) return donnees;
  return { ...donnees, planning, version };
}
