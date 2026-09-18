import { fusionnerJoursFeries } from 'shared/domain';
import { obtenir as calendrierNational } from '../calendrierNational/calendrierNational.service.js';
import { Etablissement } from '../../models/Etablissement.js';
import { notFound } from '../../lib/httpError.js';
import { conditionVersion, versionPerimee } from '../../lib/versionOptimiste.js';
import { obtenirNationaux } from './joursFeries.service.js';

/**
 * Calendrier d'un établissement (F3, F13).
 * ← api/setup/complete_setup.php:286-289, api/profile/save_calendrier.php
 *
 * L'établissement ne possède pas la liste des jours fériés : il possède ses
 * ÉCARTS par rapport à l'estimation nationale. Elle est recomposée à chaque
 * lecture. C'est ce qui permet à une correction de survivre au décalage d'un
 * jour que les autorités annoncent la veille de l'Aïd.
 */

async function charger(etablissementId) {
  const etablissement = await Etablissement.findById(etablissementId);
  if (!etablissement) throw notFound('Établissement introuvable', { code: 'ETABLISSEMENT_INCONNU' });
  return etablissement;
}

/** Jours fériés effectifs : estimation nationale + ajustements de l'établissement. */
export async function joursFeries(etablissementId, anneeScolaire) {
  const [etablissement, nationaux] = await Promise.all([
    charger(etablissementId),
    obtenirNationaux(anneeScolaire),
  ]);

  return presenterFeries(nationaux, etablissement.calendrier?.ajustementsFeries ?? []);
}

/**
 * Les jours fériés NATIONAUX, sans aucun ajustement.
 * (2026-09-03, signalé par le porteur : « les jours fériés n'affichent pas ».)
 *
 * ═══ ⚠️ POURQUOI CETTE SECONDE PORTE ═══
 * L'écran d'administration réutilise `EtapeCalendrier`, qui interrogeait
 * `/calendrier/jours-feries` — un chemin réservé aux DIRECTEURS et résolu sur un
 * établissement. Un administrateur n'en a aucun : la requête revenait en **403**,
 * et la page affichait « le service des jours fériés n'a pas répondu » alors
 * qu'il avait parfaitement répondu. Le message accusait l'API là où c'était un
 * problème de DROITS.
 *
 * ⚠️ ET IL N'Y A PAS D'AJUSTEMENTS À APPLIQUER ICI : ceux-ci appartiennent à un
 * établissement. L'admin voit l'estimation nationale, la même pour tous — c'est
 * exactement ce que sa page a besoin de montrer.
 */
export async function joursFeriesNationaux(anneeScolaire) {
  return presenterFeries(await obtenirNationaux(anneeScolaire), []);
}

/**
 * Met en forme les fériés pour l'écran, ajustements appliqués.
 *
 * ⚠️ UNE SEULE MISE EN FORME POUR LES DEUX PORTES. En écrire une seconde pour
 * l'administrateur, c'était deux `estime` à tenir cohérents — et le jour où
 * l'une aurait dérivé, la même date se serait affichée « estimée » chez le
 * directeur et fixe chez l'admin, sans que rien ne l'explique.
 */
function presenterFeries(nationaux, ajustements) {
  // Les champs venus de la source sont retrouvés APRÈS fusion, par libellé :
  // `fusionnerJoursFeries` ne connaît que `date` et `libelle`, et n'a pas à
  // connaître le reste.
  const parLibelle = new Map(nationaux.jours.map((ferie) => [ferie.libelle, ferie]));

  const jours = fusionnerJoursFeries(
    nationaux.jours.map((ferie) => ({ date: ferie.date, libelle: ferie.libelle })),
    ajustements.map((ajustement) => ({
      libelle: ajustement.libelle,
      date: ajustement.date ?? undefined,
      supprime: ajustement.supprime,
    }))
  );

  return {
    joursFeries: jours.map((ferie) => {
      const source = parLibelle.get(ferie.libelle);

      return {
        date: ferie.date,
        intitule: ferie.libelle,
        intituleAr: source?.libelleAr ?? '',
        type: source?.type ?? 'national',
        /*
         * ⚠️ `estime` valait `origine === 'api'`, donc VRAI pour toutes les
         * dates chargées — « Nouvel An (estimé) », « Fête du Travail
         * (estimé) ». À force d'être partout, la mention ne signalait plus
         * rien. Seules les fêtes LUNAIRES en sont, et la source le dit
         * maintenant explicitement.
         *
         * Une date déjà corrigée par l'établissement n'est plus une
         * estimation : c'est une décision.
         */
        estime: ferie.origine === 'api' && (source?.estime ?? false),
        origine: ferie.origine,
      };
    }),
    complet: nationaux.complet,
    recupereLe: nationaux.recupereLe,
  };
}

/**
 * Vacances scolaires enregistrées, ET celles du réseau.
 *
 * ═══ ⚠️ LES DEUX ENSEMBLE, PARCE QU'ELLES S'AFFICHENT ENSEMBLE ═══
 * (demande du porteur, 2026-09-02.) Les périodes du réseau s'appliquent par
 * DÉFAUT : l'écran doit les montrer, sinon le directeur déclare les siennes en
 * double sans savoir que les vacances nationales sont déjà là. Il peut en
 * écarter une qui ne le concerne pas — c'est ce que porte `ecartees`.
 */
export async function obtenir(etablissementId, anneeScolaire) {
  const [etablissement, national] = await Promise.all([
    charger(etablissementId),
    calendrierNational(anneeScolaire),
  ]);

  return {
    nationales: national.vacances.map((periode) => ({
      intitule: periode.nom,
      debut: periode.debut,
      fin: periode.fin,
    })),
    ecartees: etablissement.calendrier?.vacancesEcartees ?? [],
    // La version que l'écran renverra (étape d3).
    version: etablissement.versions?.calendrier ?? 0,
    vacances: (etablissement.calendrier?.vacances ?? []).map(presenterPeriode),
    ajustementsFeries: (etablissement.calendrier?.ajustementsFeries ?? []).map((ajustement) => ({
      libelle: ajustement.libelle,
      date: ajustement.date,
      supprime: ajustement.supprime,
    })),
  };
}

/**
 * Remplace le calendrier de l'établissement.
 *
 * Remplacement complet et non fusion : l'écran envoie la liste telle qu'elle
 * est affichée, et une suppression doit se propager. `complete_setup.php`
 * faisait de même (`ON DUPLICATE KEY UPDATE` sur le blob entier).
 *
 * ═══ UNE SEULE MISE À JOUR, VERSION COMPRISE (étape d3) ═══
 * La lecture puis `save()` d'avant ne comparait rien : deux personnes sur le
 * calendrier, et la seconde effaçait les vacances de la première. Le compteur
 * est désormais dans le FILTRE de la mise à jour — voir `lib/versionOptimiste.js`.
 *
 * @param {number} [version]  celle que l'écran a lue ; absente, l'écriture passe
 */
export async function enregistrer(
  etablissementId,
  { vacances = [], ajustementsFeries = [], vacancesEcartees, anneeScolaire, version }
) {
  const $set = {
    'calendrier.vacances': vacances.map((periode) => ({
      libelle: periode.intitule ?? periode.libelle ?? 'Vacances',
      // Une période saisie à l'envers est retournée plutôt que refusée : c'est
      // une inversion de clics, pas une erreur de fond.
      debut: periode.debut <= periode.fin ? periode.debut : periode.fin,
      fin: periode.debut <= periode.fin ? periode.fin : periode.debut,
    })),
    'calendrier.ajustementsFeries': ajustementsFeries,
  };

  /*
   * ⚠️ `vacancesEcartees` N'EST ÉCRIT QUE S'IL EST FOURNI. `undefined` veut dire
   * « l'appelant ne s'en occupe pas » : on garde alors l'existant, et c'est
   * précisément ce que le chemin pointé permet sans relire le document. Un
   * tableau vide, lui, EFFACE — c'est un choix explicite. Omis, une simple
   * modification de vacances remettrait à l'écran toutes les périodes nationales
   * que l'établissement avait mises de côté.
   */
  if (vacancesEcartees !== undefined) $set['calendrier.vacancesEcartees'] = vacancesEcartees;

  const etablissement = await Etablissement.findOneAndUpdate(
    { _id: etablissementId, ...conditionVersion('versions.calendrier', version) },
    { $set, $inc: { 'versions.calendrier': 1 } },
    { new: true, runValidators: true }
  );

  if (!etablissement) {
    // Absent, ou compteur déjà avancé : on distingue les deux, un 409 sur un
    // établissement inexistant enverrait recharger une page qui n'existe pas.
    if (!(await Etablissement.exists({ _id: etablissementId }))) {
      throw notFound('Établissement introuvable', { code: 'ETABLISSEMENT_INCONNU' });
    }
    throw versionPerimee();
  }

  return obtenir(etablissementId, anneeScolaire);
}

function presenterPeriode(periode) {
  return { intitule: periode.libelle, debut: periode.debut, fin: periode.fin };
}
