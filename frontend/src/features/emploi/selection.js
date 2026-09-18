import { JOURS } from 'shared/constants';

/**
 * Sélection rectangulaire, presse-papiers et historique de la grille.
 * ← `setupSelectionModeToggle()`, `setupActionToolbar()`, `undo()` / `redo()`
 *   de emploi.html
 *
 * ═══ POURQUOI CES FONCTIONS SONT SORTIES DU COMPOSANT ═══
 * Elles décident de CE QUI SERA ÉCRIT EN BASE — quelles cases sont visées, ce
 * qu'on y colle, ce qu'un « défaire » restaure. Laissées dans le rendu, elles
 * n'étaient vérifiables qu'à l'œil, et c'est exactement ce qui a coûté une perte
 * de données sur le chronogramme.
 */

/** Une case se désigne par son sujet et son créneau. */
export const cleCase = (sujet, jour, creneau, periode = 'jour') =>
  `${sujet}||${jour}||${creneau}||${periode}`;

export const lireCle = (cle) => {
  const [sujet, jour, creneau, periode] = String(cle).split('||');
  return { sujet, jour, creneau, periode };
};

/**
 * Les cases du RECTANGLE entre deux coins.
 * ← la sélection type tableur de l'existant.
 *
 * ⚠️ UN RECTANGLE, PAS UN INTERVALLE DE CASES. Les colonnes sont ordonnées
 * (jour, puis créneau) et les lignes le sont aussi : sélectionner du mardi S1 au
 * mercredi S3 doit prendre 2 lignes × 6 colonnes, pas la suite des cases entre
 * les deux. C'est ce qu'on attend d'une grille, et c'est ce que fait un tableur.
 */
export function rectangle(depuis, jusqu, { sujets, creneaux, periode = 'jour' }) {
  if (!depuis || !jusqu) return [];

  const colonnes = JOURS.flatMap((jour) => creneaux.map((creneau) => ({ jour, creneau })));
  const indexColonne = ({ jour, creneau }) =>
    colonnes.findIndex((c) => c.jour === jour && c.creneau === creneau);

  const l1 = sujets.indexOf(depuis.sujet);
  const l2 = sujets.indexOf(jusqu.sujet);
  const c1 = indexColonne(depuis);
  const c2 = indexColonne(jusqu);

  // Un coin hors grille — sujet retiré depuis, créneau inconnu — ne doit rien
  // sélectionner plutôt que de partir de l'index -1 et tout prendre.
  if (l1 === -1 || l2 === -1 || c1 === -1 || c2 === -1) return [];

  const cles = [];
  for (let ligne = Math.min(l1, l2); ligne <= Math.max(l1, l2); ligne += 1) {
    for (let colonne = Math.min(c1, c2); colonne <= Math.max(c1, c2); colonne += 1) {
      cles.push(cleCase(sujets[ligne], colonnes[colonne].jour, colonnes[colonne].creneau, periode));
    }
  }

  return cles;
}

/**
 * Ce que le presse-papiers retient d'une sélection.
 *
 * ⚠️ ON COPIE LE CONTENU, PAS LES CASES. Le collage se fait ailleurs — autre
 * jour, autre formateur — et garder l'origine ferait recoller au même endroit.
 * On retient donc la FORME du bloc : la position relative de chaque séance dans
 * le rectangle, comme un tableur.
 */
export function copier(cles, seanceDe) {
  if (cles.length === 0) return null;

  const cases = cles.map(lireCle);
  const lignes = [...new Set(cases.map((c) => c.sujet))];
  const colonnes = [...new Set(cases.map((c) => `${c.jour}||${c.creneau}`))];

  return {
    lignes: lignes.length,
    colonnes: colonnes.length,
    contenu: cases.map((c, rang) => ({
      ligne: lignes.indexOf(c.sujet),
      colonne: colonnes.indexOf(`${c.jour}||${c.creneau}`),
      seance: seanceDe(cles[rang]) ?? null,
    })),
  };
}

/**
 * Où le presse-papiers atterrit, à partir d'une case d'ancrage.
 *
 * @returns {Array<{cle, seance}>} une entrée par case visée ; `seance` à `null`
 *   signifie « vider », car une case vide copiée reste une case vide collée.
 */
export function cible(presse, ancre, { sujets, creneaux, periode = 'jour' }) {
  if (!presse || !ancre) return [];

  const colonnes = JOURS.flatMap((jour) => creneaux.map((creneau) => ({ jour, creneau })));
  const ligne0 = sujets.indexOf(ancre.sujet);
  const colonne0 = colonnes.findIndex(
    (c) => c.jour === ancre.jour && c.creneau === ancre.creneau
  );

  if (ligne0 === -1 || colonne0 === -1) return [];

  return presse.contenu
    .map(({ ligne, colonne, seance }) => {
      const sujet = sujets[ligne0 + ligne];
      const destination = colonnes[colonne0 + colonne];

      /*
       * ⚠️ CE QUI DÉBORDE EST ÉCARTÉ, jamais replié. Coller un bloc de trois
       * jours à partir du vendredi ne doit pas revenir au lundi : on perdrait le
       * contenu de la semaine sans le voir.
       */
      if (!sujet || !destination) return null;

      return { cle: cleCase(sujet, destination.jour, destination.creneau, periode), seance };
    })
    .filter(Boolean);
}

/**
 * Ce qu'un glisser-déposer écrit.
 * ← `handleDrop()` de emploi.html
 *
 * ⚠️ UNE SEULE OPÉRATION, PAS DEUX. Poser à l'arrivée puis vider le départ en
 * deux écritures indépendantes PERD la séance quand la première est refusée —
 * conflit de salle, de groupe — puisque la seconde partirait quand même. Le
 * déplacement est donc UN ordre, que le service n'exécute jusqu'au bout que si
 * la pose a réussi.
 *
 * @param {string} depuis clé de la case d'origine
 * @param {string} vers clé de la case d'arrivée
 * @param {object|undefined} seance ce qui est posé à l'origine
 * @param {{copie?: boolean, sujetDe?: (cle: string) => object}} options
 *   `copie` — avec Ctrl, l'origine est conservée.
 *   `sujetDe` — ce que le sujet de la case d'arrivée impose (le formateur en vue
 *   par formateur, le groupe en vue par groupe). Sans lui, déposer sur une autre
 *   ligne garderait le formateur de départ et la séance n'irait nulle part.
 */
export function deplacement(depuis, vers, seance, { copie = false, sujetDe } = {}) {
  if (!seance || !depuis || !vers || depuis === vers) return [];

  const arrivee = lireCle(vers);
  const origine = lireCle(depuis);

  return [
    {
      type: copie ? 'poser' : 'deplacer',
      cle: vers,
      seance: {
        jour: arrivee.jour,
        seance: arrivee.creneau,
        periode: arrivee.periode,
        formateurMatricule: seance.formateurMatricule,
        groupe: seance.groupe,
        module: seance.module,
        salle: seance.salle ?? '',
        statut: seance.statut ?? 'planifie',
        ...(sujetDe?.(vers) ?? {}),
      },
      source: copie
        ? undefined
        : {
            jour: origine.jour,
            seance: origine.creneau,
            periode: origine.periode,
            formateurMatricule: seance.formateurMatricule,
          },
    },
  ];
}

/**
 * L'historique des états de la grille.
 *
 * ⚠️ ON EMPILE L'ÉTAT D'AVANT, pas celui qu'on s'apprête à écrire. « Défaire »
 * doit ramener à ce qui était là — empiler la valeur courante rendrait
 * l'annulation sans effet. C'est la même règle que `CadreReglage`.
 */
export function empiler(historique, etat, maximum = 50) {
  const passe = [...historique.passe, etat].slice(-maximum);
  // Un nouveau geste efface la branche « refaire » : on ne peut pas refaire ce
  // qu'on vient de remplacer.
  return { passe, futur: [] };
}

/*
 * ═══ ⚠️ LA PORTÉE D'UN GESTE VOYAGE AVEC LUI ═══
 * (2026-09-12, collaboration temps réel.) Une entrée peut être `{ etat, cles }` :
 * `cles` nomme les cases que le geste a touchées. « Défaire » ne doit rétablir
 * QUE celles-là. Sans cette borne, l'état d'avant — la semaine ENTIÈRE —
 * écraserait aussi les cases qu'un collègue a modifiées entre-temps : un Ctrl+Z
 * effacerait silencieusement le travail de quelqu'un d'autre. Dans Notion aussi,
 * on ne défait que ses propres gestes.
 *
 * L'état courant qu'on range de l'autre côté reçoit la MÊME portée, pour que
 * « refaire » vise exactement les cases que « défaire » vient de rétablir.
 * Une entrée sans portée (une valeur nue) garde l'ancien comportement.
 */
function avecPortee(etat, modele) {
  return modele !== null && typeof modele === 'object' && 'cles' in modele
    ? { etat, cles: modele.cles }
    : etat;
}

export function defaire(historique, courant) {
  if (historique.passe.length === 0) return null;

  const passe = [...historique.passe];
  const precedent = passe.pop();

  return {
    etat: precedent,
    historique: { passe, futur: [avecPortee(courant, precedent), ...historique.futur] },
  };
}

export function refaire(historique, courant) {
  if (historique.futur.length === 0) return null;

  const [suivant, ...futur] = historique.futur;

  return {
    etat: suivant,
    historique: { passe: [...historique.passe, avecPortee(courant, suivant)], futur },
  };
}

export const HISTORIQUE_VIDE = { passe: [], futur: [] };
