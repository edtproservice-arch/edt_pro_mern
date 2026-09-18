import { NOMBRE_SEMAINES } from './semaines.js';
import { TYPES } from './planning.js';

/**
 * Charge hebdomadaire, par formateur et par groupe.
 * ← includes/chrono_modules.php : `chrono_calculer_charges()`
 *
 * ═══ POURQUOI CE CALCUL VIT ICI ═══
 * `calculerChargeFormateurs()` lisait les `<select>` de la page : elle ne voyait
 * donc que les groupes AFFICHÉS. Pour connaître la charge réelle d'une personne,
 * il fallait cocher les vingt groupes et attendre que les grilles se montent —
 * précisément ce qu'on cherche à éviter. Le calcul ne dépend plus de rien
 * d'affiché.
 *
 * ═══ ⚠️ LA RÈGLE DU SYNCHRONE, ET POURQUOI ELLE DIFFÈRE SELON LE SUJET ═══
 * Une séance à distance donnée UNE FOIS pour plusieurs groupes fusionnés :
 *   · pour le GROUPE, elle compte — il reçoit bien ces heures, chacun des
 *     groupes couverts les reçoit ;
 *   · pour le FORMATEUR, elle ne compte QU'UNE FOIS — il ne la donne qu'une
 *     fois, et la compter par groupe ferait croire à une surcharge inexistante.
 *
 * C'est la règle du générateur. Les deux doivent dire la même chose, sinon le
 * tableau accuse une surcharge que le moteur ignore.
 */

/** Seuil de charge hebdomadaire au-delà duquel la semaine déborde. */
export const SEUIL_HEBDOMADAIRE = 30;

/**
 * @param {Array<{groupe, module, formateur, ensemble?, planning}>} lignes
 *   `planning` : `{ [semaine]: {heures, type} }`, semaine en nombre ou « S12 ».
 *   `ensemble` : libellé de fusion synchrone (« GM101 GM102 »), sinon le groupe.
 * @returns {{formateurs: object, groupes: object}} sujet → { semaines, totaux }
 *
 * ⚠️ NOM DISTINCT DE `calculerCharges` (domaine de la CARTE), et ce n'est pas
 * un détail de style : les deux vivaient dans le même barillet, et le
 * ré-export ambigu était SILENCIEUSEMENT abandonné — l'import de la page
 * Affectations cassait au build, loin d'ici. Deux calculs différents ne
 * peuvent pas porter le même nom : celui de la carte part des AFFECTATIONS
 * (qui doit quoi), celui-ci des CHRONOGRAMMES (qui fait quoi, et quand).
 */
export function chargesHebdomadaires(lignes = []) {
  const parFormateur = new Map();
  const parGroupe = new Map();
  /*
   * ⚠️ Les séances synchrones DÉJÀ COMPTÉES pour un formateur. La clé identifie
   * la séance, pas la ligne : même personne, même module, même ensemble de
   * groupes, même semaine — c'est UNE séance, quel que soit le nombre de lignes
   * qui la décrivent.
   */
  const synchronesVues = new Set();

  for (const ligne of lignes) {
    const groupe = String(ligne?.groupe ?? '').trim();
    const module = String(ligne?.module ?? '').trim();
    const formateur = String(ligne?.formateur ?? '').trim();
    if (groupe === '' || module === '') continue;

    for (const [cle, cellule] of Object.entries(ligne.planning ?? {})) {
      const semaine = numeroSemaine(cle);
      const heures = Number(cellule?.heures ?? 0);
      if (semaine === null || !(heures > 0)) continue;

      const synchrone = cellule?.type === TYPES.SYNCHRONE;
      const nature = synchrone ? 'synchrone' : 'presentiel';

      // ─── Groupe : tout compte, sans dédoublonnage ───
      case_(parGroupe, groupe, semaine)[nature] += heures;

      // ─── Formateur ───
      // « -- » est la valeur que l'existant posait pour « pas de formateur ».
      if (formateur === '' || formateur === '--') continue;

      if (!synchrone) {
        case_(parFormateur, formateur, semaine).presentiel += heures;
        continue;
      }

      const cleSeance = [
        formateur.toUpperCase(),
        module.toUpperCase(),
        membresEnsemble(ligne.ensemble, groupe).join('+'),
        semaine,
      ].join('||');

      if (synchronesVues.has(cleSeance)) continue;
      synchronesVues.add(cleSeance);

      case_(parFormateur, formateur, semaine).synchrone += heures;
    }
  }

  return {
    formateurs: mettreEnForme(parFormateur),
    groupes: mettreEnForme(parGroupe),
  };
}

/** Les groupes d'un ensemble synchrone, normalisés et TRIÉS. */
function membresEnsemble(ensemble, groupe) {
  const libelle = String(ensemble ?? '').trim() || groupe;

  return libelle
    .split(/\s+/)
    .filter(Boolean)
    .map((nom) => nom.toUpperCase())
    .sort();
}

/** La case (sujet, semaine), créée à la volée. */
function case_(table, sujet, semaine) {
  if (!table.has(sujet)) table.set(sujet, new Map());
  const semaines = table.get(sujet);

  if (!semaines.has(semaine)) semaines.set(semaine, { presentiel: 0, synchrone: 0 });
  return semaines.get(semaine);
}

/**
 * Map interne → objet simple, avec les totaux.
 *
 * `total` par semaine est calculé ICI et non à l'affichage : le tableau, le
 * pied et l'export doivent tomber sur le même nombre, et trois additions
 * séparées finissent par diverger d'un centième.
 */
function mettreEnForme(table) {
  const sortie = {};

  for (const [sujet, semaines] of table) {
    const parSemaine = {};
    let presentiel = 0;
    let synchrone = 0;
    let depassements = 0;

    for (const [semaine, valeurs] of semaines) {
      const total = arrondir(valeurs.presentiel + valeurs.synchrone);
      if (total <= 0) continue;

      parSemaine[semaine] = {
        presentiel: arrondir(valeurs.presentiel),
        synchrone: arrondir(valeurs.synchrone),
        total,
      };

      presentiel += valeurs.presentiel;
      synchrone += valeurs.synchrone;
      if (total > SEUIL_HEBDOMADAIRE) depassements += 1;
    }

    // Un sujet dont toutes les semaines sont vides n'a rien à dire : l'afficher
    // remplirait le tableau de lignes à zéro qu'on doit parcourir des yeux.
    if (Object.keys(parSemaine).length === 0) continue;

    sortie[sujet] = {
      semaines: parSemaine,
      presentiel: arrondir(presentiel),
      synchrone: arrondir(synchrone),
      total: arrondir(presentiel + synchrone),
      depassements,
    };
  }

  return sortie;
}

/** « S12 » ou 12 → 12 ; tout le reste → `null`. */
function numeroSemaine(cle) {
  const trouve = /^S?(\d{1,2})$/i.exec(String(cle).trim());
  if (!trouve) return null;

  const numero = Number(trouve[1]);
  return numero >= 1 && numero <= NOMBRE_SEMAINES ? numero : null;
}

const arrondir = (valeur) => Math.round(valeur * 100) / 100;
