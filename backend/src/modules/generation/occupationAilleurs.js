import { PERIODES } from 'shared/constants';

import { Seance } from '../../models/Seance.js';

/**
 * Les créneaux où ces formateurs ont cours DANS UN AUTRE ÉTABLISSEMENT.
 *
 * ═══ ⚠️ CORRECTIF DU 2026-09-27, CONSTATÉ SUR DONNÉES RÉELLES ═══
 * Le problème ne voit que les séances de SON établissement. Un formateur
 * mutualisé (ABDELGHANI LAASSAL, aussi à CFP MGD HASSANIA) paraissait donc
 * libre le lundi en S1, où il a cours là-bas : le placement proposait ce
 * créneau, `poser()` le refusait (« Ce créneau est déjà occupé »), et la
 * séance ressortait non placée alors que d'autres créneaux étaient libres.
 *
 * ⚠️ PARTAGÉ par la génération et par le placement des séances manquantes :
 *    tous deux construisent le même problème, et l'un ne doit pas voir ce que
 *    l'autre ignore.
 *
 * ⚠️ LA MÊME DÉFINITION QUE `poser()` : `obtenirAutresEtablissements` de la
 *    précharge, c'est-à-dire `autresEtablissementsDuFormateur` — pas une
 *    seconde lecture des bases qui pourrait en diverger.
 */
export async function occupationAilleurs(commun, anneeScolaire, semaine, taches, creneauVersCase) {
  const matricules = [...new Set(taches.map((tache) => tache.formateurMatricule).filter(Boolean))];
  const parMatricule = await Promise.all(
    matricules.map(async (matricule) => ({
      matricule,
      autres: await commun.prechargePoser.obtenirAutresEtablissements(matricule),
    }))
  );
  const conditions = parMatricule
    .filter(({ autres }) => autres.length > 0)
    .map(({ matricule, autres }) => ({
      formateurMatricule: matricule,
      etablissementId: { $in: autres.map((autre) => autre.etablissementId) },
    }));
  if (conditions.length === 0) return [];

  const prises = await Seance.find({
    anneeScolaire,
    semaine,
    periode: PERIODES.JOUR,
    $or: conditions,
  })
    .select('jour seance formateurMatricule')
    .lean();

  const idDe = new Map(
    [...creneauVersCase].map(([id, creneau]) => [`${creneau.jour}||${creneau.seance}`, id])
  );
  return prises
    .map((prise) => ({
      creneauId: idDe.get(`${prise.jour}||${prise.seance}`),
      formateur: prise.formateurMatricule,
    }))
    .filter((occupation) => occupation.creneauId !== undefined);
}
