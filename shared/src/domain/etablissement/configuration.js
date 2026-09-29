/**
 * Où en est la configuration initiale d'un établissement — ce qui est FAIT, lu dans les
 * données, pas dans la mémoire de l'écran.
 * ← demande du porteur (2026-09-20) : « qu'il enregistre les données des étapes si on est
 * déconnecté ou si le wifi coupe, qu'il retrouve ce qui est déjà fait pour continuer ; et
 * aucune page du directeur n'est accessible tant que les étapes ne sont pas terminées ».
 *
 * ═══ POURQUOI LIRE LES DONNÉES ═══
 * L'assistant garde son état dans le navigateur (l'étape courante, la voie choisie). Un
 * onglet fermé, une session expirée ou une coupure réseau l'efface — mais chaque étape a
 * ÉCRIT sa part en base. La progression se déduit donc de ce qui est écrit : un nom
 * abrégé, des espaces, une base, des formateurs, des groupes. C'est vrai sur tout
 * appareil, et cela ne demande aucun champ « étape atteinte » à tenir à jour.
 *
 * ⚠️ UNE SEULE DÉFINITION, POUR LES DEUX CÔTÉS : l'écran s'en sert pour REPRENDRE, le
 * serveur pour REFUSER de clore une configuration incomplète. Écrite deux fois, elle
 * finirait par dire deux choses — et l'écran proposerait de terminer ce que le serveur
 * refuse.
 *
 * L'étape 6 (affectations) n'y figure pas : elle ne produit rien d'obligatoire — un module
 * peut rester sans formateur — et se termine en l'atteignant.
 */
export const ETAPES_CONFIGURATION = ['identite', 'espaces', 'base', 'formateurs', 'carte'];

const estTeams = (espace) => String(espace ?? '').trim().toUpperCase() === 'TEAMS';

/**
 * @param {object} donnees
 * @param {string|null} [donnees.nomAbrege]
 * @param {string[]} [donnees.espaces]
 * @param {boolean} [donnees.baseExiste]
 * @param {number} [donnees.formateurs]  nombre de formateurs de la base
 * @param {number} [donnees.groupes]     nombre de groupes de la base
 * @returns {Record<'identite'|'espaces'|'base'|'formateurs'|'carte', boolean>}
 */
export function etapesConfigurationFaites({
  nomAbrege = null,
  espaces = [],
  baseExiste = false,
  formateurs = 0,
  groupes = 0,
} = {}) {
  return {
    // Le nom abrégé figure sur les documents : 2 caractères au moins, comme la saisie.
    identite: String(nomAbrege ?? '').trim().length >= 2,
    // ⚠️ « TEAMS » est créé d'office : il ne prouve pas que l'étape est faite. Il faut un
    // espace où recevoir en présentiel.
    espaces: espaces.some((espace) => !estTeams(espace)),
    base: Boolean(baseExiste),
    formateurs: formateurs > 0,
    carte: groupes > 0,
  };
}

/** Les étapes à faire encore, dans l'ordre du parcours. */
export function etapesConfigurationManquantes(faites) {
  return ETAPES_CONFIGURATION.filter((etape) => !faites?.[etape]);
}

/**
 * Le numéro (à partir de 1) de l'étape où REPRENDRE : la première non faite, ou la
 * dernière (6, les affectations) quand tout ce qui est obligatoire est fait.
 */
export function etapeDeReprise(faites) {
  const manquante = etapesConfigurationManquantes(faites)[0];
  return manquante ? ETAPES_CONFIGURATION.indexOf(manquante) + 1 : ETAPES_CONFIGURATION.length + 1;
}
