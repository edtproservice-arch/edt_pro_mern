import { CalendrierNational } from '../../models/CalendrierNational.js';
import { badRequest } from '../../lib/httpError.js';

/**
 * Calendrier national — vacances du réseau et dates de rentrée.
 * (demande du porteur, 2026-09-02.)
 *
 * ═══ ⚠️ ÉCRITURE ADMIN, LECTURE OUVERTE AUX ÉTABLISSEMENTS ═══
 * Un directeur doit LIRE ce calendrier — c'est lui qui alimente le sien par
 * défaut — mais ne l'écrit pas : une correction faite chez lui s'appliquerait à
 * tout le réseau. Ses ajustements vivent dans `Etablissement.calendrier`.
 */

/**
 * Le calendrier d'une année scolaire.
 *
 * ⚠️ UN DOCUMENT ABSENT N'EST PAS UNE ERREUR : une année qui n'a pas encore été
 * paramétrée rend simplement des listes vides — et rien n'est gelé, ce qui est
 * le comportement voulu tant que l'admin n'a rien saisi.
 */
export async function obtenir(anneeScolaire) {
  const calendrier = await CalendrierNational.findOne({ anneeScolaire }).lean();

  return {
    anneeScolaire,
    vacances: calendrier?.vacances ?? [],
    rentrees: (calendrier?.rentrees ?? []).sort((a, b) => a.anneeFormation - b.anneeFormation),
  };
}

/**
 * Enregistre le calendrier d'une année — remplacement complet.
 *
 * ⚠️ REMPLACEMENT ET NON FUSION : l'écran envoie la liste entière qu'il affiche,
 * et une période retirée à l'écran doit disparaître. Une fusion ferait
 * réapparaître ce qu'on vient de supprimer.
 */
export async function enregistrer(anneeScolaire, { vacances = [], rentrees = [] }) {
  /*
   * ⚠️ TRADUCTION `intitule` → `nom`. Le fil parle `intitule` — c'est le
   * vocabulaire du calendrier partagé et celui de l'établissement — quand le
   * modèle porte `nom`. Le renommer en base imposerait une migration pour rien ;
   * la traduction tient en une ligne, ici et dans `presenter`, et nulle part
   * ailleurs.
   */
  const enBase = vacances.map((periode) => ({
    nom: periode.intitule,
    debut: periode.debut,
    fin: periode.fin,
  }));

  refuserNomsEnDouble(enBase);
  refuserAnneesEnDouble(rentrees);

  const calendrier = await CalendrierNational.findOneAndUpdate(
    { anneeScolaire },
    { $set: { vacances: enBase, rentrees } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  return presenter({
    anneeScolaire,
    vacances: calendrier.vacances ?? [],
    rentrees: calendrier.rentrees ?? [],
  });
}

/**
 * Le calendrier tel qu'il part SUR LE FIL.
 *
 * ═══ ⚠️ POURQUOI `obtenir` NE LE FAIT PAS LUI-MÊME ═══
 * `obtenir` sert aussi QUATRE services internes — emploi du temps, chronogramme,
 * avancement, calendrier d'établissement — qui passent ses vacances à
 * `fusionnerVacances`, laquelle lit `periode.nom`. Renommer à la source aurait
 * rendu `nom: undefined` chez eux : les périodes auraient perdu leur nom, et
 * l'écartement par un établissement — qui s'apparie précisément SUR CE NOM —
 * n'aurait plus jamais correspondu, sans la moindre erreur pour le signaler.
 *
 * La traduction reste donc à la FRONTIÈRE HTTP, où elle appartient.
 */
export function presenter({ anneeScolaire, vacances = [], rentrees = [] }) {
  return {
    anneeScolaire,
    vacances: vacances.map((periode) => ({
      intitule: periode.nom,
      debut: periode.debut,
      fin: periode.fin,
    })),
    rentrees: [...rentrees].sort((a, b) => a.anneeFormation - b.anneeFormation),
  };
}

/**
 * ⚠️ LE NOM EST LA CLÉ D'APPARIEMENT côté établissement : c'est par lui qu'un
 * directeur ÉCARTE une période nationale. Deux périodes de même nom rendraient
 * l'écartement ambigu — il en retirerait deux en croyant en retirer une.
 */
function refuserNomsEnDouble(vacances = []) {
  const vus = new Set();

  for (const periode of vacances) {
    const cle = String(periode.nom ?? '').trim().toLowerCase();
    if (vus.has(cle)) {
      throw badRequest(
        `Deux périodes portent le nom « ${periode.nom} ». Le nom sert de repère aux établissements : il doit être unique.`,
        { code: 'PERIODE_EN_DOUBLE' }
      );
    }
    vus.add(cle);
  }
}

/** Une année de formation n'a qu'une rentrée. */
function refuserAnneesEnDouble(rentrees = []) {
  const vus = new Set();

  for (const rentree of rentrees) {
    if (vus.has(rentree.anneeFormation)) {
      throw badRequest(
        `L'année ${rentree.anneeFormation} a déjà une date de rentrée.`,
        { code: 'RENTREE_EN_DOUBLE' }
      );
    }
    vus.add(rentree.anneeFormation);
  }
}
