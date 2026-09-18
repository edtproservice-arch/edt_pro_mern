import { TYPES_COURS } from '../../constants/index.js';
import { prefixeDuNom } from './nomsGroupes.js';

/**
 * Reconstruction de la carte à partir de la base enregistrée.
 * ← rebuildGroupsFromExistingAffectations() + completerModulesNonAffectes()
 *   dans public/assets/js/affectation-carte.js:3284-3420
 *
 * ═══ POURQUOI LA BASE NE SUFFIT PAS ═══
 * `Base.affectations` ne contient QUE les lignes pourvues d'un formateur : un
 * module jamais affecté n'y laisse aucune trace, et le nom du module comme sa
 * masse horaire n'y figurent pas non plus (seul son CODE est stocké). Rendre la
 * carte à partir de la seule base afficherait donc un établissement
 * intégralement affecté, dont les modules restants auraient disparu — l'inverse
 * de ce qu'on vient y chercher.
 *
 * La reconstruction croise donc deux sources, comme l'existant :
 *   - la BASE, qui dit qui est affecté à quoi, et sur quels groupes ;
 *   - la RÉPARTITION DRIF, qui rend les intitulés, les masses horaires, les
 *     métiers et les modules ENCORE SANS FORMATEUR.
 */

/** Année de formation lue dans le numéro du groupe : « DEVOWFS201 » → 2. */
export function anneeDuNomGroupe(nom) {
  const chiffres = /(\d{3,4})\s*$/.exec(String(nom ?? '').trim());
  if (!chiffres) return 1;

  const annee = Number.parseInt(chiffres[1].charAt(0), 10);
  return Number.isInteger(annee) && annee > 0 ? annee : 1;
}

/**
 * Un libellé fusionné réunit plusieurs groupes : « GM101 GM102 ».
 *
 * ⚠ Une espace ne suffit pas à reconnaître une fusion : un nom de groupe en
 * contient dès qu'il porte un suffixe — « ACADA101 (FQ) », et jusqu'à deux
 * quand il faut désambiguïser (« GE101 (CDS) (GE) », cf. suffixeGroupe()).
 *
 * Découper sur les espaces fabriquait les groupes fantômes « ACADA101 » et
 * « (FQ) » : la filière était enregistrée sous ces deux clés inexistantes, le
 * vrai groupe n'en recevait aucune, et il ressortait « sans filière » — donc
 * affiché vide, sans ses modules.
 */
export const separerFusion = (nom) => {
  const groupes = [];

  for (const morceau of String(nom ?? '').trim().split(/\s+/).filter(Boolean)) {
    // Un morceau entièrement parenthésé est un suffixe : il appartient au nom
    // qui le précède, quel qu'il soit — (FQ), (CDS) ou un code secteur.
    if (/^\([^()]*\)$/.test(morceau) && groupes.length > 0) {
      groupes[groupes.length - 1] += ` ${morceau}`;
      continue;
    }
    groupes.push(morceau);
  }

  return groupes;
};

const estFusion = (nom) => separerFusion(nom).length > 1;

const cleModule = (code, nom) => `${String(code ?? '').trim()}||${String(nom ?? '').trim()}`;

/**
 * Code filière de chaque groupe.
 *
 * Il vient des AFFECTATIONS — c'est la seule source qui le porte. Un groupe qui
 * n'a encore aucune affectation n'en a donc pas… sauf s'il partage son PRÉFIXE
 * et son année avec un groupe qui, lui, en a un : « DEVOWFS202 » se rattache
 * alors à la filière de « DEVOWFS201 ». Sans ce rattrapage, le second groupe
 * d'une promotion revenait vide tant qu'on ne l'avait pas affecté.
 *
 * @returns {Map<string, string>} nom de groupe → code filière
 */
export function filieresParGroupe(base) {
  const filieres = new Map();

  /*
   * ⚠️ LA TABLE PERSISTÉE D'ABORD. La filière se déduisait des seules
   * affectations : un groupe qui n'en a aucune — modules tous désactivés, ou pas
   * encore affectés — perdait son identité, et l'écran ne pouvait plus aller
   * chercher ses modules dans la répartition. Le groupe existait en base et
   * disparaissait de l'affichage.
   */
  for (const [groupe, filiere] of Object.entries(lireTable(base?.groupeFilieres))) {
    const code = String(filiere ?? '').trim();
    if (code !== '') filieres.set(groupe, code);
  }

  for (const affectation of base?.affectations ?? []) {
    const filiere = String(affectation.filiere ?? '').trim();
    if (filiere === '') continue;

    // Une affectation synchrone porte parfois un libellé fusionné : chacun de
    // ses groupes hérite du même code filière.
    for (const groupe of separerFusion(affectation.groupe)) {
      if (!filieres.has(groupe)) filieres.set(groupe, filiere);
    }
  }

  // Rattrapage par préfixe + année, pour les groupes encore sans affectation.
  const parPrefixe = new Map();
  for (const [groupe, filiere] of filieres) {
    parPrefixe.set(`${prefixeDuNom(groupe)}||${anneeDuNomGroupe(groupe)}`, filiere);
  }

  for (const groupe of base?.groupes ?? []) {
    if (filieres.has(groupe)) continue;

    const voisine = parPrefixe.get(`${prefixeDuNom(groupe)}||${anneeDuNomGroupe(groupe)}`);
    if (voisine) filieres.set(groupe, voisine);
  }

  return filieres;
}

/**
 * Ensembles (filière, année) qu'il faut aller chercher dans la répartition.
 *
 * Un groupe dont la filière reste introuvable est rendu à part : l'appelant
 * saura qu'il ne pourra pas le compléter, plutôt que de le voir revenir vide
 * sans explication.
 *
 * @returns {{ensembles: Array<{codeFiliere, anneeFormation}>, groupesSansFiliere: string[]}}
 */
export function ensemblesAReconstruire(base) {
  const filiereParGroupe = filieresParGroupe(base);
  const ensembles = new Map();
  const groupesSansFiliere = [];

  for (const groupe of base?.groupes ?? []) {
    const codeFiliere = filiereParGroupe.get(groupe);

    if (!codeFiliere) {
      groupesSansFiliere.push(groupe);
      continue;
    }

    const anneeFormation = anneeDuNomGroupe(groupe);
    ensembles.set(`${codeFiliere}||${anneeFormation}`, { codeFiliere, anneeFormation });
  }

  return { ensembles: [...ensembles.values()], groupesSansFiliere };
}

/**
 * Groupes de la carte, à la forme attendue par l'écran d'affectation.
 *
 * @param {object} base                    document `Base` tel que rendu par l'API
 * @param {Map<string, object>} referentiel `"CODE||ANNEE"` → `{filiere, modules}`
 * @returns {Array} groupes
 */
/**
 * `Map` de Mongoose ou objet simple : les deux formes arrivent ici.
 *
 * Le serveur manipule un document hydraté — donc une `Map` — quand le
 * navigateur reçoit du JSON, donc un objet. Une seule des deux lectures aurait
 * marché à un endroit et rendu vide à l'autre, sans erreur.
 */
function lireTable(valeur) {
  if (!valeur) return {};
  return typeof valeur.entries === 'function' && !Array.isArray(valeur)
    ? Object.fromEntries(valeur.entries())
    : valeur;
}

export function reconstruireGroupes(base, referentiel = new Map()) {
  const filiereParGroupe = filieresParGroupe(base);
  const parGroupe = new Map();
  const nomDuFormateur = tableDesNoms(base);

  /*
   * ⚠️ LES MODULES DÉSACTIVÉS SE RELISENT À PART. Ils ne produisent aucune ligne
   * e-note — c'est ce qui les retire du bilan — mais la répartition DRIF, elle,
   * les connaît toujours : sans cette table, ils revenaient tous ACTIFS et le
   * commutateur paraissait sans effet.
   */
  const inactifs = new Map(
    Object.entries(lireTable(base?.modulesInactifs)).map(([groupe, codes]) => [
      groupe,
      new Set((codes ?? []).map((code) => String(code).trim().toUpperCase())),
    ])
  );

  // ─── 2. Un groupe par nom, garni des modules officiels de son ensemble ────
  for (const nom of base?.groupes ?? []) {
    const codeFiliere = filiereParGroupe.get(nom) ?? '';
    const anneeFormation = anneeDuNomGroupe(nom);
    const ensemble = referentiel.get(`${codeFiliere}||${anneeFormation}`);

    parGroupe.set(nom, {
      nom,
      codeFiliere,
      intituleFiliere: ensemble?.filiere?.intitule ?? codeFiliere,
      anneeFormation,
      niveau: ensemble?.filiere?.niveau ?? '',
      secteur: ensemble?.filiere?.secteur ?? '',
      typeFormation: ensemble?.filiere?.typeFormation ?? '',
      creneau: ensemble?.filiere?.creneau ?? '',
      mode: base?.groupeModes?.[nom] ?? 'Résidentiel',
      /*
       * Les modules viennent de la RÉPARTITION, pas des affectations : c'est
       * ainsi que ceux qui n'ont pas encore de formateur restent visibles.
       * ← completerModulesNonAffectes()
       */
      modules: (ensemble?.modules ?? []).map((module) => ({
        ...module,
        formateurPresentiel: '',
        formateurSynchrone: '',
        groupeFusion: '',
        // `actif` n'est posé QUE s'il vaut faux : absent, il vaut actif partout
        // ailleurs, et l'écrire à `true` ferait diverger les deux formes.
        ...(inactifs.get(nom)?.has(String(module.code ?? module.nom).trim().toUpperCase())
          ? { actif: false }
          : {}),
        reference: { mhpS1: module.mhpS1, mhpS2: module.mhpS2 },
      })),
    });
  }

  // ─── 3. Reposer les affectations enregistrées sur ces modules ─────────────
  for (const affectation of base?.affectations ?? []) {
    const synchrone = affectation.type === TYPES_COURS.SYNCHRONE;
    const groupes = separerFusion(affectation.groupe);
    const fusion = estFusion(affectation.groupe) ? String(affectation.groupe).trim() : '';

    for (const nomGroupe of groupes) {
      const groupe = parGroupe.get(nomGroupe);
      if (!groupe) continue;

      const module = groupe.modules.find(
        (candidat) =>
          cleModule(candidat.code, candidat.nom) === cleModule(affectation.module, affectation.module) ||
          String(candidat.code).trim() === String(affectation.module).trim()
      );

      // Module affecté mais absent de la répartition : il a été retiré du
      // référentiel depuis. On le rétablit plutôt que de perdre l'affectation.
      const cible = module ?? rattacherModuleInconnu(groupe, affectation);

      const nom = nomDuFormateur(affectation.formateur);

      if (synchrone) {
        cible.formateurSynchrone = nom;
        cible.groupeFusion = fusion;
      } else {
        cible.formateurPresentiel = nom;
      }
    }
  }

  return [...parGroupe.values()];
}

/**
 * Identifiant d'affectation → NOM du formateur.
 *
 * ⚠️ `affectations[].formateur` ne contient PAS un nom : c'est l'identifiant
 * stable produit par `identifiant()` — le MATRICULE quand il existe, le nom
 * complet seulement en repli. L'écran, lui, raisonne en noms.
 *
 * Poser l'identifiant tel quel dans `formateurPresentiel` avait deux effets, le
 * second silencieux et grave : les sélecteurs affichaient « 18448 » au lieu du
 * nom, et le RÉENREGISTREMENT écrivait ce matricule dans la colonne « Formateur »
 * du format e-note. Le parseur recréait alors des formateurs NOMMÉS par leur
 * matricule, et sans matricule — puisqu'aucun formateur ne s'appelle « 18448 ».
 *
 * @returns {(identifiant: string) => string}
 */
function tableDesNoms(base) {
  const parMatricule = new Map();

  for (const formateur of base?.formateurs ?? []) {
    const matricule = String(formateur.matricule ?? '').trim();
    if (matricule !== '') parMatricule.set(matricule, formateur.nomComplet);
  }

  return (valeur) => {
    const identifiant = String(valeur ?? '').trim();
    // Sans matricule, l'identifiant EST déjà le nom complet.
    return parMatricule.get(identifiant) ?? identifiant;
  };
}

/**
 * Module présent dans les affectations mais absent de la répartition.
 *
 * Ses masses horaires viennent alors de l'affectation elle-même : c'est tout ce
 * qui en reste. Le perdre effacerait une affectation réelle.
 */
function rattacherModuleInconnu(groupe, affectation) {
  const module = {
    code: String(affectation.module ?? '').trim(),
    nom: String(affectation.module ?? '').trim(),
    mhpS1: affectation.type === TYPES_COURS.PRESENTIEL ? (affectation.s1Heures ?? 0) : 0,
    mhpS2: affectation.type === TYPES_COURS.PRESENTIEL ? (affectation.s2Heures ?? 0) : 0,
    mhsynS1: affectation.type === TYPES_COURS.SYNCHRONE ? (affectation.s1Heures ?? 0) : 0,
    mhsynS2: affectation.type === TYPES_COURS.SYNCHRONE ? (affectation.s2Heures ?? 0) : 0,
    estRegional: Boolean(affectation.estRegional),
    metier: '',
    formateurPresentiel: '',
    formateurSynchrone: '',
    groupeFusion: '',
  };

  groupe.modules.push(module);
  return module;
}

/**
 * Formateurs de la carte, à partir de ceux enregistrés dans la base.
 *
 * L'écran raisonne en NOMS ; la base garde le matricule comme identifiant
 * stable. Les deux sont rendus, l'écran affichant l'un et enregistrant l'autre.
 */
export function reconstruireFormateurs(base) {
  return (base?.formateurs ?? []).map((formateur) => ({
    nom: formateur.nomComplet,
    matricule: formateur.matricule ?? '',
    email: formateur.email ?? '',
    masseHoraire: formateur.masseHoraire ?? 0,
  }));
}
