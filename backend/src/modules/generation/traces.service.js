import { PERIODES } from 'shared/constants';
import { typeDeSeance } from 'shared/domain';

import { AutoGenConfig } from '../../models/AutoGenConfig.js';
import { Seance } from '../../models/Seance.js';
import { CAUSES_FIGEAGE, STATUTS_TRACE, TraceGeneration } from '../../models/TraceGeneration.js';
import { logger } from '../../lib/logger.js';
import { ecartGrille } from './ecart.js';
import { nouveauSel, pseudonyme, pseudonymiserTrace } from './pseudonyme.js';

/**
 * Le corpus d'entraînement de la génération automatique (F6 · étape d).
 *
 * ═══ CE QU'ON GARDE, ET POURQUOI ═══ Le problème soumis (avec sa graine, donc
 * rejouable), la solution rendue, et la grille telle qu'elle est une fois que
 * l'humain n'y touche plus. Les deux premiers n'apprennent qu'à IMITER le
 * glouton ; c'est le troisième, confronté au second, qui dit où il se trompe.
 *
 * ⚠️ RIEN ICI NE DOIT FAIRE ÉCHOUER UNE GÉNÉRATION. Une trace perdue coûte une
 *    ligne de corpus ; une génération annulée coûte une semaine de travail. Les
 *    appelants passent donc par `sansFaireEchouer` — la règle
 *    d'`annoncerModification` du temps réel, pour la même raison.
 */

/**
 * ⚠️ LE REPLI, PAS LA RÈGLE (décision du porteur, 2026-09-21). Une semaine
 *    PUBLIÉE est figée sur-le-champ : publier dit déjà « cette grille fait
 *    foi ». Mais toutes les semaines ne sont pas publiées — la publication sert
 *    surtout à montrer une semaine en AVANCE — et sans ce délai, celles-là ne
 *    rejoindraient jamais le corpus.
 */
export const DELAI_FIGEAGE_JOURS = 14;

/**
 * Le sel de l'établissement, tiré au premier besoin.
 *
 * ⚠️ `select('+selTraces')` EST INDISPENSABLE : le champ est `select: false`
 *    dans le modèle, précisément pour qu'aucune lecture ne l'emporte par
 *    mégarde. L'oublier rendrait `undefined`, ferait tirer un sel neuf à chaque
 *    génération, et les pseudonymes cesseraient d'être stables d'une semaine à
 *    l'autre — ce qui fait toute la valeur du corpus.
 */
async function selDe(etablissementId, anneeScolaire) {
  const config = await AutoGenConfig.findOne({ etablissementId, anneeScolaire })
    .select('+selTraces')
    .lean();

  if (config?.selTraces) return config.selTraces;

  const sel = nouveauSel();
  await AutoGenConfig.updateOne(
    { etablissementId, anneeScolaire },
    { $set: { selTraces: sel } },
    { upsert: true }
  );
  return sel;
}

/** Les séances que la génération avait le droit de remplacer. */
const remplacable = (seance) =>
  (seance.periode ?? PERIODES.JOUR) === PERIODES.JOUR &&
  !seance.estEfm &&
  !seance.rattrapageDe;

/**
 * La grille d'une semaine, rattachée aux tâches du problème et pseudonymisée.
 *
 * ⚠️ LES SÉANCES PRÉSERVÉES SONT ÉCARTÉES — EFM et rattrapages. Elles n'ont
 *    jamais été proposées au solveur (elles occupaient déjà leurs créneaux) :
 *    les compter reviendrait à lui reprocher des séances « ajoutées » qu'on ne
 *    lui avait pas demandé de placer.
 */
function grilleRetenue(seances, taches, sel) {
  /* (groupe, module, formateur) → les tâches candidates. */
  const parTriplet = new Map();
  for (const tache of taches) {
    const cle = `${tache.groupe}||${tache.module}||${tache.formateur}`;
    if (!parTriplet.has(cle)) parTriplet.set(cle, []);
    parTriplet.get(cle).push(tache);
  }

  const retenue = [];
  for (const seance of seances.filter(remplacable)) {
    const cle = [
      pseudonyme(sel, 'groupe', seance.groupe),
      seance.module,
      pseudonyme(sel, 'formateur', seance.formateurMatricule),
    ].join('||');

    const candidates = parTriplet.get(cle) ?? [];

    /*
     * Une séance qu'aucune tâche ne décrit : posée à la main sur un module que
     * le chronogramme ne prévoyait pas cette semaine-là. Elle compte comme
     * AJOUTÉE — et c'est bien ce qu'elle est.
     */
    let tacheId = cle;

    if (candidates.length > 0) {
      /*
       * ⚠️ PLUSIEURS TÂCHES POUR UN MÊME TRIPLET : le même formateur donne le
       *    même module au même groupe en présentiel ET à distance. On tranche
       *    par la SALLE, avec `typeDeSeance` — la règle du projet, jamais une
       *    seconde écrite ici.
       */
      const type = typeDeSeance(seance);
      tacheId = (candidates.find((c) => c.type === type) ?? candidates[0]).id;
    }

    retenue.push({
      tacheId,
      jour: seance.jour,
      seance: seance.seance,
      salle: pseudonyme(sel, 'salle', seance.salle),
    });
  }
  return retenue;
}

/**
 * Enregistre une génération de semaine.
 *
 * ⚠️ LES TRACES PRÉCÉDENTES ENCORE « EN COURS » PASSENT À « REJETÉE » : le
 *    directeur a généré, n'a pas aimé, a relancé. Une grille jetée en bloc dit
 *    ce qu'il NE VEUT PAS — la perdre reviendrait à ne garder que les réussites
 *    (décision du porteur, 2026-09-21). Une trace déjà FIGÉE, elle, ne bouge
 *    plus : elle a bel et bien fait foi pendant un temps.
 */
export async function enregistrer({
  etablissementId,
  anneeScolaire,
  semaine,
  lanceePar = null,
  graine = null,
  assouplissement = {},
  compositionsFq = 0,
  probleme,
  taches,
  solution,
  resultat = {},
}) {
  const sel = await selDe(etablissementId, anneeScolaire);
  const anonyme = pseudonymiserTrace(sel, { probleme, taches, solution });

  await TraceGeneration.updateMany(
    { etablissementId, anneeScolaire, semaine, statut: STATUTS_TRACE.EN_COURS },
    { $set: { statut: STATUTS_TRACE.REJETEE } }
  );

  const rapport = solution.rapport ?? {};
  return TraceGeneration.create({
    etablissementId,
    anneeScolaire,
    semaine,
    lanceePar,
    lanceeLe: new Date(),
    /* Le moteur se déclare lui-même dans son rapport ; on ne le devine pas. */
    moteur: rapport.moteur ?? 'inconnu',
    versionMoteur: rapport.version ?? '',
    graine,
    assouplissement,
    compositionsFq,
    probleme: anonyme.probleme,
    taches: anonyme.taches,
    solution: anonyme.solution,
    resultat,
  });
}

/** Fige une trace sur l'état actuel de sa semaine. */
async function figer(trace, cause) {
  const sel = await selDe(trace.etablissementId, trace.anneeScolaire);

  const seances = await Seance.find({
    etablissementId: trace.etablissementId,
    anneeScolaire: trace.anneeScolaire,
    semaine: trace.semaine,
  })
    .select('jour seance periode formateurMatricule groupe module salle estEfm rattrapageDe')
    .lean();

  const grille = grilleRetenue(seances, trace.taches ?? [], sel);
  const ecart = ecartGrille({
    creneaux: trace.probleme?.creneaux ?? [],
    placements: trace.solution?.placements ?? [],
    seances: grille,
  });

  /*
   * ⚠️ LE FILTRE PORTE ENCORE SUR « EN COURS » : deux figeages concurrents —
   *    une publication et un balayage — ne doivent pas écrire deux fois, et le
   *    second trouverait une trace déjà figée.
   */
  await TraceGeneration.updateOne(
    { _id: trace._id, statut: STATUTS_TRACE.EN_COURS },
    {
      $set: {
        statut: STATUTS_TRACE.RETENUE,
        figeeLe: new Date(),
        causeFigeage: cause,
        grilleRetenue: grille,
        ecart,
      },
    }
  );
  return ecart;
}

/**
 * La semaine vient d'être publiée : sa grille fait foi.
 *
 * ⚠️ APPELÉ APRÈS `publier`, jamais dedans : une trace qui échoue ne doit pas
 *    empêcher une publication.
 */
export async function figerParPublication(etablissementId, anneeScolaire, semaine) {
  const traces = await TraceGeneration.find({
    etablissementId,
    anneeScolaire,
    semaine,
    statut: STATUTS_TRACE.EN_COURS,
  }).lean();

  for (const trace of traces) await figer(trace, CAUSES_FIGEAGE.PUBLICATION);
  return traces.length;
}

/**
 * Le repli : fige ce que personne n'a publié depuis assez longtemps.
 *
 * ⚠️ UN BALAYAGE PARESSEUX, PAS UNE TÂCHE PLANIFIÉE. Ce projet n'a aucun
 *    exécuteur de tâches, et en introduire un pour cela seul serait une
 *    infrastructure à héberger pour une requête indexée. Conséquence assumée :
 *    si personne ne génère ni ne publie pendant un mois, les traces sont figées
 *    au passage suivant — sur un état encore plus stabilisé, et `figeeLe` dit
 *    la date réelle.
 */
export async function balayer(etablissementId, anneeScolaire) {
  const limite = new Date(Date.now() - DELAI_FIGEAGE_JOURS * 24 * 60 * 60 * 1000);
  const traces = await TraceGeneration.find({
    etablissementId,
    anneeScolaire,
    statut: STATUTS_TRACE.EN_COURS,
    lanceeLe: { $lte: limite },
  }).lean();

  for (const trace of traces) await figer(trace, CAUSES_FIGEAGE.DELAI);
  return traces.length;
}

/** Enveloppe : une trace ne fait jamais échouer ce qui l'a déclenchée. */
export function sansFaireEchouer(promesse, contexte) {
  return Promise.resolve(promesse).catch((erreur) => {
    logger.warn({ err: erreur, ...contexte }, 'trace de génération non enregistrée');
    return null;
  });
}
