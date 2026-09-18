import { TYPES_COURS } from '../../constants/index.js';
import { anneeDuNomGroupe, separerFusion } from '../carte/reconstruction.js';
import { semestreDe } from './semestre.js';
import { cleModule } from '../emploi/indicateurs.js';

/**
 * L'avancement CALCULÉ depuis la grille — la face « eDTpro » de l'écran.
 * ← `get_planned_progress.php`
 *
 * ═══ ⚠️ LA MÊME FORME DE LIGNE QUE LA FACE E-NOTE ═══
 * Les deux faces se rapportent au MÊME prévu — les masses affectées — et ne
 * diffèrent que par le réalisé : e-note le DÉCLARE, la grille le COMPTE. En
 * produisant ici la forme exacte de `lireAvancementEnote`, les trois axes,
 * le total et les taux passent par un seul jeu de fonctions. Deux agrégations
 * parallèles auraient divergé au premier ajustement — le §4.2 du plan ne
 * relève rien d'autre.
 *
 * ═══ ⚠️ POURQUOI RECONSTRUIRE UNE LIGNE PAR (GROUPE, MODULE) ═══
 * `Base.affectations` porte une entrée par (formateur, groupe, module, TYPE) —
 * et l'entrée synchrone porte le libellé FUSIONNÉ « GM101 GM102 ». L'export
 * e-note, lui, porte une ligne par GROUPE, avec ses heures présentielles et la
 * séance synchrone de son ensemble. On rétablit donc cette forme : sans elle,
 * la face eDTpro compterait ses groupes autrement que la face e-note, et les
 * deux colonnes de l'écran ne seraient plus comparables.
 */

/**
 * @param {Array} affectations — `Base.affectations`
 * @param {Map|object} posees — sortie de `heuresPosees`, indexée `groupe||module`
 * @param {(identifiant: string) => string} nomDuFormateur — les affectations
 *   portent l'IDENTIFIANT (souvent un matricule) ; l'écran affiche un nom.
 * @param {object} groupeModes — `Base.groupeModes` : le MODE DE FORMATION
 *   (résidentiel, alterné…) n'est pas sur l'affectation, il est propre au
 *   GROUPE. La face e-note le lit en colonne 15 ; ici il faut aller le chercher.
 */
export function lignesDepuisAffectations(
  affectations = [],
  posees = new Map(),
  nomDuFormateur = (x) => x,
  groupeModes = {}
) {
  const lignes = new Map();

  const ligneDe = (groupe, module) => {
    const cle = cleModule(groupe, module);
    if (!lignes.has(cle)) {
      lignes.set(cle, {
        groupe,
        fusionGroupe: '',
        module,
        formateurPresentiel: '',
        formateurSynchrone: '',
        prevuPresentiel: 0,
        prevuSynchrone: 0,
        realisePresentiel: 0,
        realiseSynchrone: 0,
        estRegional: false,
        /*
         * ⚠️ LES TROIS CHAMPS DES FILTRES, dans la forme EXACTE de la face
         * e-note : `filtrerAvancement` ne doit pas avoir à savoir d'où vient la
         * ligne. Le semestre s'accumule au fil des affectations (voir plus
         * bas) — un module peut porter du S1 en présentiel et du S2 à distance.
         */
        mode: String(groupeModes?.[groupe] ?? '').trim(),
        semestre: '',
        annee: anneeDuNomGroupe(groupe),
        heuresS1: 0,
        heuresS2: 0,
      });
    }
    return lignes.get(cle);
  };

  for (const affectation of affectations) {
    const module = String(affectation.module ?? '').trim();
    if (module === '') continue;

    const libelle = String(affectation.groupe ?? '').trim();
    const s1 = affectation.s1Heures ?? 0;
    const s2 = affectation.s2Heures ?? 0;
    const heures = s1 + s2;
    const nom = nomDuFormateur(String(affectation.formateur ?? '').trim());

    if (affectation.type === TYPES_COURS.SYNCHRONE) {
      /*
       * ⚠️ LA SÉANCE MUTUALISÉE SE POSE SUR CHACUN DE SES GROUPES, avec le
       * libellé de l'ensemble : c'est lui qui permettra à l'agrégation de ne la
       * compter qu'une fois par formateur et par module. Sans ce libellé, deux
       * groupes fusionnés apparaîtraient comme deux séances distinctes.
       */
      const membres = separerFusion(libelle);
      for (const groupe of membres) {
        const ligne = ligneDe(groupe, module);
        ligne.prevuSynchrone += heures;
        ligne.heuresS1 += s1;
        ligne.heuresS2 += s2;
        ligne.fusionGroupe = membres.length > 1 ? libelle : '';
        if (nom) ligne.formateurSynchrone = nom;
        if (affectation.estRegional) ligne.estRegional = true;
      }
      continue;
    }

    // Le présentiel n'est jamais mutualisé : une entrée, un groupe.
    const ligne = ligneDe(libelle, module);
    ligne.prevuPresentiel += heures;
    ligne.heuresS1 += s1;
    ligne.heuresS2 += s2;
    if (nom) ligne.formateurPresentiel = nom;
    if (affectation.estRegional) ligne.estRegional = true;
  }

  /*
   * ⚠️ LE RÉALISÉ SE LIT SUR LA CLÉ DU GROUPE, pas sur celle de l'ensemble :
   * `heuresPosees` crédite DÉJÀ chaque membre d'une séance fusionnée, en plus
   * du libellé entier. Passer par l'ensemble reviendrait à lire la même valeur
   * pour tous, ce qui est vrai du synchrone mais faux du présentiel.
   */
  const lire = (cle) => (posees instanceof Map ? posees.get(cle) : posees?.[cle]) ?? {};

  for (const [cle, ligne] of lignes) {
    const compte = lire(cle);
    ligne.realisePresentiel = arrondir(compte[TYPES_COURS.PRESENTIEL] ?? 0);
    ligne.realiseSynchrone = arrondir(compte[TYPES_COURS.SYNCHRONE] ?? 0);
    ligne.prevuPresentiel = arrondir(ligne.prevuPresentiel);
    ligne.prevuSynchrone = arrondir(ligne.prevuSynchrone);

    /*
     * ⚠️ LE SEMESTRE SE DÉCIDE UNE FOIS TOUTES LES AFFECTATIONS CUMULÉES, pas
     * au fil de l'eau : un module dont le présentiel est en S1 et le synchrone
     * en S2 est ANNUEL, et le trancher sur la première affectation rencontrée
     * l'aurait figé sur la moitié de sa réalité.
     */
    ligne.semestre = semestreDe(ligne.heuresS1, ligne.heuresS2);
    delete ligne.heuresS1;
    delete ligne.heuresS2;
  }

  return [...lignes.values()];
}

const arrondir = (valeur) => Math.round(valeur * 100) / 100;
