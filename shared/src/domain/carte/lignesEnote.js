import { cleGroupeLigne } from '../enote/parseBase.js';
import { nomGroupeBrut } from './nomsGroupes.js';

/**
 * Conversion d'une carte d'établissement en lignes au format e-note.
 * ← public/assets/js/affectation-carte.js:3590-3678 (buildAvancementRows)
 *
 * ═══ POURQUOI PASSER PAR DES LIGNES E-NOTE ═══
 * La carte construite à la main et le fichier e-note importé produisent
 * EXACTEMENT la même base, parce qu'ils empruntent le même parseur
 * (`construireBase`). C'est le choix de `save_affectations.php`, et il est
 * conservé : sans lui, deux chemins produiraient deux structures voisines mais
 * divergentes — le défaut que toute cette migration cherche à supprimer.
 *
 * Les colonnes suivies d'une étoile ne sont pas connues du client :
 *   9  (J) « Effectif Groupe » — nombre de stagiaires inscrits
 *   13 (N) « Code Fusion »     — identifiant partagé par une fusion
 * Elles restent à 0 ici, le service serveur les complète.
 */

/** Nombre de colonnes d'une ligne e-note. */
export const NB_COLONNES = 51;

function nombre(valeur) {
  const converti = Number.parseFloat(valeur);
  return Number.isFinite(converti) ? converti : 0;
}

/** « JJ/MM/AAAA HH:MM:SS », format de la colonne « Date MAJ ». */
function horodatage(maintenant) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${p(maintenant.getDate())}/${p(maintenant.getMonth() + 1)}/${maintenant.getFullYear()} ` +
    `${p(maintenant.getHours())}:${p(maintenant.getMinutes())}:${p(maintenant.getSeconds())}`
  );
}

/**
 * @param {object} carte
 * @param {Array} carte.groupes  { nom, codeFiliere, intituleFiliere, anneeFormation,
 *                                 niveau, secteur, typeFormation, creneau, mode,
 *                                 modules: [{ code, nom, mhpS1, mhpS2, mhsynS1, mhsynS2,
 *                                             mhasynS1, mhasynS2, estRegional,
 *                                             formateurPresentiel, formateurSynchrone,
 *                                             groupeFusion }] }
 * @param {Array} carte.formateurs  { nom, matricule } — pour retrouver les matricules
 * @param {number} anneeScolaire  année de septembre
 * @returns {Array<Array>} lignes de 51 colonnes
 */
export function carteVersLignesEnote(carte, anneeScolaire, { maintenant = new Date() } = {}) {
  const groupes = carte?.groupes;
  if (!Array.isArray(groupes)) {
    throw new TypeError('carteVersLignesEnote attend une carte avec un tableau `groupes`');
  }

  const dateMaj = horodatage(maintenant);

  // Le matricule est cherché sur le nom EXACT, en majuscules — même règle que
  // `matriculeOf()`. Un formateur absent de la liste donne un matricule vide,
  // et l'import retombera alors sur son nom comme identifiant.
  const matricules = new Map(
    (carte?.formateurs ?? []).map((formateur) => [
      String(formateur?.nom ?? '')
        .trim()
        .toUpperCase(),
      String(formateur?.matricule ?? '').trim(),
    ])
  );

  const matriculeDe = (nom) =>
    matricules.get(
      String(nom ?? '')
        .trim()
        .toUpperCase()
    ) ?? '';

  const lignes = [];

  // Tri naturel sur le nom : DEV102 après DEV2, pas avant. Même comparateur
  // que la carte d'origine.
  const ordonnes = [...groupes].sort((a, b) =>
    String(a?.nom ?? '').localeCompare(String(b?.nom ?? ''), 'fr', { numeric: true })
  );

  for (const groupe of ordonnes) {
    const brut = nomGroupeBrut(groupe.nom, groupe.codeFiliere);

    for (const module of groupe.modules ?? []) {
      // Un module désactivé par l'établissement n'est pas dispensé : lui laisser
      // une ligne le ferait réapparaître dans l'avancement et dans l'emploi du
      // temps. `actif` absent vaut ACTIF — les modules DRIF n'ont pas ce champ.
      //
      // ⚠️ Le module SORT du fichier, mais son état est conservé à part par
      // `modulesInactifs()` : sans cela, la répartition DRIF le ferait revenir
      // actif au prochain rechargement de la carte.
      if (module.actif === false) continue;

      const mhpS1 = nombre(module.mhpS1);
      const mhpS2 = nombre(module.mhpS2);
      const synS1 = nombre(module.mhsynS1);
      const synS2 = nombre(module.mhsynS2);
      const asynS1 = nombre(module.mhasynS1);
      const asynS2 = nombre(module.mhasynS2);

      const totalS1 = mhpS1 + synS1 + asynS1;
      const totalS2 = mhpS2 + synS2 + asynS2;
      const mhpTotal = mhpS1 + mhpS2;
      const synTotal = synS1 + synS2;

      const presentiel = module.formateurPresentiel ?? '';
      const synchrone = module.formateurSynchrone ?? '';

      const ligne = new Array(NB_COLONNES).fill('');

      ligne[0] = dateMaj;
      ligne[1] = String(anneeScolaire);
      ligne[2] = groupe.niveau ?? '';
      ligne[3] = groupe.secteur ?? '';
      ligne[4] = groupe.codeFiliere ?? '';
      ligne[5] = groupe.intituleFiliere ?? '';
      ligne[6] = groupe.typeFormation ?? '';
      ligne[7] = groupe.creneau ?? '';
      ligne[8] = brut;
      ligne[9] = 0; // ★ effectif, complété par le serveur
      ligne[10] = brut;
      ligne[11] = 'Actif';
      ligne[12] = module.groupeFusion ?? '';
      ligne[13] = 0; // ★ code de fusion, complété par le serveur
      ligne[14] = String(groupe.anneeFormation ?? '');
      ligne[15] = groupe.mode ?? 'Résidentiel';
      ligne[16] = module.code ?? '';
      ligne[17] = module.nom ?? '';
      ligne[18] = module.estRegional ? 'O' : 'N';
      ligne[19] = matriculeDe(presentiel);
      ligne[20] = presentiel;
      ligne[21] = matriculeDe(synchrone);
      ligne[22] = synchrone;

      ligne[23] = mhpS1;
      ligne[24] = synS1;
      ligne[25] = asynS1;
      ligne[26] = totalS1;
      ligne[27] = mhpS2;
      ligne[28] = synS2;
      ligne[29] = asynS2;
      ligne[30] = totalS2;

      ligne[31] = mhpTotal;
      ligne[32] = synTotal;
      ligne[33] = asynS1 + asynS2;
      ligne[34] = totalS1 + totalS2;

      // Masse AFFECTÉE : nulle tant qu'aucun formateur ne porte le module.
      ligne[35] = presentiel ? mhpTotal : 0;
      ligne[36] = synchrone ? synTotal : 0;
      ligne[37] = ligne[35] + ligne[36];

      // Réalisé : une carte neuve n'a rien réalisé.
      ligne[41] = 0;
      ligne[42] = 0;
      ligne[43] = 0;
      ligne[45] = 0;
      ligne[46] = 'Non';
      ligne[47] = 'non';

      lignes.push(ligne);
    }
  }

  return lignes;
}

/**
 * Noms des groupes de la carte, tels que `construireBase` doit les RENDRE.
 *
 * ═══ ⚠️⚠️ SANS CETTE TABLE, L'ENREGISTREMENT RENOMMAIT LA CARTE ═══
 * (corrigé le 2026-09-11, signalé par le porteur.) Les lignes portent le nom
 * BRUT (`nomGroupeBrut`), et le parseur de l'import retire tout suffixe puis
 * n'en remet qu'aux noms EN COLLISION — règle PHP de l'import e-note. Or la
 * carte, elle, désambiguïse une FILIÈRE entière : avec GE_GE_TS à deux groupes
 * et GC_GE_TS à quatre, « GE101 (GC) » et « GE102 (GC) » survivaient,
 * « GE103 (GC) » et « GE104 (GC) » redevenaient « GE103 » et « GE104 ». Et
 * comme le service réunit ensuite la liste de la carte à celle du parseur, les
 * anciens noms revenaient à côté des nouveaux : deux groupes FANTÔMES, vides,
 * dans l'ensemble de la filière, et les modules désactivés rangés sous un nom
 * qui n'était plus celui du groupe.
 *
 * La carte a déjà décidé de ses noms à l'écran — suffixe de filière accepté ou
 * refusé par le directeur : c'est donc elle qui fait foi. La clé est calculée
 * avec `nomGroupeBrut`, exactement comme la colonne écrite plus haut.
 *
 * ⚠️ Deux groupes de la même filière qui donnent le même nom brut — « GE101 »
 * et « GE101 (GC) » — ne peuvent pas se distinguer dans une ligne : le premier
 * rencontré garde la clé. Cet état n'est produit que par le défaut ci-dessus.
 *
 * @returns {Map<string, string>} `cleGroupeLigne(code, brut)` → nom de la carte
 */
export function nomsGroupesDeLaCarte(carte) {
  const noms = new Map();

  for (const groupe of carte?.groupes ?? []) {
    const nom = String(groupe?.nom ?? '').trim();
    if (nom === '') continue;

    const cle = cleGroupeLigne(groupe.codeFiliere, nomGroupeBrut(nom, groupe.codeFiliere));
    if (!noms.has(cle)) noms.set(cle, nom);
  }

  return noms;
}

/**
 * Modules DÉSACTIVÉS, par groupe.
 *
 * ═══ POURQUOI CETTE FONCTION EXISTE ═══
 * Un module inactif ne produit aucune ligne e-note — c'est ce qui le retire du
 * bilan, de la charge et du chronogramme. Mais la carte se RECONSTRUIT en
 * croisant la base avec la répartition DRIF, et le référentiel connaît toujours
 * le module : il revenait donc ACTIF au rechargement, et le commutateur
 * paraissait sans effet.
 *
 * L'état est donc extrait ici pour être rangé à côté des lignes, dans
 * `Base.modulesInactifs`. C'est la contrepartie exacte de l'omission ci-dessus.
 *
 * @returns {Object<string, string[]>} nom de groupe → codes désactivés
 */
export function modulesInactifs(carte) {
  const parGroupe = {};

  for (const groupe of carte?.groupes ?? []) {
    const codes = (groupe.modules ?? [])
      .filter((module) => module.actif === false)
      .map((module) => String(module.code ?? module.nom ?? '').trim())
      .filter(Boolean);

    // On n'écrit que les groupes CONCERNÉS : une entrée vide par groupe
    // gonflerait le document sans rien dire de plus.
    if (codes.length > 0) parGroupe[groupe.nom] = codes.sort();
  }

  return parGroupe;
}
