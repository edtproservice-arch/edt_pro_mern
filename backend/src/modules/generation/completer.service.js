/**
 * Placer les séances qu'il manque à UNE semaine pour être conforme au
 * chronogramme — sans toucher à ce qui est déjà posé.
 * (demande du porteur, 2026-09-27 — capacité NOUVELLE : la fenêtre de
 * complétude de l'ancien EDT Pro ne faisait que constater.)
 *
 * ═══ CE N'EST PAS UNE GÉNÉRATION ═══
 * La génération REMPLACE la semaine. Ici on COMPLÈTE : chaque séance posée à
 * la main reste où elle est et occupe son créneau ; seules les séances
 * « À placer » de la fenêtre de conformité cherchent une place. Les trois
 * niveaux (libre ou « à éviter », sans salle, non placée) sont décrits dans
 * `shared/src/domain/chronogramme/placementManquantes.js`.
 *
 * ═══ ⚠️ LA SIMULATION PARCOURT LE MÊME CODE QUE L'ÉCRITURE ═══
 * Les placements passent par `poser()` DANS une transaction, que la simulation
 * ANNULE à la fin. L'aperçu voit donc exactement ce que l'écriture verrait —
 * salles mutualisées, formateurs partagés entre établissements, quota de la
 * carte, gel de rentrée —, et non une promesse que l'écriture démentirait.
 */

import mongoose from 'mongoose';

import {
  NIVEAUX_PLACEMENT,
  RAISONS_NON_PLACEE,
  normaliserValeurSemaine,
  placerManquantes as placerDansLeProbleme,
  seancesManquantes,
} from 'shared/domain';

import { AbsenceFormateur } from '../../models/AbsenceFormateur.js';
import { Seance } from '../../models/Seance.js';
import { badRequest } from '../../lib/httpError.js';
import { completudeDUneSemaine } from '../chronogramme/completude.service.js';
import { poser, semaine as lireSemaine } from '../seances/seances.service.js';
import { chargerCommun, tachesPour } from './donnees.js';
import { exigerChronogrammeLie } from './generation.service.js';
import { memoPose } from './memoPose.js';
import { occupationAilleurs } from './occupationAilleurs.js';
import { construireProbleme, joursOuverts } from './probleme.js';

/** Lancée pour annuler la transaction d'une simulation — jamais vue au-dehors. */
class FinDeSimulation extends Error {}

/**
 * Un refus de `poser()` qui ne porte QUE sur la salle : la séance peut encore
 * se poser sans salle, au niveau 2. Le cas type est la salle mutualisée, prise
 * par un AUTRE établissement — invisible au problème, qui ne voit que le sien.
 */
const refusPourLaSeuleSalle = (erreur) =>
  erreur?.code === 'CRENEAU_OCCUPE' &&
  Array.isArray(erreur.details) &&
  erreur.details.length > 0 &&
  erreur.details.every((detail) => detail.type === 'salle');

/**
 * @param {object} options
 * @param {boolean} [options.simulation=true] — ⚠️ VRAI PAR DÉFAUT : une requête
 *   qui oublie le drapeau ne fait que compter, comme le report (d).
 */
export async function completerSemaine(
  etablissementId,
  anneeScolaire,
  valeurSemaine,
  { simulation = true } = {}
) {
  const normalisee = normaliserValeurSemaine(valeurSemaine);
  if (!normalisee) {
    throw badRequest(`Semaine « ${valeurSemaine} » illisible`, { code: 'SEMAINE_INVALIDE' });
  }

  await exigerChronogrammeLie(etablissementId, anneeScolaire);

  const [commun, bilan, etatSemaine] = await Promise.all([
    chargerCommun(etablissementId, anneeScolaire),
    completudeDUneSemaine(etablissementId, anneeScolaire, normalisee),
    lireSemaine(etablissementId, anneeScolaire, normalisee),
  ]);

  const { taches } = tachesPour(commun, bilan.numero);

  /*
   * ⚠️ LE MANQUE VIENT DU BILAN DE CONFORMITÉ, PAS D'UN SECOND CALCUL. La
   *    fenêtre affiche ces écarts : compter autrement ici ferait placer autre
   *    chose que ce que le directeur vient de lire.
   */
  const { aPlacer, sansAffectation } = seancesManquantes({ taches, ecarts: bilan.ecarts });

  const nomDe = new Map(commun.formateurs.map((f) => [f.matricule, f.nom]));
  const parId = new Map(taches.map((tache) => [tache.id, tache]));
  const decrire = (tache) => ({
    groupe: tache.groupeLibelle,
    /** Les membres d'une séance mutualisée : le chronogramme, lui, est tenu PAR groupe. */
    groupes: tache.groupes,
    module: tache.module,
    type: tache.type,
    formateur: nomDe.get(tache.formateurMatricule) ?? tache.formateurMatricule,
  });

  const placees = [];
  const nonPlacees = sansAffectation.map((entree) => ({
    groupe: entree.groupe,
    groupes: [entree.groupe],
    module: entree.module,
    type: entree.type,
    formateur: '',
    nombre: Math.ceil(entree.heures / 2.5 - 0.01),
    raison: entree.raison,
  }));

  const aTraiter = taches.filter((tache) => aPlacer.has(tache.id));

  if (aTraiter.length > 0 && joursOuverts(etatSemaine).length === 0) {
    // Semaine entièrement fermée : aucun créneau n'existe, rien à chercher.
    for (const tache of aTraiter) {
      nonPlacees.push({
        ...decrire(tache),
        nombre: aPlacer.get(tache.id),
        raison: RAISONS_NON_PLACEE.CRENEAUX_FERMES,
      });
    }
    return resultat(normalisee, simulation, placees, nonPlacees);
  }

  if (aTraiter.length === 0) return resultat(normalisee, simulation, placees, nonPlacees);

  /*
   * ⚠️ TOUTES LES SÉANCES DE JOUR OCCUPENT LEUR CRÉNEAU — pas seulement les EFM
   *    et rattrapages que la génération préserve. Rien de ce qui est posé ne
   *    bouge : c'est toute la différence avec une génération.
   */
  // ⚠️ LE SOIR AUSSI (2026-10-09) : une tâche CDS de 2 h se pose au soir, et
  //    les soirées déjà prises doivent l'empêcher. Sans tâche du soir, le
  //    problème n'a pas ces créneaux et elles sont écartées.
  const existantes = etatSemaine.seances ?? [];

  const { probleme, creneauVersCase } = construireProbleme({
    semaine: etatSemaine,
    taches: aTraiter,
    salles: commun.etablissement?.espaces ?? [],
    groupesFq: commun.etablissement?.groupesFq ?? [],
    contraintes: commun.contraintes,
    formateurs: commun.formateurs,
    graine: 0,
    assouplissement: {},
    aPreserver: existantes,
  });

  probleme.occupation.push(
    ...(await occupationAilleurs(commun, anneeScolaire, normalisee, aTraiter, creneauVersCase))
  );

  const proposition = placerDansLeProbleme(probleme, aPlacer);

  for (const non of proposition.nonPlacees) {
    nonPlacees.push({ ...decrire(parId.get(non.tacheId)), nombre: non.nombre, raison: non.raison });
  }

  const session = await mongoose.startSession();
  let ecrites = [];
  let refusees = [];

  try {
    await session.withTransaction(async () => {
      // ⚠️ REMIS À ZÉRO : une transaction rejouée doublerait sinon les listes.
      ecrites = [];
      refusees = [];

      const precharge = {
        ...commun.prechargePoser,
        ...(await memoPose(Seance, etablissementId, anneeScolaire, session, AbsenceFormateur)),
      };

      for (const placement of proposition.placements) {
        const tache = parId.get(placement.tacheId);
        const creneau = creneauVersCase.get(placement.creneauId);
        if (!tache || !creneau) continue;

        const donnees = {
          jour: creneau.jour,
          seance: creneau.seance,
          periode: creneau.periode,
          formateurMatricule: tache.formateurMatricule,
          groupe: tache.groupeLibelle,
          module: tache.module,
          salle: placement.salle,
          statut: 'planifie',
        };
        /*
         * ⚠️ `verrou: false`, COMME LA GÉNÉRATION : ce placement traduit le
         *    chronogramme en grille, et n'ajoute que ce qui MANQUE au prévu. Le
         *    lui interdire au nom du chronogramme serait l'inverse de ce que le
         *    verrou protège ; le quota de la carte, lui, s'applique toujours.
         */
        const reglages = { session, precharge, verrou: false };

        try {
          await poser(etablissementId, anneeScolaire, normalisee, donnees, reglages);
          ecrites.push({ tache, creneau, salle: placement.salle, niveau: placement.niveau, placement });
        } catch (erreur) {
          if (placement.salle && placement.niveau !== NIVEAUX_PLACEMENT.SANS_SALLE && refusPourLaSeuleSalle(erreur)) {
            try {
              await poser(etablissementId, anneeScolaire, normalisee, { ...donnees, salle: '' }, reglages);
              ecrites.push({ tache, creneau, salle: '', niveau: NIVEAUX_PLACEMENT.SANS_SALLE, placement });
              continue;
            } catch (seconde) {
              refusees.push({ tache, erreur: seconde });
              continue;
            }
          }
          refusees.push({ tache, erreur });
        }
      }

      if (simulation) throw new FinDeSimulation();
    });
  } catch (erreur) {
    if (!(erreur instanceof FinDeSimulation)) throw erreur;
  } finally {
    await session.endSession();
  }

  for (const { tache, creneau, salle, niveau, placement } of ecrites) {
    placees.push({
      ...decrire(tache),
      jour: creneau.jour,
      seance: creneau.seance,
      salle,
      niveau,
      deconseille: placement.deconseille,
    });
  }

  /*
   * ⚠️ UN REFUS EST RENDU AVEC LE MOT DU SERVEUR : c'est lui qui sait pourquoi
   *    (quota de la carte atteint, rentrée…), et le taire ferait disparaître la
   *    séance de la liste sans explication.
   */
  for (const { tache, erreur } of refusees) {
    nonPlacees.push({
      ...decrire(tache),
      nombre: 1,
      raison: 'refusee',
      message: erreur.message,
    });
  }

  return resultat(normalisee, simulation, placees, nonPlacees);
}

function resultat(semaine, simulation, placees, nonPlacees) {
  const compter = (niveau) => placees.filter((p) => p.niveau === niveau).length;
  return {
    semaine,
    simulation,
    placees,
    nonPlacees,
    total: {
      placees: placees.length,
      libres: compter(NIVEAUX_PLACEMENT.LIBRE),
      aEviter: compter(NIVEAUX_PLACEMENT.A_EVITER),
      sansSalle: compter(NIVEAUX_PLACEMENT.SANS_SALLE),
      nonPlacees: nonPlacees.reduce((somme, n) => somme + (n.nombre ?? 1), 0),
    },
  };
}
