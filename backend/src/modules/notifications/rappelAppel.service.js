import { ROLES } from "shared/constants";
import { enMinutes, horairesCourants } from "shared/domain";
import { AppelValidation } from "../../models/AppelValidation.js";
import { Etablissement } from "../../models/Etablissement.js";
import { HorairesSeances } from "../../models/HorairesSeances.js";
import { Seance } from "../../models/Seance.js";
import { User } from "../../models/User.js";
import { logger } from "../../lib/logger.js";
import { estPubliee } from "../seances/seances.service.js";
import { notifier } from "./notifications.service.js";

/**
 * ═══ RAPPEL D'APPEL AU FORMATEUR (2026-11-03, demande du porteur : « une notification 30 min
 * avant la fin de la séance pour le formateur, pour saisir l'absence ») ═══
 *
 * Toutes les 5 minutes, les séances du jour dont la fin tombe dans 30 minutes au plus : leur
 * formateur reçoit une notification (écran ouvert, Windows, Android, navigateur) qui mène aux
 * absences.
 *
 * ⚠️ PAS DE RAPPEL INUTILE : semaine non publiée, formateur absent, surveillance d'EFM, démo,
 *    ou appel DÉJÀ VALIDÉ pour ce cours — rien ne part.
 * ⚠️ UNE FOIS PAR FORMATEUR ET PAR CRÉNEAU : les groupes d'une fusion font un seul rappel, et la
 *    fenêtre de 30 minutes, revue toutes les 5, ne le double pas (mémoire du jour). Un serveur
 *    redémarré dans la fenêtre peut le renvoyer une fois — c'est sans gravité.
 * ⚠️ L'HEURE DU MAROC, quel que soit le fuseau du serveur : c'est celle des horaires S1 à S5.
 */
export const AVANCE_MINUTES = 30;
const CINQ_MINUTES = 5 * 60 * 1000;
const FUSEAU = "Africa/Casablanca";
const JOURS_SEMAINE = [
  "Dimanche",
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
];

/** Le jour (« AAAA-MM-JJ »), son nom et la minute de la journée, à l'heure du Maroc. */
export function instantMaroc(maintenant) {
  const parties = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: FUSEAU,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(maintenant)
      .map(({ type, value }) => [type, value]),
  );
  const jour = `${parties.year}-${parties.month}-${parties.day}`;
  return {
    jour,
    nomJour: JOURS_SEMAINE[new Date(`${jour}T12:00:00Z`).getUTCDay()],
    minute: Number(parties.hour) * 60 + Number(parties.minute),
  };
}

/** Les créneaux qui finissent dans `AVANCE_MINUTES` au plus : `[{ seance, fin }]`. */
export function creneauxAVenir(horaires, nomJour, minute) {
  const table = nomJour === "Vendredi" ? horaires.vendredi : horaires.semaine;
  return Object.entries(table)
    .filter(([, { fin }]) => {
      const reste = enMinutes(fin) - minute;
      return reste > 0 && reste <= AVANCE_MINUTES;
    })
    .map(([seance, { fin }]) => ({ seance, fin }));
}

const dejaRappeles = { jour: null, cles: new Set() };

/**
 * Un passage. `maintenant` est injecté pour les tests.
 * @returns {Promise<{rappels: number}>}
 */
export async function envoyerRappelsAppel(maintenant = new Date()) {
  const { jour, nomJour, minute } = instantMaroc(maintenant);
  if (dejaRappeles.jour !== jour) {
    dejaRappeles.jour = jour;
    dejaRappeles.cles.clear();
  }

  const horaires = horairesCourants(
    await HorairesSeances.findOne({ cle: "reseau" }).lean(),
  );
  const creneaux = creneauxAVenir(horaires, nomJour, minute);
  if (creneaux.length === 0) return { rappels: 0 };
  const finDe = Object.fromEntries(creneaux.map((c) => [c.seance, c.fin]));

  // La date d'une séance est le début du jour du SERVEUR (`dateDuJour`) : on prend ±36 h, et le NOM
  // du jour écarte la semaine d'avant ou d'après.
  const midi = new Date(`${jour}T12:00:00Z`);
  const seances = await Seance.find({
    date: {
      $gte: new Date(midi.getTime() - 36 * 3600 * 1000),
      $lte: new Date(midi.getTime() + 36 * 3600 * 1000),
    },
    jour: nomJour,
    seance: { $in: Object.keys(finDe) },
    statut: { $ne: "absent" },
    estEfm: { $ne: true },
  })
    .select(
      "etablissementId anneeScolaire semaine seance periode groupe formateurMatricule",
    )
    .lean();

  // Un rappel par (établissement, formateur, créneau) ; une fusion porte ses groupes dans un libellé
  // (« GM101 GM102 »), comme `AppelValidation.groupe`.
  const cours = new Map();
  for (const s of seances) {
    const cle = `${s.etablissementId}|${s.formateurMatricule}|${s.seance}`;
    if (dejaRappeles.cles.has(cle)) continue;
    const entree = cours.get(cle) ?? { cle, ...s, groupes: [] };
    entree.groupes.push(...s.groupe.split(/\s+/).filter(Boolean));
    cours.set(cle, entree);
  }
  if (cours.size === 0) return { rappels: 0 };

  const etablissements = new Map(
    (
      await Etablissement.find({
        _id: {
          $in: [
            ...new Set(
              [...cours.values()].map((c) => String(c.etablissementId)),
            ),
          ],
        },
      })
        .select("demo modeleDemo")
        .lean()
    ).map((e) => [String(e._id), e]),
  );
  const publiees = new Map();

  let rappels = 0;
  for (const c of cours.values()) {
    try {
      const etablissement = etablissements.get(String(c.etablissementId));
      if (!etablissement || etablissement.demo || etablissement.modeleDemo)
        continue;

      const clePublication = `${c.etablissementId}|${c.anneeScolaire}|${c.semaine}`;
      if (!publiees.has(clePublication))
        publiees.set(
          clePublication,
          await estPubliee(c.etablissementId, c.anneeScolaire, c.semaine),
        );
      if (!publiees.get(clePublication)) continue;

      // L'appel déjà validé (le libellé d'une fusion réunit ses groupes : « GM101 GM102 »).
      const validations = await AppelValidation.find({
        etablissementId: c.etablissementId,
        anneeScolaire: c.anneeScolaire,
        date: jour,
        seance: c.seance,
      })
        .select("groupe")
        .lean();
      const groupesValides = new Set(
        validations.flatMap((v) => v.groupe.split(/\s+/)),
      );
      const groupes = [...new Set(c.groupes)].filter(
        (g) => !groupesValides.has(g),
      );
      if (groupes.length === 0) continue;

      const comptes = await User.find({
        role: ROLES.FORMATEUR,
        identifiant: c.formateurMatricule,
        etablissementIds: c.etablissementId,
        estActif: true,
      })
        .select("_id")
        .lean();
      dejaRappeles.cles.add(c.cle);
      if (comptes.length === 0) continue;

      notifier(
        comptes.map((compte) => String(compte._id)),
        {
          genre: "appel",
          titre: "Pensez à saisir les absences",
          corps: `Votre séance ${c.seance} avec ${groupes.join(", ")} se termine à ${finDe[c.seance]}.`,
          lien: "/app/absences",
        },
      );
      rappels += 1;
    } catch (erreur) {
      // Un cours en échec n'arrête pas les autres ; le passage suivant retentera.
      logger.warn({ err: erreur, cours: c.cle }, "Rappel d’appel non envoyé");
    }
  }
  return { rappels };
}

/** Pour les tests : oublie les rappels déjà faits. */
export const oublierRappels = () => {
  dejaRappeles.jour = null;
  dejaRappeles.cles.clear();
};

/**
 * La tâche de fond : toutes les 5 minutes. ⚠️ PAS EN TEST : la suite appelle
 * `envoyerRappelsAppel` elle-même, à heure fixe.
 */
export function demarrerRappelsAppel() {
  if (process.env.NODE_ENV === "test") return () => {};
  const passer = () =>
    envoyerRappelsAppel()
      .then(({ rappels }) => {
        if (rappels > 0)
          logger.info(`Rappels d’appel : ${rappels} formateur(s) prévenu(s)`);
      })
      .catch((erreur) =>
        logger.error({ err: erreur }, "Rappels d’appel : passage en échec"),
      );
  const minuterie = setInterval(passer, CINQ_MINUTES);
  minuterie.unref?.();
  return () => clearInterval(minuterie);
}
