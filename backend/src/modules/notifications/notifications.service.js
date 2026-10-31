import { libelleSemaine, normaliserValeurSemaine } from 'shared/domain';
import { bus, EVENEMENTS } from '../../lib/bus.js';
import { logger } from '../../lib/logger.js';
import { User } from '../../models/User.js';
import { estPubliee } from '../seances/seances.service.js';

/**
 * ═══ LES NOTIFICATIONS (2026-10-31, demande du porteur : « des notifications lors de la
 * publication et du changement de l'emploi, d'une annonce ou d'un message de messagerie, en
 * toutes sessions ») ═══
 *
 * Le serveur temps réel remet chaque notification aux sessions OUVERTES de ses destinataires
 * (`type: 'notification'`) : l'écran la montre, et en notification du système quand la fenêtre
 * est en arrière-plan — Windows, Android, ou le navigateur.
 *
 * ⚠️ JAMAIS BLOQUANT : une notification se calcule APRÈS l'écriture réussie, sans être
 *    attendue, et son échec n'est que journalisé. Un message part, qu'on le notifie ou non.
 * ⚠️ PAS DE NOTIFICATION « HORS LIGNE » : une session fermée (application quittée) ne reçoit
 *    rien ; elle retrouvera le message dans sa boîte, l'emploi à sa prochaine ouverture.
 *
 * @typedef {{ genre: 'message'|'annonce'|'emploi', titre: string, corps?: string, lien?: string }} Notification
 */

/** Remet `notification` aux sessions ouvertes de ces utilisateurs. */
export function notifier(utilisateurIds, notification) {
  const ids = [...new Set((utilisateurIds ?? []).map(String))];
  if (ids.length === 0) return;
  bus.emit(EVENEMENTS.NOTIFICATION, { utilisateurIds: ids, notification });
}

/**
 * Toutes les personnes de l'établissement — direction, gestion, formateurs, stagiaires —, sauf
 * `sauf` (l'auteur du geste : il sait déjà).
 */
export async function notifierEtablissement(etablissementId, notification, { sauf = null } = {}) {
  const comptes = await User.find({ etablissementIds: etablissementId, estActif: true }).select('_id').lean();
  notifier(
    comptes.map((compte) => String(compte._id)).filter((id) => id !== String(sauf ?? '')),
    notification
  );
}

/** « semaine S8 » — ou la valeur brute si elle ne se lit pas. */
function nomDeSemaine(valeur) {
  try {
    return `semaine ${libelleSemaine(normaliserValeurSemaine(valeur) ?? valeur, { court: true })}`;
  } catch {
    return `semaine ${String(valeur ?? '')}`;
  }
}

/** Une semaine vient d'être publiée : tout l'établissement est prévenu. */
export function notifierPublication(etablissementId, semaine, auteurId) {
  notifierEtablissement(
    etablissementId,
    {
      genre: 'emploi',
      titre: 'Emploi du temps publié',
      corps: `L’emploi du temps de la ${nomDeSemaine(semaine)} est disponible.`,
      lien: '/app/emploi',
    },
    { sauf: auteurId }
  ).catch((erreur) => logger.warn({ err: erreur }, 'Notification de publication non envoyée'));
}

/*
 * ═══ UN EMPLOI DÉJÀ PUBLIÉ QUI CHANGE ═══ Chaque séance posée, déplacée ou retirée annonce une
 * modification : notifier à chacune enverrait vingt notifications pour une matinée de
 * retouches. Elles sont REGROUPÉES par établissement et par semaine : une seule part, deux
 * minutes après la dernière retouche — et seulement si la semaine est publiée (une semaine en
 * préparation ne regarde encore personne).
 */
export const DELAI_REGROUPEMENT_MS = 2 * 60 * 1000;
const enAttente = new Map();

export function noterChangementEmploi(etablissementId, anneeScolaire, semaine, auteurId) {
  const valeur = normaliserValeurSemaine(semaine);
  if (!etablissementId || !valeur) return;
  const cle = `${etablissementId}|${anneeScolaire}|${valeur}`;
  const precedent = enAttente.get(cle);
  if (precedent) clearTimeout(precedent.minuterie);
  const auteurs = new Set(precedent?.auteurs ?? []);
  if (auteurId) auteurs.add(String(auteurId));

  const minuterie = setTimeout(async () => {
    enAttente.delete(cle);
    try {
      if (!(await estPubliee(etablissementId, anneeScolaire, valeur))) return;
      const comptes = await User.find({ etablissementIds: etablissementId, estActif: true }).select('_id').lean();
      notifier(
        comptes.map((compte) => String(compte._id)).filter((id) => !auteurs.has(id)),
        {
          genre: 'emploi',
          titre: 'Emploi du temps modifié',
          corps: `L’emploi du temps de la ${nomDeSemaine(valeur)} a changé.`,
          lien: '/app/emploi',
        }
      );
    } catch (erreur) {
      logger.warn({ err: erreur }, 'Notification de changement d’emploi non envoyée');
    }
  }, DELAI_REGROUPEMENT_MS);
  // Le processus peut s'arrêter sans attendre une notification en suspens (tests, redémarrage).
  minuterie.unref?.();
  enAttente.set(cle, { minuterie, auteurs });
}

/** Un message — ou une annonce, qui part par la messagerie — vient d'arriver. */
export function notifierMessage(destinataireIds, { expediteurNom, sujet, annonce = false }) {
  notifier(destinataireIds, {
    genre: annonce ? 'annonce' : 'message',
    titre: annonce ? `Annonce — ${expediteurNom}` : `Message de ${expediteurNom}`,
    corps: String(sujet ?? '').slice(0, 160),
    lien: '/app/messagerie',
  });
}
