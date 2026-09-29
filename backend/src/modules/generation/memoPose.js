/**
 * Ce que `poser()` relit à chaque séance, et qui tient dans UNE lecture.
 *
 * ═══ ⚠️ MESURÉ AVANT D'ÊTRE ÉCRIT (2026-09-22) ═══
 * Une semaine réelle, 181 placements, **41 s** dont quatre paquets de ~8,5 s,
 * chacun valant 181 allers-retours vers la base (47 ms de latence mesurée) :
 * le quota du module, le conflit de créneau, la lecture d'absence, et
 * l'écriture. Ce module supprime les deux premiers — **362 requêtes remplacées
 * par une seule**.
 *
 * ═══ ⚠️⚠️ POURQUOI MÉMOÏSER N'AFFAIBLIT AUCUN CONTRÔLE ═══
 * Une transaction MongoDB travaille sur un **instantané** : deux lectures
 * identiques à l'intérieur rendent forcément la même réponse. Reposer la
 * question 181 fois ne la rend pas plus fraîche — cela coûte 181 allers-retours
 * pour un résultat qu'on connaît déjà. Ce qui change, en revanche, ce sont NOS
 * propres écritures : d'où `noter()`, appelé par `poser()` lui-même après
 * chaque pose, pour que le décompte suivant en tienne compte.
 *
 * ═══ ⚠️⚠️ UN MÉMO PAR SEMAINE, JAMAIS PAR GÉNÉRATION ═══
 * Il est construit DANS la transaction, après le `deleteMany`. Deux
 * conséquences, toutes deux voulues :
 *  · il voit la semaine déjà vidée, **EFM et rattrapages préservés compris** —
 *    et ceux-là consomment du quota. C'est précisément le piège de
 *    `filtrerSurQuota`, qui écarte la semaine visée EN ENTIER et sous-compterait
 *    donc les heures conservées ;
 *  · si la transaction d'une semaine échoue, son mémo meurt avec elle. Partagé
 *    entre semaines, il garderait des séances annulées et ferait refuser, la
 *    semaine suivante, des poses parfaitement valides.
 */

/** Les champs que `verifierQuota` et la détection de conflit consultent. */
const CHAMPS = 'semaine jour seance periode groupe module salle statut estEfm formateurMatricule';

const cleCreneau = (semaine, jour, seance, periode) =>
  `${semaine}||${jour}||${seance}||${periode ?? 'jour'}`;

/**
 * Charge l'année une fois et répond ensuite de mémoire.
 *
 * @param {import('mongoose').Model} Seance
 * @param {object} session — la transaction de l'appelant. **Obligatoire** :
 *   hors transaction, l'instantané n'existe pas et le mémo dirait n'importe quoi.
 */
/** La clé de `synchroniser()` : établissement · semaine · jour · créneau · formateur. */
const cleAbsence = (a) =>
  [a.etablissementId, a.semaine, a.jour, a.seance, a.formateurMatricule].map(String).join('|');

export async function memoPose(Seance, etablissementId, anneeScolaire, session, AbsenceFormateur = null) {
  const [toutes, absences] = await Promise.all([
    Seance.find({ etablissementId, anneeScolaire }).select(CHAMPS).session(session).lean(),
    /*
     * ═══ LES ABSENCES DE L'ANNÉE, LUES UNE FOIS (2026-09-28) ═══
     * `synchroniser()` demandait, à CHAQUE pose, s'il existe une absence sur
     * ce créneau : 190 allers-retours par semaine générée, ~10 s sur 24, pour
     * une réponse presque toujours « non ».
     *
     * ⚠️ AUCUN CONTRÔLE N'EST AFFAIBLI — même argument que le quota (m) : dans
     *    une transaction, 190 lectures voient le MÊME instantané qu'une seule.
     *    Le (l) du 2026-09-22 avait écarté ce hissage par crainte d'une
     *    fenêtre de concurrence ; elle n'existe pas DANS une transaction, et
     *    `synchroniser` tient la mémoire à jour de ce qu'il supprime ou crée.
     * ⚠️ LA CLÉ EST CELLE DE LA REQUÊTE D'ORIGINE, au caractère près
     *    (établissement · semaine · jour · créneau · formateur) — pas de
     *    `periode`, pas de normalisation : on répond exactement ce que
     *    `findOne(cle)` aurait répondu.
     * Facultatif : sans le modèle, rien n'est préchargé et `synchroniser`
     * interroge la base comme avant.
     */
    AbsenceFormateur
      ? AbsenceFormateur.find({ etablissementId, semaine: { $regex: `^${anneeScolaire}-W` } })
          .session(session)
      : [],
  ]);
  const parAbsence = new Map(absences.map((a) => [cleAbsence(a), a]));

  /** module → séances de l'année ; c'est le décompte du quota. */
  const parModule = new Map();
  /** (semaine, jour, séance, période) → séances ; c'est la détection de conflit. */
  const parCreneau = new Map();

  /**
   * La version actuellement rangée, par identifiant.
   *
   * ⚠️ INDISPENSABLE POUR RETIRER UNE SÉANCE DE SON ANCIENNE PLACE. Sans elle,
   *    `noter` calculait la clé sur la NOUVELLE séance : une séance déplacée du
   *    lundi au mardi restait rangée au lundi, et ce fantôme faisait refuser
   *    une pose parfaitement valide sur le créneau libéré.
   */
  const parId = new Map();

  const ranger = (seance) => {
    const module = String(seance.module ?? '');
    if (!parModule.has(module)) parModule.set(module, []);
    parModule.get(module).push(seance);

    const cle = cleCreneau(seance.semaine, seance.jour, seance.seance, seance.periode);
    if (!parCreneau.has(cle)) parCreneau.set(cle, []);
    parCreneau.get(cle).push(seance);

    const id = String(seance._id ?? seance.id ?? '');
    if (id) parId.set(id, seance);
  };

  /** Retire la version PRÉCÉDENTE — de ses propres listes, pas de celles de la nouvelle. */
  const retirer = (id) => {
    const ancienne = parId.get(id);
    if (!ancienne) return;

    const retirerDe = (liste) => {
      const rang = (liste ?? []).indexOf(ancienne);
      if (rang >= 0) liste.splice(rang, 1);
    };

    retirerDe(parModule.get(String(ancienne.module ?? '')));
    retirerDe(
      parCreneau.get(cleCreneau(ancienne.semaine, ancienne.jour, ancienne.seance, ancienne.periode))
    );
    parId.delete(id);
  };

  for (const seance of toutes) ranger(seance);

  return {
    /** Ce que `AbsenceFormateur.findOne(cle)` aurait rendu — `null` sinon. */
    obtenirAbsence(cle) {
      return AbsenceFormateur ? (parAbsence.get(cleAbsence(cle)) ?? null) : undefined;
    },

    /** Tenu à jour par `synchroniser()` : `null` = supprimée. */
    noterAbsence(cle, document) {
      if (!AbsenceFormateur) return;
      if (document) parAbsence.set(cleAbsence(cle), document);
      else parAbsence.delete(cleAbsence(cle));
    },

    obtenirSeancesDuModule(module) {
      return parModule.get(String(module ?? '')) ?? [];
    },

    obtenirSurLeCreneau(semaine, jour, seance, periode) {
      return parCreneau.get(cleCreneau(semaine, jour, seance, periode)) ?? [];
    },

    /**
     * ⚠️ APPELÉ PAR `poser()` APRÈS CHAQUE ÉCRITURE, pas par l'appelant.
     *    Laissé à l'appelant, il serait oublié un jour — et le quota
     *    sous-compterait en silence, laissant poser plus d'heures que la carte
     *    n'en accorde. C'est le genre de défaut qu'on ne voit qu'en mai.
     */
    noter(seance) {
      if (!seance) return;
      /*
       * ⚠️ UNE RÉÉCRITURE REMPLACE, elle ne s'ajoute pas : `poser()` est un
       *    upsert. Compter deux fois la même séance ferait refuser la suivante
       *    pour un quota qui n'est pas atteint.
       */
      const id = String(seance._id ?? seance.id ?? '');
      if (id) retirer(id);
      ranger(seance);
    },
  };
}
