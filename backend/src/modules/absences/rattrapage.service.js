import mongoose from 'mongoose';
import { TYPES_COURS } from 'shared/constants';
import {
  DUREE_RATTRAPAGE,
  dateDuJour,
  enJour,
  normaliserValeurSemaine,
  separerFusion,
  typeDeSeance,
} from 'shared/domain';
import { AbsenceFormateur } from '../../models/AbsenceFormateur.js';
import { Etablissement } from '../../models/Etablissement.js';
import { Seance } from '../../models/Seance.js';
import { badRequest, notFound } from '../../lib/httpError.js';
import { poser, semaine as semaineDeLaGrille } from '../seances/seances.service.js';
import { presenterAbsence, presenterRattrapage, reporterAuChronogramme } from './absences.service.js';

/**
 * Placer un rattrapage DANS LA GRILLE, d'un seul tenant (2026-09-14, plan validé
 * par le porteur).
 *
 * ═══ POURQUOI UN SERVICE À PART ═══
 * Il écrit dans trois collections — la séance, l'absence, le chronogramme — et
 * s'appuie sur les deux services voisins. Le poser dans `absences.service.js`
 * aurait créé un cycle d'imports avec `seances.service.js`, qui l'importe déjà :
 * un cycle « marche » en ESM jusqu'au jour où l'ordre d'évaluation change.
 *
 * ═══ ⚠️ LE SERVEUR REPREND TOUT CE QUI VIENT DE L'ABSENCE ═══
 * L'écran n'envoie que le CRÉNEAU et la salle. Le formateur, le groupe et le
 * module sont relus ici dans l'absence : un appel direct ne peut pas rattraper
 * un autre cours que celui qui a manqué. C'est la partie « plus sécurisé » de la
 * demande.
 *
 * ═══ ⚠️ UNE SEULE DATE, CELLE DU CRÉNEAU ═══
 * La séance posée, `dateRattrapage` et le report au chronogramme s'écrivent dans
 * la MÊME transaction : ils ne peuvent plus se contredire, et les heures ne sont
 * comptées qu'une fois — le risque qui avait fait garder, le 2026-09-03, la
 * grille en simple vérification.
 */

const SALLE_A_DISTANCE = 'TEAMS';
const memeNom = (a, b) => String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();

/**
 * Pourquoi ce jour-là n'accepte pas de rattrapage — ou `null` s'il l'accepte.
 *
 * ⚠️ LA SAISIE ORDINAIRE NE CONTRÔLE QUE LA RENTRÉE CÔTÉ SERVEUR ; la grille
 * ferme le reste à l'écran. Ici on refait les quatre contrôles, avec la MÊME
 * lecture du calendrier que la grille (`semaine()` de l'emploi du temps) : une
 * seconde lecture aurait fini par ouvrir un jour que la grille ferme.
 */
function motifDeFermeture(etat, { groupe, formateurMatricule }) {
  if (!etat) return 'Jour inconnu';
  if (etat.ferie) return `Jour férié — ${etat.ferie.intitule}`;
  if (etat.vacances) return 'Vacances';

  const membres = separerFusion(groupe);
  const stage = (etat.stages ?? []).find((s) => membres.some((m) => memeNom(s.groupe, m)));
  if (stage) return `${stage.groupe} est en stage`;

  if ((etat.formations ?? []).some((f) => memeNom(f.matricule, formateurMatricule))) {
    return 'Le formateur est en formation';
  }
  return null;
}

/**
 * Pose (ou déplace) la séance de rattrapage d'une absence.
 *
 * @param {{semaine: string, jour: string, seance: string, salle: string}} creneau
 */
export async function placer(etablissementId, anneeScolaire, id, creneau) {
  const absence = await AbsenceFormateur.findOne({ _id: id, etablissementId, anneeScolaire }).lean();
  if (!absence) throw notFound('Absence introuvable', { code: 'ABSENCE_INTROUVABLE' });

  if (!absence.groupe || !absence.module) {
    throw badRequest('Cette absence n’a ni groupe ni module : rien à rattraper dans la grille', {
      code: 'ABSENCE_INCOMPLETE',
    });
  }

  const semaine = normaliserValeurSemaine(creneau.semaine);
  if (!semaine) {
    throw badRequest(`Semaine « ${creneau.semaine} » illisible`, { code: 'SEMAINE_INVALIDE' });
  }

  if (semaine === absence.semaine && creneau.jour === absence.jour && creneau.seance === absence.seance) {
    throw badRequest('Un cours ne se rattrape pas sur son propre créneau', { code: 'MEME_CRENEAU' });
  }

  const manquee = absence.seanceId
    ? await Seance.findById(absence.seanceId).select('salle periode').lean()
    : null;
  const periode = manquee?.periode ?? 'jour';
  const salle = String(creneau.salle ?? '').trim();

  /*
   * ⚠️ LE RATTRAPAGE GARDE LA NATURE DU COURS MANQUÉ. Une séance à distance
   * consomme le quota SYNCHRONE et se reporte dans une cellule synchrone du
   * chronogramme : la rattraper en salle déplacerait des heures d'une masse à
   * l'autre sans que rien ne le dise.
   */
  const aDistance = typeDeSeance(manquee ?? {}) === TYPES_COURS.SYNCHRONE;
  if (aDistance !== memeNom(salle, SALLE_A_DISTANCE)) {
    throw badRequest(
      aDistance
        ? 'Le cours manqué était à distance : son rattrapage se fait sur TEAMS'
        : 'Le cours manqué était en présentiel : son rattrapage se fait en salle',
      { code: 'NATURE_DIFFERENTE' }
    );
  }

  if (!aDistance) {
    const etablissement = await Etablissement.findById(etablissementId).select('espaces').lean();
    if (!(etablissement?.espaces ?? []).some((espace) => memeNom(espace, salle))) {
      throw badRequest(`La salle « ${salle} » n’existe pas dans l’établissement`, {
        code: 'SALLE_INCONNUE',
      });
    }
  }

  const { jours } = await semaineDeLaGrille(etablissementId, anneeScolaire, semaine);
  const motif = motifDeFermeture(
    jours.find((etat) => etat.jour === creneau.jour),
    absence
  );
  if (motif) {
    throw badRequest(`Ce jour-là n’accepte pas de séance : ${motif}`, {
      code: 'CRENEAU_FERME',
      details: [{ message: motif }],
    });
  }

  const session = await mongoose.startSession();

  try {
    let bilan = [];
    let resultat;
    let seanceCreee;

    await session.withTransaction(async () => {
      // ⚠️ Remis à zéro à chaque tentative : `withTransaction` rejoue le rappel
      // sur une erreur transitoire.
      bilan = [];

      const courante = await AbsenceFormateur.findById(absence._id).session(session);

      /*
       * ⚠️ L'ANCIEN RATTRAPAGE PART D'ABORD, ET DANS LA MÊME TRANSACTION. Retiré
       * avant la pose, il ne compte plus dans le quota ni dans les conflits de
       * la nouvelle ; et si la pose est refusée, l'annulation le rétablit — on
       * ne perd jamais un rattrapage en tentant de le déplacer.
       */
      if (courante.seanceRattrapageId) {
        await Seance.deleteOne({ _id: courante.seanceRattrapageId }, { session });
      }
      if (courante.dateRattrapage) {
        bilan = bilan.concat(
          await reporterAuChronogramme(courante, courante.dateRattrapage, -DUREE_RATTRAPAGE, session)
        );
      }

      seanceCreee = await poser(
        etablissementId,
        anneeScolaire,
        semaine,
        {
          jour: creneau.jour,
          seance: creneau.seance,
          periode,
          formateurMatricule: courante.formateurMatricule,
          groupe: courante.groupe,
          module: courante.module,
          salle,
          statut: 'rattrape',
        },
        { session, rattrapageDe: courante._id }
      );

      // ⚠️ À MIDI : minuit local est 23 h UTC la veille au Maroc, et la date
      // reculerait d'un jour dans le chronogramme.
      courante.dateRattrapage = new Date(`${enJour(dateDuJour(semaine, creneau.jour))}T12:00:00`);
      courante.seanceRattrapageId = seanceCreee.id;

      bilan = bilan.concat(
        await reporterAuChronogramme(courante, courante.dateRattrapage, DUREE_RATTRAPAGE, session)
      );

      await courante.save({ session });
      resultat = courante.toObject();
    });

    const posee = await Seance.findById(seanceCreee.id).lean();

    return {
      ...presenterAbsence(resultat),
      rattrapage: posee ? presenterRattrapage(posee) : null,
      chronogramme: resumerBilan(bilan),
    };
  } finally {
    await session.endSession();
  }
}

/**
 * Retire le rattrapage d'une absence : la séance quitte la grille, les heures
 * quittent le chronogramme, l'absence redevient « à rattraper ».
 */
export async function annuler(etablissementId, anneeScolaire, id) {
  const session = await mongoose.startSession();

  try {
    let bilan = [];
    let resultat;

    await session.withTransaction(async () => {
      bilan = [];

      const absence = await AbsenceFormateur.findOne({ _id: id, etablissementId, anneeScolaire }).session(
        session
      );
      if (!absence) throw notFound('Absence introuvable', { code: 'ABSENCE_INTROUVABLE' });

      if (absence.seanceRattrapageId) {
        await Seance.deleteOne({ _id: absence.seanceRattrapageId }, { session });
      }
      if (absence.dateRattrapage) {
        bilan = await reporterAuChronogramme(absence, absence.dateRattrapage, -DUREE_RATTRAPAGE, session);
      }

      absence.dateRattrapage = null;
      absence.seanceRattrapageId = null;
      await absence.save({ session });
      resultat = absence.toObject();
    });

    return { ...presenterAbsence(resultat), rattrapage: null, chronogramme: resumerBilan(bilan) };
  } finally {
    await session.endSession();
  }
}

/** ⚠️ Le bilan remonte : un report refusé (cellule pleine…) ne doit pas passer pour inscrit. */
function resumerBilan(bilan) {
  return {
    reporte: bilan.filter((ligne) => ligne.etat === 'ajoute').length,
    alertes: bilan.filter((ligne) => !['ajoute', 'retire', 'inchange'].includes(ligne.etat)),
  };
}
