/**
 * Référentiel DRIF — le catalogue national des filières et de leurs modules.
 * ← includes/repartition_import.php, api/admin/upload_repartition.php
 *
 * ⚠️ CE N'EST PAS UNE DONNÉE D'ÉTABLISSEMENT : les 13 359 lignes sont les mêmes
 * pour tous, et seul l'administrateur les modifie (décision du 2026-09-02).
 *
 * ═══ ⚠️ LES NOMS SONT SUFFIXÉS DANS CE BARILLET ═══
 * `COLONNES` existait DÉJÀ, exporté par `enote/` : deux constantes de même nom
 * dans le même barillet, et le ré-export est SILENCIEUSEMENT abandonné — c'est
 * ainsi que `calculerCharges` avait cassé l'import d'un écran situé ailleurs
 * (2026-08-21). `analyser`, `cleLigne` ou `lireLignes` sont tout aussi
 * génériques : ils portent donc leur domaine dans leur nom exporté.
 */
export {
  CHAMPS_NUMERIQUES as CHAMPS_NUMERIQUES_REPARTITION,
  COLONNES as COLONNES_REPARTITION,
  COLONNES_OBLIGATOIRES as COLONNES_OBLIGATOIRES_REPARTITION,
  FEUILLE_PREFEREE as FEUILLE_REPARTITION,
  estRegional,
  nombre as nombreRepartition,
} from './colonnes.js';

export {
  analyser as analyserRepartition,
  dedoublonner as dedoublonnerRepartition,
  choisirFeuille as choisirFeuilleRepartition,
  cleLigne as cleLigneRepartition,
  lireLignes as lireLignesRepartition,
} from './import.js';
