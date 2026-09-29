import mongoose from 'mongoose';
import { PERIODES } from 'shared/constants';
import { joursVises, planDuJour, separerFusion, statutGlobal } from 'shared/domain';
import { Message } from '../../models/Message.js';
import { UnplacedSession } from '../../models/UnplacedSession.js';
import { HttpError, conflict, notFound } from '../../lib/httpError.js';
import { poser, vider } from '../seances/seances.service.js';
import { seancesDuFormateur } from './lectures.js';

/**
 * Propositions d'emploi du temps — côté DIRECTEUR (F10, Phase 9 b).
 * ← api/messaging/apply_proposition.php (515 l.), modes POST `apply` / `remove`
 *
 * ═══ CE QUI CHANGE PAR RAPPORT À L'EXISTANT ═══
 *  · TOUT OU RIEN. L'existant réécrivait le blob de la semaine sans rien
 *    vérifier : un groupe pouvait se retrouver à deux endroits au même moment.
 *    Ici chaque séance passe par `poser()` — affectation, rentrée, conflits de
 *    groupe, de salle et de formateur, quota, salles partagées — dans UNE
 *    transaction. Un seul refus annule tout le geste, et le refus est NOMMÉ.
 *  · « RETIRER » RESTAURE. L'existant vidait le jour, emportant aussi ce qui
 *    existait avant la proposition. On rejoue ici les séances sauvegardées.
 *  · L'ÉTAT EST ENREGISTRÉ, pas deviné en comparant la proposition à la grille.
 *
 * ⚠️ DIRECTEUR SEUL (décision du 2026-09-23) — contrôlé par la route ; ici on
 * vérifie en plus que la proposition lui a été ADRESSÉE et concerne
 * l'établissement actif.
 */

/** La proposition, si elle a été adressée à ce directeur pour cet établissement. */
async function charger(etablissementId, directeurId, id, session = null) {
  const message = await Message.findOne({
    _id: id,
    destinataireId: directeurId,
    'proposition.etablissementId': etablissementId,
  }).session(session);

  // ⚠️ 404 et non 403 : on ne confirme pas l'existence d'un message d'autrui.
  if (!message?.proposition) {
    throw notFound('Proposition introuvable', { code: 'PROPOSITION_INTROUVABLE' });
  }
  if (message.proposition.statut === 'remplacee') {
    throw conflict('Le formateur a envoyé une nouvelle proposition pour cette semaine', {
      code: 'PROPOSITION_REMPLACEE',
    });
  }
  return message;
}

/**
 * Applique un jour, ou toute la semaine.
 *
 * ⚠️ « Toute la semaine » n'applique que les jours PAS ENCORE appliqués : un
 * second clic réécrirait sinon, par-dessus les retouches du directeur, des jours
 * déjà validés — c'est exactement ce que faisait l'existant.
 */
export async function appliquer(etablissementId, directeurId, id, { jour } = {}) {
  return enTransaction(async (session) => {
    const message = await charger(etablissementId, directeurId, id, session);
    const p = message.proposition;

    const jours = joursVises(jour).filter((j) => p.jours[j] !== 'appliquee');
    if (jours.length === 0) {
      throw conflict(jour ? `Le ${jour} est déjà appliqué` : 'Toute la semaine est déjà appliquée', {
        code: 'DEJA_APPLIQUEE',
      });
    }

    let posees = 0;
    for (const j of jours) {
      const actuelles = await seancesDuFormateur(p.etablissementId, p.anneeScolaire, p.semaine, p.formateurMatricule, {
        jour: j,
        session,
      });
      const plan = planDuJour({ jour: j, cible: p.seances, actuelles });
      await executer(p, plan, j, session);
      posees += plan.aPoser.length;

      // Ce qui existait AVANT : la cible de « Retirer ». Les séances protégées restent en place.
      p.anciennes = [
        ...p.anciennes.filter((s) => s.jour !== j),
        ...[...plan.inchangees, ...plan.aVider].map(enSeance),
      ];
      p.jours[j] = 'appliquee';

      for (const seance of plan.aPoser) await reduireNonPlacees(p, seance, session);
    }

    await clore(message, directeurId, session);
    return { semaine: p.semaine, jours, posees, statut: p.statut };
  });
}

/** Retire un jour appliqué, ou tous — en RESTAURANT ce que l'application avait remplacé. */
export async function retirer(etablissementId, directeurId, id, { jour } = {}) {
  return enTransaction(async (session) => {
    const message = await charger(etablissementId, directeurId, id, session);
    const p = message.proposition;

    const jours = joursVises(jour).filter((j) => p.jours[j] === 'appliquee');
    if (jours.length === 0) {
      throw conflict(jour ? `Le ${jour} n’a pas été appliqué` : 'Aucun jour n’a été appliqué', {
        code: 'NON_APPLIQUEE',
      });
    }

    for (const j of jours) {
      const actuelles = await seancesDuFormateur(p.etablissementId, p.anneeScolaire, p.semaine, p.formateurMatricule, {
        jour: j,
        session,
      });
      const cible = p.anciennes.filter((s) => s.jour === j);
      await executer(p, planDuJour({ jour: j, cible, actuelles }), j, session);

      p.anciennes = p.anciennes.filter((s) => s.jour !== j);
      p.jours[j] = 'en_attente';
    }

    await clore(message, directeurId, session);
    return { semaine: p.semaine, jours, statut: p.statut };
  });
}

/**
 * Refuse ce qui n'est pas appliqué. Les jours déjà appliqués le restent : les
 * défaire est le rôle de « Retirer », qui restaure.
 */
export async function refuser(etablissementId, directeurId, id) {
  const message = await charger(etablissementId, directeurId, id);
  const p = message.proposition;

  const jours = joursVises().filter((j) => p.jours[j] === 'en_attente');
  if (jours.length === 0) {
    throw conflict('Il ne reste rien à refuser dans cette proposition', { code: 'RIEN_A_REFUSER' });
  }

  for (const j of jours) p.jours[j] = 'refusee';
  await clore(message, directeurId);
  return { semaine: p.semaine, jours, statut: p.statut };
}

/**
 * Vide puis pose, dans cet ordre : poser d'abord ferait heurter le formateur à
 * sa propre séance encore en place sur le créneau.
 *
 * ⚠️ UN REFUS DE `poser()` EST REFORMULÉ AVEC SON JOUR ET SON CRÉNEAU : « ce
 * créneau est déjà occupé » ne dirait pas lequel, sur une semaine de 24 cases.
 */
async function executer(p, plan, jour, session) {
  if (plan.bloquantes.length > 0) {
    throw conflict(plan.bloquantes[0].message, { code: 'CRENEAU_PROTEGE', details: plan.bloquantes });
  }

  const creneau = (seance) => ({
    jour,
    seance: seance.seance,
    periode: PERIODES.JOUR,
    formateurMatricule: p.formateurMatricule,
  });

  for (const seance of plan.aVider) {
    await vider(p.etablissementId, p.anneeScolaire, p.semaine, creneau(seance), { session });
  }

  for (const seance of plan.aPoser) {
    try {
      await poser(
        p.etablissementId,
        p.anneeScolaire,
        p.semaine,
        { ...creneau(seance), groupe: seance.groupe, module: seance.module, salle: seance.salle ?? '', statut: 'planifie' },
        { session }
      );
    } catch (erreur) {
      if (!(erreur instanceof HttpError)) throw erreur;
      const lieu = `${jour} ${seance.seance} (${seance.groupe})`;
      throw new HttpError(erreur.status, `${lieu} : ${erreur.message}`, {
        code: erreur.code,
        details: (erreur.details ?? [{ message: erreur.message }]).map((d) => ({
          ...d,
          jour,
          seance: seance.seance,
        })),
      });
    }
  }
}

/**
 * Une séance posée compte pour une séance « non placée » de la génération.
 * ← le `DELETE FROM unplaced_sessions` de apply_proposition.php
 *
 * ⚠️ ON DÉCOMPTE, ON NE SUPPRIME PAS : l'existant effaçait toute la ligne dès
 * la première séance posée, même s'il en manquait trois. Une fusion (« GM101
 * GM102 ») est cherchée sous son libellé comme sous chacun de ses membres.
 */
async function reduireNonPlacees(p, seance, session) {
  const groupes = [seance.groupe, ...separerFusion(seance.groupe)];
  const filtre = {
    etablissementId: p.etablissementId,
    semaine: p.semaine,
    module: seance.module,
    groupe: { $in: groupes },
  };
  await UnplacedSession.updateMany({ ...filtre, manquantes: { $gt: 0 } }, { $inc: { manquantes: -1 } }, { session });
  await UnplacedSession.deleteMany({ ...filtre, manquantes: { $lte: 0 } }, { session });
}

async function clore(message, directeurId, session = null) {
  const p = message.proposition;
  p.statut = statutGlobal(p.jours);
  p.traiteePar = directeurId;
  p.traiteeLe = new Date();
  message.markModified('proposition');
  await message.save({ session });
}

const enSeance = ({ jour, seance, groupe, module, salle }) => ({ jour, seance, groupe, module, salle: salle ?? '' });

/**
 * ⚠️ `withTransaction` PEUT REJOUER le rappel sur une erreur transitoire : tout
 * y est relu DEPUIS la base, rien n'est tenu d'un essai à l'autre.
 */
async function enTransaction(travail) {
  const session = await mongoose.startSession();
  try {
    let resultat;
    await session.withTransaction(async () => {
      resultat = await travail(session);
    });
    return resultat;
  } finally {
    await session.endSession();
  }
}
