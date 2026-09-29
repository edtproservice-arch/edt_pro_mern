/**
 * Enregistrer un stage, une formation de formateur ou des vacances SUPPRIME ce
 * que la nouvelle période rend impossible (2026-09-23, demande du porteur).
 *
 * ═══ CE QUI PART ═══
 *   - emploi du temps : les séances dont le JOUR vient de fermer — pour le
 *     groupe (stage), le formateur (formation) ou tout l'établissement
 *     (vacances). Surveillances d'EFM et rattrapages compris : un rattrapage
 *     supprimé rend son absence « à rattraper » (`effacer`).
 *   - chronogramme : les cellules dont la SEMAINE est désormais entièrement
 *     fermée pour leur ligne. Une semaine amputée garde ses heures.
 *   - les cours supprimés passent en « séances non placées », pour être
 *     replacés.
 *
 * ═══ ⚠️ JAMAIS SANS UN OUI EXPLICITE ═══
 * Même règle que le retrait d'un groupe (décision du 2026-09-22) : si quelque
 * chose partirait, le serveur refuse en 409 avec les CHIFFRES, n'écrit rien, et
 * attend `confirmerSuppressions`. Une date mal tapée ne doit pas effacer un
 * mois d'emploi du temps sans que personne l'ait lu.
 *
 * ═══ ⚠️ UN FICHIER À PART, POUR NE PAS FERMER UN CYCLE ═══
 * `chronogramme.service` importe déjà `calendrier.service` ; poser la cascade
 * dans ce dernier aurait bouclé les imports.
 */

import mongoose from 'mongoose';
import {
  anneeScolaire as anneeScolaireDe,
  cellulesNouvellementFermees,
  dateDuJour,
  enJour,
  fusionnerVacances,
  motifDeSuppression,
  nonPlaceesDesSeances,
  nouvellesFermetures,
  resumeVide,
  resumerSuppressions,
} from 'shared/domain';
import { Base } from '../../models/Base.js';
import { Chronogramme } from '../../models/Chronogramme.js';
import { Etablissement } from '../../models/Etablissement.js';
import { Seance } from '../../models/Seance.js';
import { UnplacedSession } from '../../models/UnplacedSession.js';
import { HttpError, notFound } from '../../lib/httpError.js';
import { conditionVersion, versionPerimee } from '../../lib/versionOptimiste.js';
import { joursFeries as joursFeriesEtablissement } from '../calendrier/calendrier.service.js';
import { obtenir as calendrierNational } from '../calendrierNational/calendrierNational.service.js';
import { fermeturesDesLignes } from '../chronogramme/chronogramme.service.js';
import { effacer } from '../seances/seances.service.js';

const UN_JOUR = 24 * 60 * 60 * 1000;

/** Le code que l'écran reconnaît pour ouvrir la confirmation. */
export const CODE_CONFIRMATION = 'PERIODES_SUPPRESSIONS';

/**
 * Remplace des champs de l'établissement — `stages`, `formations` ou le
 * calendrier — en appliquant la cascade.
 *
 * @param {object} options
 * @param {number} options.anneeScolaire  celle de la page (vacances nationales)
 * @param {Record<string, unknown>} options.$set  chemins Mongo → valeur
 * @param {string} options.cheminVersion  « versions.stages », « versions.calendrier »…
 * @param {number} [options.version]
 * @param {boolean} [options.confirmerSuppressions]  faux par défaut — tout le garde-fou
 * @returns {Promise<{etablissement: object, cascade: object|null}>}
 */
export async function enregistrerAvecCascade(
  etablissementId,
  { anneeScolaire, $set, cheminVersion, version, confirmerSuppressions = false }
) {
  const contextes = memoContextes(etablissementId);
  const session = await mongoose.startSession();

  try {
    let resultat;

    await session.withTransaction(async () => {
      const courant = await Etablissement.findOne({
        _id: etablissementId,
        ...conditionVersion(cheminVersion, version),
      })
        .select('calendrier stages formations')
        .session(session)
        .lean();

      if (!courant) {
        if (!(await Etablissement.exists({ _id: etablissementId }).session(session))) {
          throw notFound('Établissement introuvable', { code: 'ETABLISSEMENT_INCONNU' });
        }
        throw versionPerimee();
      }

      const suivant = appliquer(courant, $set);
      const plan = await planifier(etablissementId, anneeScolaire, courant, suivant, contextes, session);

      if (plan && !resumeVide(plan.resume) && !confirmerSuppressions) {
        /*
         * ⚠️ 409 ET NON 400 : un conflit avec l'état existant, pas une requête
         * mal formée. Le code le distingue de la version périmée ; `details`
         * porte les chiffres sur lesquels le directeur décide. Rien n'est écrit.
         */
        throw new HttpError(409, 'Cette période supprime des séances déjà planifiées', {
          code: CODE_CONFIRMATION,
          details: plan.resume,
        });
      }

      const etablissement = await Etablissement.findOneAndUpdate(
        { _id: etablissementId, ...conditionVersion(cheminVersion, version) },
        { $set, $inc: { [cheminVersion]: 1 } },
        { new: true, runValidators: true, session }
      );
      if (!etablissement) throw versionPerimee();

      const cascade = plan && !resumeVide(plan.resume) ? await executer(etablissementId, plan, session) : null;
      resultat = { etablissement, cascade };
    });

    return resultat;
  } finally {
    await session.endSession();
  }
}

/** L'établissement tel qu'il sera après `$set` — seuls les trois champs lus comptent. */
function appliquer(courant, $set) {
  const suivant = {
    stages: courant.stages ?? [],
    formations: courant.formations ?? [],
    calendrier: { ...(courant.calendrier ?? {}) },
  };

  for (const [chemin, valeur] of Object.entries($set)) {
    if (chemin === 'stages' || chemin === 'formations') suivant[chemin] = valeur;
    else if (chemin.startsWith('calendrier.')) suivant.calendrier[chemin.slice('calendrier.'.length)] = valeur;
  }
  return suivant;
}

/**
 * Fériés, calendrier national et base d'une année — lus HORS transaction et une
 * seule fois : ils ne dépendent pas de ce qu'on enregistre, et le calendrier
 * national peut interroger un service externe.
 */
function memoContextes(etablissementId) {
  const memo = new Map();

  return (annee) => {
    if (!memo.has(annee)) {
      memo.set(
        annee,
        Promise.all([
          joursFeriesEtablissement(etablissementId, annee),
          calendrierNational(annee),
          Base.findOne({ etablissementId, anneeScolaire: annee }).lean(),
        ]).then(([feries, national, base]) => ({
          joursFeries: feries.joursFeries ?? [],
          national,
          base,
        }))
      );
    }
    return memo.get(annee);
  };
}

/** Vacances réelles : réseau − écartées + celles de l'établissement (cf. chronogramme). */
const vacancesEffectives = (national, etablissement) =>
  fusionnerVacances(
    national?.vacances ?? [],
    etablissement.calendrier?.vacances ?? [],
    etablissement.calendrier?.vacancesEcartees ?? []
  );

const anneeDuJour = (jour) => anneeScolaireDe(new Date(`${jour}T12:00:00`));

/**
 * Tout ce que le passage `avant` → `apres` détruirait. `null` si rien ne ferme.
 */
async function planifier(etablissementId, anneeScolaire, avant, apres, contextes, session) {
  /*
   * ⚠️ LES VACANCES NATIONALES DÉPENDENT DE L'ANNÉE. On lit celle de la page,
   * puis celles des jours que les périodes propres touchent : une période
   * déclarée pour l'an prochain se compare au réseau de l'an prochain.
   */
  const brouillon = nouvellesFermetures(
    { vacances: avant.calendrier?.vacances, stages: avant.stages, formations: avant.formations },
    { vacances: apres.calendrier?.vacances, stages: apres.stages, formations: apres.formations }
  );
  const annees = new Set([anneeScolaire, ...brouillon.jours.map(anneeDuJour)]);

  const vacancesAvant = [];
  const vacancesApres = [];
  for (const annee of annees) {
    const { national } = await contextes(annee);
    vacancesAvant.push(...vacancesEffectives(national, avant));
    vacancesApres.push(...vacancesEffectives(national, apres));
  }

  const fermetures = nouvellesFermetures(
    { vacances: vacancesAvant, stages: avant.stages, formations: avant.formations },
    { vacances: vacancesApres, stages: apres.stages, formations: apres.formations }
  );
  if (fermetures.vide) return null;

  const seances = await seancesTouchees(etablissementId, fermetures, session);
  const cellules = await cellulesTouchees(etablissementId, fermetures, avant, apres, contextes, session);

  return { seances, cellules, resume: resumerSuppressions(seances, cellules) };
}

/**
 * Les séances posées sur un jour qui vient de fermer.
 *
 * ⚠️ TOUTES ANNÉES SCOLAIRES CONFONDUES : une période appartient à
 * l'établissement, pas à une année — un stage saisi pour octobre prochain vise
 * les séances de l'an prochain.
 *
 * ⚠️ LE JOUR SE RELIT DANS (semaine, jour), pas dans `date` : une `Date` à
 * minuit relue dans un autre fuseau rend la veille. `date` ne sert qu'à borner
 * la requête, avec un jour de marge de chaque côté.
 */
async function seancesTouchees(etablissementId, fermetures, session) {
  const premier = new Date(`${fermetures.jours[0]}T12:00:00`).getTime() - 2 * UN_JOUR;
  const dernier = new Date(`${fermetures.jours.at(-1)}T12:00:00`).getTime() + 2 * UN_JOUR;

  const candidates = await Seance.find({
    etablissementId,
    date: { $gte: new Date(premier), $lte: new Date(dernier) },
  })
    .select('anneeScolaire semaine jour groupe module formateurMatricule statut estEfm rattrapageDe')
    .session(session)
    .lean();

  return candidates
    .map((seance) => ({
      ...seance,
      motif: motifDeSuppression(seance, enJour(dateDuJour(seance.semaine, seance.jour)), fermetures),
    }))
    .filter((seance) => seance.motif !== null);
}

/** Les cellules de chronogramme dont la semaine vient de se fermer, toutes années touchées. */
async function cellulesTouchees(etablissementId, fermetures, avant, apres, contextes, session) {
  const cellules = [];

  for (const annee of new Set(fermetures.jours.map(anneeDuJour))) {
    const chronogrammes = await Chronogramme.find({ etablissementId, anneeScolaire: annee })
      .select('groupe planning')
      .session(session)
      .lean();
    if (chronogrammes.length === 0) continue;

    const { joursFeries, national, base } = await contextes(annee);
    const commun = { anneeScolaire: annee, joursFeries, rentrees: national?.rentrees ?? [] };

    for (const chronogramme of chronogrammes) {
      const fermeesAvant = fermeturesDesLignes(base, chronogramme.groupe, {
        ...commun,
        vacances: vacancesEffectives(national, avant),
        stages: avant.stages,
        formations: avant.formations,
      });
      const fermeesApres = fermeturesDesLignes(base, chronogramme.groupe, {
        ...commun,
        vacances: vacancesEffectives(national, apres),
        stages: apres.stages,
        formations: apres.formations,
      });

      for (const cellule of cellulesNouvellementFermees(chronogramme.planning, fermeesAvant, fermeesApres)) {
        cellules.push({ ...cellule, groupe: chronogramme.groupe, chronogrammeId: chronogramme._id });
      }
    }
  }

  return cellules;
}

/**
 * Exécute la cascade. **Dans la transaction de l'enregistrement** : un échec au
 * milieu laisserait une période enregistrée et des séances à moitié effacées.
 */
async function executer(etablissementId, plan, session) {
  /*
   * ⚠️ LES NON PLACÉES D'ABORD, depuis la liste lue — `effacer` ne rend qu'un
   * nombre. On INCRÉMENTE : une ligne laissée par la génération garde son total,
   * seul le manque grandit.
   */
  for (const ligne of nonPlaceesDesSeances(plan.seances)) {
    await UnplacedSession.updateOne(
      { etablissementId, semaine: ligne.semaine, groupe: ligne.groupe, module: ligne.module },
      {
        $inc: { manquantes: ligne.nombre },
        $setOnInsert: {
          anneeScolaire: ligne.anneeScolaire,
          formateurMatricule: ligne.formateurMatricule,
          total: ligne.nombre,
        },
      },
      { upsert: true, session }
    );
  }

  /*
   * ⚠️ PAR `effacer`, PAS `deleteMany` : il reprend les absences de ces séances
   * et rend « à rattraper » les absences dont elles étaient le rattrapage —
   * heures du chronogramme comprises. AVANT le chronogramme, pour que la
   * suppression des cellules s'applique à l'état qui en résulte.
   */
  const seances =
    plan.seances.length > 0
      ? await effacer({ etablissementId, _id: { $in: plan.seances.map((seance) => seance._id) } }, session)
      : 0;

  const heures = await viderCellules(plan.cellules, session);

  return { ...plan.resume, seances, heures };
}

/** Retire les cellules, un chronogramme à la fois ; rend les heures réellement retirées. */
async function viderCellules(cellules, session) {
  const parChronogramme = new Map();
  for (const cellule of cellules) {
    const cle = String(cellule.chronogrammeId);
    if (!parChronogramme.has(cle)) parChronogramme.set(cle, []);
    parChronogramme.get(cle).push(cellule);
  }

  let heures = 0;

  for (const [id, liste] of parChronogramme) {
    const document = await Chronogramme.findById(id).session(session);
    if (!document) continue;

    for (const [module, semaines] of groupesParModule(liste)) {
      const actuelles = document.planning.get(module) ?? [];
      const gardees = actuelles.filter((cellule) => !semaines.has(cellule.semaine));
      for (const retiree of actuelles) if (semaines.has(retiree.semaine)) heures += Number(retiree.heures) || 0;

      if (gardees.length > 0) document.planning.set(module, gardees);
      else document.planning.delete(module);
    }

    // ⚠️ La version avance : un écran ouvert sur ce planning doit se recharger,
    // pas réécrire les heures qu'on vient d'ôter.
    document.version = (document.version ?? 0) + 1;
    await document.save({ session });
  }

  return heures;
}

function groupesParModule(cellules) {
  const parModule = new Map();
  for (const cellule of cellules) {
    if (!parModule.has(cellule.module)) parModule.set(cellule.module, new Set());
    parModule.get(cellule.module).add(cellule.semaine);
  }
  return parModule;
}
