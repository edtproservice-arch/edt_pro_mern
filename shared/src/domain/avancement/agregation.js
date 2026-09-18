/**
 * Le taux d'avancement, par formateur, par groupe ou par module.
 * ← `get_planned_progress.php` + `get_completion_status.php` + les trois vues
 *   « viewBy… » d'avancement.html
 *
 * ═══ ⚠️ TROIS AXES, ET LE SYNCHRONE NE SE COMPTE PAS PAREIL SUR CHACUN ═══
 * Une séance synchrone mutualisée est diffusée à plusieurs groupes en même
 * temps. Chaque GROUPE la reçoit — elle compte pour chacun. Le FORMATEUR ne la
 * donne QU'UNE FOIS — l'additionner par groupe multiplierait sa charge par le
 * nombre de groupes.
 *
 * C'est la règle déjà tenue par `bilanCharge` de la carte, par le bouton
 * « Charge » du chronogramme, par la feuille formateurs du classeur et par les
 * masses de la vue formateur — chaque fois qu'elle a manqué quelque part, elle a
 * produit un chiffre faux de moitié. Elle est ici dès la première ligne.
 */

import { semestreCumule } from './semestre.js';

/**
 * ═══ CE QU'UN AXE NE DIT PAS DE LUI-MÊME ═══ (demande du porteur, 2026-09-01.)
 *
 * Un bâton « M101 » ne dit pas QUI l'enseigne, et un bâton « ZINEB EL OMARI » ne
 * dit pas À QUI. C'est pourtant la question suivante, systématiquement — surtout
 * filtré sur un groupe, où « M101 » a exactement un formateur.
 *
 * ⚠️ L'AXE GROUPE N'EN A PAS. Son complément naturel serait la liste de ses
 * formateurs — dix-sept ici — ou celle de ses modules : dans les deux cas une
 * énumération que la ligne ne peut pas porter, et qui n'apprendrait rien. Mieux
 * vaut rien qu'un « +15 » systématique.
 *
 * ═══ ⚠️ UNE DIMENSION DÉJÀ FIGÉE PAR LE FILTRE N'APPREND PLUS RIEN ═══
 * (demande du porteur, 2026-09-02.) Filtré sur UN formateur, l'axe module
 * écrivait son nom sur les cinquante bâtons — la même information, cinquante
 * fois, à la place de celle qu'on cherche. La réponse utile est alors le
 * GROUPE. D'où une LISTE ordonnée par axe, et non une valeur : on descend
 * jusqu'à la première dimension que le filtre ne fixe pas déjà.
 */
const COMPLEMENTS = {
  module: ['formateurs', 'groupes'],
  formateur: ['groupes', 'modules'],
  groupe: [],
};

/** La facette du filtre qui FIGE une dimension. Aucune ne porte le module. */
const FACETTE = { formateurs: 'formateur', groupes: 'groupe', modules: null };

/**
 * Quelle dimension le bâton doit porter, compte tenu de ce que le filtre fixe
 * déjà — `null` s'il ne reste rien à dire.
 *
 * ⚠️ LES DEUX FIGÉES = AUCUN COMPLÉMENT : filtré sur un formateur ET un groupe,
 * un bâton de module n'a plus d'autre dimension à nommer. Y laisser l'une des
 * deux la répéterait sur toute la largeur.
 */
export function dimensionComplement(axe = 'module', filtres = {}) {
  const fige = (dimension) => {
    const facette = FACETTE[dimension];
    return facette ? (filtres[facette]?.length ?? 0) > 0 : false;
  };

  return (COMPLEMENTS[axe] ?? []).find((dimension) => !fige(dimension)) ?? null;
}

/** Ce qu'un axe porte quand aucun filtre ne le contraint. */
export const complementParDefaut = (axe = 'module') => COMPLEMENTS[axe]?.[0] ?? null;

export const AXES = {
  formateur: { libelle: 'Formateur', pluriel: 'formateurs' },
  groupe: { libelle: 'Groupe', pluriel: 'groupes' },
  module: { libelle: 'Module', pluriel: 'modules' },
};

/**
 * Agrège des lignes d'avancement sur un axe.
 *
 * @param {Array} lignes — telles que `lireAvancementEnote` les rend, ou
 *   construites depuis les séances (même forme : prévu/réalisé, P et S).
 * @param {'formateur'|'groupe'|'module'} axe
 * @returns {Array<{sujet, prevu, realise, prevuPresentiel, …, taux}>}
 */
export function agregerAvancement(lignes = [], axe = 'module', complement = complementParDefaut(axe)) {
  const totaux = new Map();

  const cumuler = (sujet, ligne) => {
    if (!sujet) return;

    /*
     * ═══ ⚠️ UN MODULE DONNÉ À DEUX GROUPES, CE SONT DEUX BÂTONS ═══
     * (demande du porteur, 2026-09-02 : « pour chaque groupe son bâtonné, ne
     * fusionne pas les groupes même s'ils ont le même module ».)
     *
     * C'est l'unité que `completionModules` retient déjà : un module N'EST PAS
     * achevé dans l'absolu, il l'est POUR UN GROUPE. Réunis, EGQ107 · SMP101 à
     * 100 % et EGQ107 · SMP102 à 0 % s'affichaient à 50 % — un taux que ni
     * l'une ni l'autre promotion ne connaît.
     */
    const ventilation = ventilationDe(axe, complement, ligne);
    const cle = ventilation ? `${sujet}${SEPARATEUR}${ventilation}` : sujet;

    if (!totaux.has(cle)) {
      totaux.set(cle, {
        cle,
        sujet,
        ventilation,
        prevuPresentiel: 0,
        prevuSynchrone: 0,
        realisePresentiel: 0,
        realiseSynchrone: 0,
        /*
         * ⚠️ LES SÉANCES SYNCHRONES DÉJÀ COMPTÉES POUR CE SUJET, par ensemble.
         * Le dédoublonnage vaut pour LES TROIS AXES : un groupe reçoit la
         * séance mutualisée UNE fois, pas une fois par ligne de l'ensemble —
         * une fusion de deux groupes produit deux lignes couvrant chacune les
         * deux groupes, donc quatre attributions pour une seule séance.
         */
        synchronesVus: new Set(),
        /*
         * ⚠️ LE SEMESTRE ET LE STATUT RÉGIONAL SUIVENT LE SUJET, pour que la vue
         * « par module » puisse les afficher en badges — comme la case de la
         * grille et la cellule du chronogramme. Reconstruits après coup depuis
         * le seul nom du module, ils seraient introuvables : ces deux
         * caractéristiques vivent sur la LIGNE, pas sur le code.
         */
        semestres: new Set(),
        estRegional: false,
        /*
         * L'autre dimension — les formateurs d'un module, les groupes d'un
         * formateur. Un `Set` : la même personne revient sur autant de lignes
         * qu'elle a de groupes.
         */
        complements: new Set(),
      });
    }
    const total = totaux.get(cle);

    if (ligne.semestre) total.semestres.add(ligne.semestre);
    if (ligne.estRegional) total.estRegional = true;

    for (const valeur of complementsDe(ligne, complement)) total.complements.add(valeur);

    total.prevuPresentiel += ligne.prevuPresentiel;
    total.realisePresentiel += ligne.realisePresentiel;

    if (ligne.prevuSynchrone === 0 && ligne.realiseSynchrone === 0) return;

    /*
     * ⚠️ L'EMPREINTE PORTE L'ENSEMBLE, PAS LE GROUPE : « GM101 GM102 » désigne
     * UNE séance. Deux lignes du même ensemble et du même module sont deux
     * écritures de la même heure de cours.
     * ⚠️ Une fusion VIDE ne veut pas dire « inconnu » mais « fusionné avec
     * personne » : on retombe alors sur le groupe, qui EST l'identité de cette
     * séance. Même règle que `empreinteSeance` du bilan de charge.
     */
    const empreinte = `${ligne.fusionGroupe || ligne.groupe}||${ligne.module}`;
    if (total.synchronesVus.has(empreinte)) return;
    total.synchronesVus.add(empreinte);

    total.prevuSynchrone += ligne.prevuSynchrone;
    total.realiseSynchrone += ligne.realiseSynchrone;
  };

  for (const ligne of lignes) {
    if (axe === 'module') {
      cumuler(ligne.module, ligne);
      continue;
    }

    if (axe === 'groupe') {
      /*
       * ═══ ⚠️ ON N'ÉCLATE PAS LA FUSION ICI ═══
       * Vérifié sur le fichier réel : l'export e-note porte UNE LIGNE PAR
       * GROUPE — « GM101 » et « GM102 » y figurent chacune, toutes deux avec
       * « GM101 GM102 » en colonne FusionGroupe. Éclater reviendrait à donner à
       * GM101 les heures présentielles de GM102, et à compter la séance
       * synchrone quatre fois pour deux groupes.
       *
       * ⚠️ CHAQUE GROUPE REÇOIT BIEN LA SÉANCE MUTUALISÉE — sa propre ligne la
       * porte. La SOMME des groupes dépasse donc le total réel de
       * l'établissement, et c'est pourquoi `totalAvancement` ne s'appuie jamais
       * sur cet axe.
       */
      cumuler(ligne.groupe, ligne);
      continue;
    }

    /*
     * ⚠️ DEUX FORMATEURS PAR LIGNE, ET PAS LES MÊMES HEURES. Le présentiel et
     * le synchrone d'un même module peuvent être assurés par deux personnes :
     * attribuer les deux au premier venu lui prêterait les heures de l'autre.
     * ← la même règle que `modulesDuGroupe` du classeur.
     */
    cumuler(ligne.formateurPresentiel, { ...ligne, prevuSynchrone: 0, realiseSynchrone: 0 });
    cumuler(ligne.formateurSynchrone, { ...ligne, prevuPresentiel: 0, realisePresentiel: 0 });
  }

  const comparer = (a, b) => a.localeCompare(b, 'fr', { numeric: true });

  return [...totaux.values()]
    .map(({ synchronesVus, ...total }) => finaliser(total))
    .sort(
      (a, b) =>
        comparer(a.sujet, b.sujet) || comparer(a.ventilation ?? '', b.ventilation ?? '')
    );
}

/** Ce qui sépare le sujet de sa ventilation dans `cle` — absent des deux. */
const SEPARATEUR = '||';

/**
 * La valeur qui ÉCLATE le sujet en plusieurs bâtons — `null` s'il reste entier.
 *
 * ═══ ⚠️ SUR L'AXE MODULE SEULEMENT, ET SEULEMENT PAR GROUPE ═══
 * Un module est délivré UNE FOIS PAR PROMOTION : deux cohortes, deux
 * enseignements, deux avancements. Une PERSONNE, en revanche, est une seule
 * personne — éclater un formateur par groupe étalerait sa charge sur plusieurs
 * bâtons dont aucun ne dirait ce qu'il assure réellement.
 *
 * ⚠️ ET C'EST BORNÉ PAR LE FILTRE : la dimension « groupes » n'arrive sur l'axe
 * module que si un formateur est déjà retenu, donc sur la quinzaine de lignes de
 * cette personne. Sans ce filtre, éclater les 54 modules par groupe rendrait les
 * 238 lignes du fichier — c'est-à-dire exactement ce qu'un axe agrégé existe
 * pour éviter.
 */
function ventilationDe(axe, complement, ligne) {
  if (axe !== 'module' || complement !== 'groupes') return null;
  return typeof ligne.groupe === 'string' && ligne.groupe.trim() !== '' ? ligne.groupe : null;
}

/**
 * Les valeurs de l'AUTRE dimension portées par une ligne.
 *
 * ⚠️ LES DEUX RÔLES DU FORMATEUR, pas seulement le présentiel : un module dont
 * les séances à distance sont assurées par quelqu'un d'autre a bien DEUX
 * enseignants, et n'en nommer qu'un ferait disparaître le second de sa propre
 * ligne. Même règle que le filtre par formateur.
 */
function complementsDe(ligne, dimension) {
  if (dimension === 'formateurs') {
    return [ligne.formateurPresentiel, ligne.formateurSynchrone].filter(
      (nom) => typeof nom === 'string' && nom.trim() !== ''
    );
  }

  const champ = { groupes: 'groupe', modules: 'module' }[dimension];
  if (!champ) return [];

  const valeur = ligne[champ];
  return typeof valeur === 'string' && valeur.trim() !== '' ? [valeur] : [];
}

/** Prévu, réalisé et taux — arrondis au centième, jamais à l'unité. */
function finaliser(total) {
  const prevu = arrondir(total.prevuPresentiel + total.prevuSynchrone);
  const realise = arrondir(total.realisePresentiel + total.realiseSynchrone);

  return {
    /*
     * ⚠️ `cle` EST L'IDENTITÉ, `sujet` EST CE QU'ON AFFICHE : ventilé, le même
     * module revient sur plusieurs bâtons, et l'axe des catégories de recharts
     * les fusionnerait s'ils partageaient leur valeur. La clé de rendu React et
     * la `dataKey` de l'axe passent donc par elle.
     */
    cle: total.cle,
    sujet: total.sujet,
    ventilation: total.ventilation ?? null,
    /* Triés : deux affichages du même bâton doivent nommer les mêmes personnes
       dans le même ordre. */
    complements: [...total.complements].sort((a, b) => a.localeCompare(b, 'fr')),
    /*
     * ⚠️ « A » DÈS QUE DEUX SEMESTRES SE CÔTOIENT : un module donné en S1 à une
     * promotion et en S2 à une autre s'étale bien sur l'année. Retenir le
     * premier rencontré ferait mentir le badge sur la moitié de ses groupes.
     */
    semestre: semestreCumule([...(total.semestres ?? [])]),
    estRegional: Boolean(total.estRegional),
    prevuPresentiel: arrondir(total.prevuPresentiel),
    prevuSynchrone: arrondir(total.prevuSynchrone),
    realisePresentiel: arrondir(total.realisePresentiel),
    realiseSynchrone: arrondir(total.realiseSynchrone),
    prevu,
    realise,
    taux: taux(realise, prevu),
  };
}

/**
 * Le total de tous les sujets d'un axe — le taux global de l'écran.
 *
 * ⚠️ IL SE CALCULE SUR L'AXE MODULE, jamais en additionnant une autre vue : par
 * groupe, une séance mutualisée est comptée pour chacun, et le total dépasserait
 * ce que l'établissement doit réellement.
 */
export function totalAvancement(lignes = []) {
  const parModule = agregerAvancement(lignes, 'module');

  const prevu = arrondir(parModule.reduce((somme, m) => somme + m.prevu, 0));
  const realise = arrondir(parModule.reduce((somme, m) => somme + m.realise, 0));

  return {
    prevu,
    realise,
    prevuPresentiel: arrondir(parModule.reduce((s, m) => s + m.prevuPresentiel, 0)),
    prevuSynchrone: arrondir(parModule.reduce((s, m) => s + m.prevuSynchrone, 0)),
    realisePresentiel: arrondir(parModule.reduce((s, m) => s + m.realisePresentiel, 0)),
    realiseSynchrone: arrondir(parModule.reduce((s, m) => s + m.realiseSynchrone, 0)),
    taux: taux(realise, prevu),
    modules: parModule.length,
  };
}

/**
 * ⚠️ `null` ET NON `0` QUAND RIEN N'EST PRÉVU. « 0 % » se lit comme un retard ;
 * un module sans masse déclarée n'a pas de taux du tout, et c'est la carte
 * d'affectations qu'il faut aller corriger, pas la grille. C'est déjà la règle
 * d'`avancementModule` pour la case de l'emploi du temps.
 */
export function taux(realise, prevu) {
  if (!(prevu > 0)) return null;
  return Math.round((realise / prevu) * 1000) / 10;
}

const arrondir = (valeur) => Math.round(valeur * 100) / 100;
