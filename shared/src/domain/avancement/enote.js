import { COLONNES, resoudreColonnes } from '../enote/colonnes.js';
import { indexerFilieresParGroupe, renommerGroupe } from '../enote/suffixesGroupes.js';
import { anneeDuNomGroupe } from '../carte/reconstruction.js';
import { semestreDe } from './semestre.js';
import { nombre } from './nombre.js';

export { nombre };

/**
 * L'avancement DÉCLARÉ dans e-note, lu depuis le fichier importé.
 * ← `get_avancement_data.php` + le calcul inline d'avancement.html
 *
 * ═══ ⚠️ UN SEUL FICHIER, DEUX USAGES ═══
 * `upload_base_data.php` écrivait le MÊME export e-note dans deux tables :
 * `donnees_de_base` (structuré, devenu `Base`) et `donnees_avancement` (brut,
 * devenu `EnoteImport`). Ce module lit le second — les colonnes que l'import de
 * la carte ne regarde pas.
 *
 * ═══ ⚠️ LES DEUX FACES PARTAGENT LE PRÉVU ═══
 * Les colonnes 35-36 sont les masses AFFECTÉES : ce que l'établissement a
 * confié à ses formateurs, et ce que l'import de la carte lit déjà. Les
 * colonnes 38-39 sont ce qu'il DÉCLARE avoir fait. La face « eDTpro » remplace
 * ce déclaratif par les heures réellement posées dans la grille — mais les deux
 * se rapportent au même prévu, sans quoi les taux ne seraient pas comparables.
 */

/**
 * Les lignes utiles d'un import e-note.
 *
 * ⚠️ ON GARDE LA LIGNE, PAS UN AGRÉGAT. L'axe (formateur, groupe ou module) se
 * choisit à l'affichage : agréger ici obligerait à relire le fichier trois fois,
 * et à écrire trois fois la même lecture de colonnes.
 *
 * @param {{entete?: string[], lignes?: Array<Array>}} importe
 */
export function lireAvancementEnote(importe) {
  const colonnes = resoudreColonnes(importe?.entete ?? []);
  const cellule = (ligne, champ) => ligne[colonnes[champ] ?? COLONNES[champ].index];
  const lignesBrutes = importe?.lignes ?? [];

  /*
   * ═══ ⚠️⚠️ LE GROUPE EST RENOMMÉ COMME À L'IMPORT DE LA CARTE (2026-09-25,
   * signalé par le porteur : « pourquoi 245 modules en eDTpro et 228 en
   * e-note, et pourquoi ACADA101 sans (FQ) en e-note ») ═══
   *
   * Les deux faces lisent le MÊME fichier importé — `upload_base_data.php`
   * l'écrivait déjà dans deux tables, `Base` (devenue la carte) ET
   * `donnees_avancement` (devenue `EnoteImport`, lue ici) — mais seule la
   * carte le faisait passer par `renommerGroupe` (« (FQ) », « (CDS) », ou le
   * préfixe de filière pour un nom porté par plusieurs). Sans ce même
   * renommage ICI, un groupe FQ portait deux noms DIFFÉRENTS selon la face
   * regardée — deux groupes DISTINCTS pour l'application, qui gonflait ou
   * creusait le compte de modules de l'une par rapport à l'autre, et rendait
   * les deux faces incomparables sur ce groupe.
   *
   * ⚠️ LA TABLE D'AMBIGUÏTÉ SE CONSTRUIT SUR TOUT LE FICHIER D'ABORD, comme à
   * l'import de la carte : elle a besoin de voir TOUTES les lignes pour savoir
   * qu'un nom est porté par plusieurs filières, avant de trancher pour CHACUNE.
   */
  const filieresParGroupe = indexerFilieresParGroupe(
    lignesBrutes.map((ligne) => ({
      groupe: texte(cellule(ligne, 'groupe')),
      codeFiliere: texte(cellule(ligne, 'codeFiliere')),
    }))
  );

  return lignesBrutes
    .map((ligne) => ({
      groupe: renommerGroupe(
        texte(cellule(ligne, 'groupe')),
        texte(cellule(ligne, 'codeFiliere')),
        filieresParGroupe
      ),
      // Le groupe FUSIONNÉ, lui, n'est PAS renommé : il porte déjà son propre
      // nom dans le fichier, et sert de clé de regroupement pour le synchrone
      // — même règle que `construireGroupes`.
      fusionGroupe: texte(cellule(ligne, 'fusionGroupe')),
      module: texte(cellule(ligne, 'module')),
      formateurPresentiel: texte(cellule(ligne, 'formateurPresentiel')),
      formateurSynchrone: texte(cellule(ligne, 'formateurSynchrone')),
      matriculePresentiel: texte(cellule(ligne, 'matriculePresentiel')),
      matriculeSynchrone: texte(cellule(ligne, 'matriculeSynchrone')),
      prevuPresentiel: nombre(cellule(ligne, 'masseHorairePresentiel')),
      prevuSynchrone: nombre(cellule(ligne, 'masseHoraireSynchrone')),
      realisePresentiel: nombre(cellule(ligne, 'realisePresentiel')),
      realiseSynchrone: nombre(cellule(ligne, 'realiseSynchrone')),
      estRegional: texte(cellule(ligne, 'efmRegional')).toUpperCase() === 'O',
      /*
       * ⚠️ LES TROIS CHAMPS DES FILTRES. Ils ne servent à aucun calcul d'heures,
       * mais ce sont les seules facettes que l'écran puisse proposer — et elles
       * doivent voyager AVEC la ligne : reconstruites après agrégation, elles
       * seraient perdues pour les sujets qui réunissent plusieurs groupes.
       */
      /*
       * ⚠️ LA MASSE DU RÉFÉRENTIEL, pas celle qui est affectée. Les colonnes
       * « MHP Totale DRIF » et « MHSYN Totale DRIF » disent ce que le PROGRAMME
       * prévoit ; les colonnes 35-36 disent ce que l'établissement a confié à
       * ses formateurs. L'écart entre les deux est justement ce que la courbe
       * « masse horaire globale » rend visible sur l'axe groupe.
       */
      masseDrif:
        nombre(cellule(ligne, 'masseDrifPresentiel')) + nombre(cellule(ligne, 'masseDrifSynchrone')),
      mode: texte(cellule(ligne, 'mode')),
      semestre: semestreDe(cellule(ligne, 'partS1'), cellule(ligne, 'partS2')),
      annee: anneeDuNomGroupe(texte(cellule(ligne, 'groupe'))),
    }))
    /*
     * ⚠️ UNE LIGNE SANS GROUPE NI MODULE N'EST PAS UNE AFFECTATION : les
     * fichiers e-note portent des lignes de sous-total et des séparateurs. Les
     * compter gonflerait le prévu sans rien réaliser.
     */
    .filter((ligne) => ligne.groupe !== '' && ligne.module !== '');
}


const texte = (valeur) => String(valeur ?? '').trim();
