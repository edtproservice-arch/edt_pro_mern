/**
 * Les filtres de la liste des formateurs (Paramètres → Formateurs).
 *
 * ⚠️ PURES, ET SORTIES DU COMPOSANT : elles décident QUI reste à l'écran — et donc
 * à qui l'on va cocher une salle ou une indisponibilité. Laissées dans le rendu,
 * elles n'étaient vérifiables qu'à l'œil.
 */

/** L'identifiant d'un formateur de la base — la règle de `parseBase`. */
export function identifiantFormateur(formateur) {
  const matricule = String(formateur?.matricule ?? '').trim();
  return matricule !== '' ? matricule : String(formateur?.nomComplet ?? '').trim();
}

/**
 * Cette salle est-elle ATTRIBUÉE à ce formateur ?
 *
 * ⚠️ PAR DÉFAUT, AUCUN LOCAL N'EST ATTRIBUÉ (2026-09-19, demande du porteur) : un
 * formateur dont on n'a rien coché n'a aucun local, il n'est donc retenu par aucun
 * filtre de salle — hors TEAMS, voir plus bas. Cela renverse la lecture du 2026-09-17 (« vide = toutes »), qui
 * faisait apparaître sous chaque salle des formateurs à qui personne ne l'avait
 * donnée. Rien ne change dans l'emploi du temps : sans salle attribuée, aucune n'y
 * est pré-remplie, et toutes restent au choix.
 */
export function peutUtiliser(contraintes, salle) {
  // ⚠️ « TEAMS » est attribué à TOUS les formateurs (2026-09-19, demande du porteur) :
  // un cours à distance n'a pas de local à réserver, et chacun peut le donner.
  if (estTeams(salle)) return true;
  return (contraintes?.espaces ?? []).includes(salle);
}

/**
 * « TEAMS » — le seul espace qui n'est pas un local : la classe à distance.
 * ⚠️ Il n'est JAMAIS écrit dans les espaces attribués d'un formateur (le domaine le
 * refuse : `normaliserContraintes` ne retient que des locaux, et `salleParDefaut`
 * pré-remplirait sinon TEAMS sur une séance en présentiel). Il est attribué à tous
 * par la lecture, pas par la donnée — un formateur ajouté demain l'a aussi.
 */
export const estTeams = (espace) => String(espace ?? '').trim().toUpperCase() === 'TEAMS';

/** Sans accent ni casse : « Éric » doit répondre à « eric ». */
const simplifier = (texte) =>
  String(texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/**
 * Le terme cherché figure-t-il dans le nom, le nom affiché, le matricule ou
 * l'adresse ? Chaque MOT du terme doit y figurer, dans n'importe quel ordre :
 * « laasal abdel » retrouve « ABDELGHANI LAASAL ».
 */
export function correspondALaRecherche(formateur, terme) {
  const mots = simplifier(terme).split(/\s+/).filter(Boolean);
  if (mots.length === 0) return true;

  const texte = simplifier(
    [formateur.nomComplet, formateur.nomUnique, formateur.matricule, formateur.email].join(' ')
  );
  return mots.every((mot) => texte.includes(mot));
}

export const MODE_INDISPONIBLES = 'indisponibles';
export const MODE_DISPONIBLES = 'disponibles';

/**
 * Le filtre par créneau.
 *
 *   - « indisponibles » : le formateur a déclaré AU MOINS UN des créneaux cochés
 *     indisponible — « qui ne peut pas le lundi matin ? » ;
 *   - « disponibles »   : il est libre sur TOUS les créneaux cochés — « qui puis-je
 *     placer sur ces quatre créneaux ? ».
 *
 * Les deux sens ne sont pas symétriques (« au moins un » / « tous ») : c'est ce
 * que chaque question demande, et l'écran le dit.
 *
 * @param {string[]} creneaux clés « Jour|S1 »
 */
export function correspondAuxCreneaux(contraintes, creneaux, mode) {
  if (creneaux.length === 0) return true;

  const indisponibles = new Set(
    (contraintes?.indisponibilites ?? []).map((c) => `${c.jour}|${c.seance}`)
  );

  return mode === MODE_DISPONIBLES
    ? creneaux.every((cle) => !indisponibles.has(cle))
    : creneaux.some((cle) => indisponibles.has(cle));
}

/**
 * Applique tous les filtres. Ils se CUMULENT : un formateur doit satisfaire
 * chacun de ceux qui sont actifs.
 *
 * @param {Array} formateurs
 * @param {object} filtres
 * @param {string}   [filtres.recherche]
 * @param {string[]} [filtres.retenus]  `nomComplet` cochés ; vide = tous
 * @param {string}   [filtres.salle]
 * @param {string[]} [filtres.creneaux]
 * @param {string}   [filtres.modeCreneaux]
 * @param {(formateur) => object|undefined} contraintesDe
 */
export function filtrerFormateurs(
  formateurs,
  { recherche = '', retenus = [], salle = '', creneaux = [], modeCreneaux = MODE_INDISPONIBLES },
  contraintesDe
) {
  const choisis = new Set(retenus);

  return formateurs.filter((formateur) => {
    if (choisis.size > 0 && !choisis.has(formateur.nomComplet)) return false;
    if (!correspondALaRecherche(formateur, recherche)) return false;

    const contraintes = contraintesDe(formateur);
    if (salle && !peutUtiliser(contraintes, salle)) return false;
    return correspondAuxCreneaux(contraintes, creneaux, modeCreneaux);
  });
}
