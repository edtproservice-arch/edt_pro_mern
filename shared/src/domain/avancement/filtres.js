import { SEMESTRES } from './semestre.js';

/**
 * Les facettes du panneau « Filtres » de l'avancement.
 * ← `#filter-panel` d'avancement.html : Niveau · Mode de Formation · Groupe ·
 *   Formateur · Semestre · Statut Régional
 *
 * ═══ ⚠️ ON FILTRE LES LIGNES, PAS LES SUJETS AGRÉGÉS ═══
 * Un module vu « par module » réunit tous ses groupes : filtrer après agrégation
 * ne pourrait que le garder ou le retirer en bloc, alors que la question posée
 * est « ce module, POUR LES GROUPES DE 1ʳᵉ ANNÉE ». Le filtre s'applique donc
 * aux lignes, et l'agrégation se refait ensuite — c'est ce qui permet à un même
 * module d'afficher un taux différent selon la promotion regardée.
 *
 * ⚠️ MÊME GRAMMAIRE QUE LES FILTRES DE LA PAGE ÉDITION : « OU » à l'intérieur
 * d'une facette, « ET » entre les facettes, et une facette VIDE ne filtre RIEN.
 * Deux grammaires différentes sur deux écrans du même produit seraient
 * indevinables.
 */

export const FACETTES = {
  annee: { libelle: 'Niveau', pluriel: 'niveaux' },
  mode: { libelle: 'Mode de formation', pluriel: 'modes' },
  groupe: { libelle: 'Groupe', pluriel: 'groupes' },
  formateur: { libelle: 'Formateur', pluriel: 'formateurs' },
  semestre: { libelle: 'Semestre', pluriel: 'semestres' },
  regional: { libelle: 'Statut régional', pluriel: 'statuts' },
};

export const FILTRES_VIDES = Object.freeze(
  Object.fromEntries(Object.keys(FACETTES).map((cle) => [cle, []]))
);

/** Les deux formateurs d'une ligne — le présentiel et le synchrone peuvent différer. */
const formateursDe = (ligne) =>
  [ligne.formateurPresentiel, ligne.formateurSynchrone].filter((nom) => nom !== '');

/**
 * Les valeurs réellement présentes, facette par facette.
 *
 * ⚠️ ON NE PROPOSE QUE CE QUI EXISTE. Offrir « 3ᵉ année » à un établissement qui
 * n'en a pas donne une case qui ne rend jamais rien, et fait douter du filtre
 * plutôt que des données. C'est déjà la règle du filtre de la page Édition.
 *
 * ⚠️ ELLES SE CALCULENT SUR TOUTES LES LIGNES, jamais sur la liste déjà
 * filtrée : sinon cocher « 1ʳᵉ année » ferait disparaître « 2ᵉ année » de la
 * liste, et on ne pourrait plus revenir en arrière.
 */
export function facettesAvancement(lignes = []) {
  const valeurs = {
    annee: new Set(),
    mode: new Set(),
    groupe: new Set(),
    formateur: new Set(),
    semestre: new Set(),
    regional: new Set(),
  };

  for (const ligne of lignes) {
    if (ligne.annee) valeurs.annee.add(String(ligne.annee));
    if (ligne.mode) valeurs.mode.add(ligne.mode);
    if (ligne.groupe) valeurs.groupe.add(ligne.groupe);
    if (ligne.semestre) valeurs.semestre.add(ligne.semestre);
    for (const nom of formateursDe(ligne)) valeurs.formateur.add(nom);
    valeurs.regional.add(ligne.estRegional ? 'oui' : 'non');
  }

  return {
    annee: [...valeurs.annee].sort((a, b) => Number(a) - Number(b)),
    mode: [...valeurs.mode].sort((a, b) => a.localeCompare(b, 'fr')),
    groupe: [...valeurs.groupe].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true })),
    formateur: [...valeurs.formateur].sort((a, b) => a.localeCompare(b, 'fr')),
    /*
     * ⚠️ LES SEMESTRES SUIVENT L'ORDRE DU CURSUS, pas l'alphabet : « A »
     * tomberait avant « S1 », ce qui ne veut rien dire.
     */
    semestre: SEMESTRES.filter((valeur) => valeurs.semestre.has(valeur)),
    regional: ['oui', 'non'].filter((valeur) => valeurs.regional.has(valeur)),
  };
}

/**
 * @param {Array} lignes
 * @param {{annee?:string[], mode?:string[], groupe?:string[], formateur?:string[],
 *          semestre?:string[], regional?:string[]}} filtres
 */
export function filtrerAvancement(lignes = [], filtres = {}) {
  const retenu = (cle, valeur) => {
    const choisies = filtres[cle];
    // Une facette vide veut dire « toutes », jamais « aucune ».
    if (!choisies || choisies.length === 0) return true;
    return choisies.includes(valeur);
  };

  return lignes.filter((ligne) => {
    if (!retenu('annee', String(ligne.annee ?? ''))) return false;
    if (!retenu('mode', ligne.mode ?? '')) return false;
    if (!retenu('groupe', ligne.groupe ?? '')) return false;
    if (!retenu('semestre', ligne.semestre ?? '')) return false;
    if (!retenu('regional', ligne.estRegional ? 'oui' : 'non')) return false;

    /*
     * ⚠️ LE FORMATEUR SE CHERCHE SUR LES DEUX RÔLES. Un module dont le
     * présentiel et le synchrone sont assurés par deux personnes appartient aux
     * DEUX : n'interroger que le présentiel ferait disparaître de sa propre
     * liste celui qui n'assure que les séances à distance.
     */
    const choisis = filtres.formateur;
    if (choisis && choisis.length > 0) {
      if (!formateursDe(ligne).some((nom) => choisis.includes(nom))) return false;
    }

    return true;
  });
}

/** Combien de valeurs sont retenues, toutes facettes confondues. */
export const nombreDeFiltres = (filtres = {}) =>
  Object.keys(FACETTES).reduce((somme, cle) => somme + (filtres[cle]?.length ?? 0), 0);
