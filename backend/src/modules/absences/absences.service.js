import mongoose from 'mongoose';
import {
  DUREE_RATTRAPAGE,
  NOMBRE_SEMAINES,
  enJour,
  groupesConcernes,
  reporterRattrapage,
  semaineDe,
} from 'shared/domain';
import { AbsenceFormateur } from '../../models/AbsenceFormateur.js';
import { Chronogramme } from '../../models/Chronogramme.js';
import { Base } from '../../models/Base.js';
import { Seance } from '../../models/Seance.js';
import { depuisMongo, versMongo } from '../chronogramme/chronogramme.service.js';
import { intitulesModules } from '../../lib/intitulesModules.js';
import { conflict, notFound } from '../../lib/httpError.js';

/**
 * Absences de formateurs et rattrapages (F8).
 * ← api/data/get_absences.php · update_rattrapage.php · save_observation.php
 *
 * ═══ ⚠️ UNE SEULE SOURCE, PLUS DEUX ═══
 * L'existant écrivait `salle = 'ABSENT'` dans le blob de la grille, puis
 * `save_timetable.php` synchronisait la table `absences` PAR DIFFÉRENCE — deux
 * représentations du même fait, tenues cohérentes à la main, et une salle
 * détournée qui empêchait de savoir OÙ la séance aurait dû avoir lieu.
 *
 * Ici `Seance.statut` porte le fait, et le document d'absence ne porte que ce
 * que la séance ne sait pas dire : l'observation et la date de rattrapage. Il
 * naît et meurt avec le statut de la séance (`synchroniser`), et le lien est
 * explicite (`seanceId`) plutôt que reconstruit par recoupement de chaînes.
 */

/**
 * Aligne le registre des absences sur le statut d'une séance.
 * Appelé à CHAQUE écriture de séance — c'est ce qui remplace la synchro par
 * différence de `save_timetable.php`.
 */
export async function synchroniser(seance, { session } = {}) {
  const cle = {
    etablissementId: seance.etablissementId,
    semaine: seance.semaine,
    jour: seance.jour,
    seance: seance.seance,
    formateurMatricule: seance.formateurMatricule,
  };

  if (seance.statut !== 'absent') {
    /*
     * ⚠️ LE RETOUR À « PRÉSENT » EFFACE L'ABSENCE, avec son observation et son
     * rattrapage. C'est voulu : garder une absence dont la séance n'est plus
     * marquée laisserait un rattrapage prévu pour un cours qui a bien eu lieu.
     * Le report d'heures déjà inscrit au chronogramme est repris d'abord.
     */
    const existante = await AbsenceFormateur.findOne(cle).session(session ?? null);
    if (!existante) return null;

    if (existante.dateRattrapage) {
      await reporterAuChronogramme(existante, existante.dateRattrapage, -DUREE_RATTRAPAGE, session);
    }
    /*
     * ⚠️ LA SÉANCE DE RATTRAPAGE PART AVEC SON ABSENCE (2026-09-14, plan validé
     * par le porteur). Elle ne rattrape plus rien : la laisser en place, c'est
     * un cours de trop dans la grille, compté dans l'avancement, sans que rien
     * ne dise pourquoi il existe.
     */
    if (existante.seanceRattrapageId) {
      await Seance.deleteOne({ _id: existante.seanceRattrapageId }, { session });
    }
    await AbsenceFormateur.deleteOne({ _id: existante._id }, { session });
    return null;
  }

  const document = await AbsenceFormateur.findOneAndUpdate(
    cle,
    {
      $set: {
        anneeScolaire: seance.anneeScolaire,
        seanceId: seance._id,
        groupe: seance.groupe ?? '',
        module: seance.module ?? '',
        dateAbsence: seance.date,
      },
      // ⚠️ `$setOnInsert` : réécrire la séance (changer sa salle) ne doit pas
      // effacer l'observation ni le rattrapage déjà saisis.
      $setOnInsert: { observation: '', dateRattrapage: null },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, session }
  );

  return document;
}

/** Le registre, du plus récent au plus ancien — ← `get_absences.php`. */
export async function lister(etablissementId, anneeScolaire, { rattrapees } = {}) {
  const filtre = { etablissementId, anneeScolaire };
  if (rattrapees === true) filtre.dateRattrapage = { $ne: null };
  if (rattrapees === false) filtre.dateRattrapage = null;

  const [absences, base] = await Promise.all([
    AbsenceFormateur.find(filtre).sort({ dateAbsence: -1, _id: -1 }).lean(),
    Base.findOne({ etablissementId, anneeScolaire }).select('formateurs').lean(),
  ]);

  /*
   * ⚠️ LE MATRICULE EST LA CLÉ, LE NOM N'EST QUE L'AFFICHAGE — c'est déjà ce que
   * faisait `get_absences.php` en ajoutant `formateur_nom` sans toucher à
   * `formateur`. Stocker le nom figerait une orthographe que la base e-note
   * peut corriger.
   */
  // ⚠️ Le NOM COMPLET d'abord (2026-09-17, demande du porteur) : `nomUnique`
  // est le nom COURT d'affichage (« AISSI »), qui ne suffit pas à reconnaître
  // quelqu'un dans la liste des absences. Il ne sert plus que de repli.
  const noms = new Map(
    (base?.formateurs ?? []).map((f) => [String(f.matricule ?? ''), f.nomComplet || f.nomUnique || ''])
  );

  /*
   * ═══ LA SÉANCE MANQUÉE ET CELLE QUI LA RATTRAPE (2026-09-14) ═══
   * La modale de rattrapage place une séance en UN clic, déjà remplie : il lui
   * faut la SALLE et la PÉRIODE du cours manqué — que le registre ne porte pas,
   * la séance absente les garde. Et le créneau déjà posé, pour l'afficher et le
   * déplacer. Une seule requête pour tout le registre, pas une par ligne.
   */
  const identifiants = absences.flatMap((absence) =>
    [absence.seanceId, absence.seanceRattrapageId].filter(Boolean)
  );
  const seances = identifiants.length
    ? await Seance.find({ _id: { $in: identifiants }, etablissementId })
        .select('semaine jour seance periode salle date')
        .lean()
    : [];
  const seanceParId = new Map(seances.map((seance) => [String(seance._id), seance]));

  // Le nom complet du module, pour la carte du créneau (2026-09-17) — la même
  // carte que l'agenda de « Mon emploi du temps », qui l'affiche sous le code.
  const intitules = await intitulesModules([...new Set(absences.map((a) => a.module).filter(Boolean))]);

  return absences.map((absence) => {
    const manquee = seanceParId.get(String(absence.seanceId));
    const rattrapage = absence.seanceRattrapageId
      ? seanceParId.get(String(absence.seanceRattrapageId))
      : null;

    return {
      ...presenterAbsence(absence, noms),
      salle: manquee?.salle ?? '',
      periode: manquee?.periode ?? 'jour',
      moduleIntitule: intitules[absence.module] ?? '',
      rattrapage: rattrapage ? presenterRattrapage(rattrapage) : null,
    };
  });
}

/** Le créneau de rattrapage posé, tel que l'écran l'affiche et le déplace. */
export function presenterRattrapage(seance) {
  return {
    id: String(seance._id),
    semaine: seance.semaine,
    jour: seance.jour,
    seance: seance.seance,
    periode: seance.periode ?? 'jour',
    salle: seance.salle ?? '',
    date: enTexte(seance.date),
  };
}

/** Une absence telle que l'écran la lit — partagée par la liste et le placement. */
export function presenterAbsence(absence, noms = new Map()) {
  return {
    id: String(absence._id),
    semaine: absence.semaine,
    jour: absence.jour,
    seance: absence.seance,
    formateurMatricule: absence.formateurMatricule,
    formateurNom: noms.get(absence.formateurMatricule) || absence.formateurMatricule,
    groupe: absence.groupe,
    module: absence.module,
    dateAbsence: enTexte(absence.dateAbsence),
    observation: absence.observation ?? '',
    dateRattrapage: enTexte(absence.dateRattrapage),
  };
}

/**
 * Observation et/ou date de rattrapage.
 * ← `save_observation.php` + `update_rattrapage.php`
 *
 * ⚠️⚠️ L'ANCIENNE DATE EST REPRISE AVANT D'ÉCRIRE LA NOUVELLE. Sans cela,
 * replanifier un rattrapage laisserait ses heures dans l'ancienne semaine ET les
 * ajouterait dans la nouvelle ; et confirmer deux fois la même date les
 * compterait deux fois. Défaire puis refaire rend l'opération REJOUABLE.
 */
export async function modifier(etablissementId, anneeScolaire, id, champs) {
  const session = await mongoose.startSession();

  try {
    let bilan = [];
    let resultat;

    await session.withTransaction(async () => {
      const absence = await AbsenceFormateur.findOne({
        _id: id,
        etablissementId,
        anneeScolaire,
      }).session(session);

      if (!absence) throw notFound('Absence introuvable', { code: 'ABSENCE_INTROUVABLE' });

      if (champs.observation !== undefined) absence.observation = champs.observation;

      if (champs.dateRattrapage !== undefined) {
        /*
         * ⚠️ UNE DATE SAISIE NE PEUT PAS CONTREDIRE UNE SÉANCE POSÉE (2026-09-14).
         * Quand le rattrapage vit dans la grille, sa date EST celle du créneau :
         * la changer ici laisserait la séance à un endroit et les heures du
         * chronogramme à un autre. On passe par le déplacement ou l'annulation.
         */
        if (absence.seanceRattrapageId) {
          throw conflict('Ce rattrapage est placé dans l’emploi du temps', {
            code: 'RATTRAPAGE_PLACE',
            details: [
              { message: 'Déplacez-le ou annulez-le depuis la fenêtre de rattrapage.' },
            ],
          });
        }

        const nouvelle = champs.dateRattrapage ? new Date(`${champs.dateRattrapage}T12:00:00`) : null;

        if (absence.dateRattrapage) {
          bilan = bilan.concat(
            await reporterAuChronogramme(absence, absence.dateRattrapage, -DUREE_RATTRAPAGE, session)
          );
        }

        absence.dateRattrapage = nouvelle;

        if (nouvelle) {
          bilan = bilan.concat(
            await reporterAuChronogramme(absence, nouvelle, DUREE_RATTRAPAGE, session)
          );
        }
      }

      await absence.save({ session });
      resultat = absence.toObject();
    });

    /*
     * ⚠️ LE BILAN REMONTE AU CLIENT. Un rattrapage posé sur un groupe sans
     * chronogramme, ou dans une cellule déjà pleine, ne s'y inscrit PAS — et ne
     * rien dire laisserait croire le contraire.
     */
    return {
      id: String(resultat._id),
      observation: resultat.observation,
      dateRattrapage: enTexte(resultat.dateRattrapage),
      chronogramme: {
        reporte: bilan.filter((ligne) => ligne.etat === 'ajoute').length,
        alertes: bilan.filter((ligne) => !['ajoute', 'retire', 'inchange'].includes(ligne.etat)),
      },
    };
  } finally {
    await session.endSession();
  }
}

/**
 * Inscrit (ou reprend) les heures d'un rattrapage dans le chronogramme de
 * chaque groupe concerné.
 */
export async function reporterAuChronogramme(absence, date, delta, session) {
  const { numero } = semaineDe(date instanceof Date ? date : new Date(`${date}T12:00:00`));

  // Hors des 45 semaines, il n'y a pas de colonne où l'inscrire.
  const numeroSemaine = numero >= 1 && numero <= NOMBRE_SEMAINES ? numero : null;
  const bilan = [];

  for (const groupe of groupesConcernes(absence.groupe)) {
    const chronogramme = await Chronogramme.findOne({
      etablissementId: absence.etablissementId,
      anneeScolaire: absence.anneeScolaire,
      groupe,
    }).session(session ?? null);

    if (!chronogramme) {
      bilan.push({ groupe, etat: 'sans_chronogramme' });
      continue;
    }

    /*
     * ⚠️ LE PLANNING EST STOCKÉ EN TABLEAUX DE `{semaine: "S12", heures, type}`,
     * quand le domaine raisonne en `{12: {heures, type}}`. Les convertisseurs
     * sont ceux du module chronogramme, IMPORTÉS et non recopiés : une seconde
     * paire aurait dérivé au premier changement de forme (§4.2).
     */
    const resultat = reporterRattrapage({
      planning: depuisMongo(chronogramme.planning),
      module: absence.module,
      numeroSemaine,
      delta,
    });

    bilan.push({ groupe, etat: resultat.etat, semaine: numeroSemaine, heures: resultat.heures });

    if (resultat.etat !== 'ajoute' && resultat.etat !== 'retire') continue;

    chronogramme.planning = versMongo(resultat.planning);
    // Le report réécrit le planning : une grille ouverte avant est périmée (d3).
    chronogramme.version = (chronogramme.version ?? 0) + 1;
    await chronogramme.save({ session });
  }

  return bilan;
}

/**
 * La séance de rattrapage disparaît de la grille : son absence redevient « à
 * rattraper » (2026-09-14).
 *
 * ⚠️ APPELÉ AVANT LA SUPPRESSION, par chaque chemin qui efface des séances —
 * vider une case, réinitialiser une semaine ou l'année. Sans lui, l'absence
 * garderait une date de rattrapage pour un cours qui n'existe plus, et ses
 * heures resteraient inscrites au chronogramme.
 */
export async function detacherRattrapage(seance, { session } = {}) {
  if (!seance?.rattrapageDe) return null;

  const absence = await AbsenceFormateur.findById(seance.rattrapageDe).session(session ?? null);
  if (!absence) return null;

  if (absence.dateRattrapage) {
    await reporterAuChronogramme(absence, absence.dateRattrapage, -DUREE_RATTRAPAGE, session);
  }
  absence.dateRattrapage = null;
  absence.seanceRattrapageId = null;
  await absence.save({ session });
  return absence;
}

/**
 * ═══ ⚠️⚠️ EN HEURE LOCALE, JAMAIS `toISOString()` ═══
 * (2026-08-26, signalé par le porteur : « la date est fausse ».)
 *
 * Une séance du LUNDI 31 août s'affichait « 2026-08-30 ». `dateDuJour` pose
 * minuit LOCAL — au Maroc, 23:00 UTC la VEILLE — et `toISOString()` relisait en
 * UTC : un jour de moins, systématiquement, pour tout poste à l'est de
 * Greenwich.
 *
 * ⚠️ ET C'ÉTAIT LE MÊME NOM POUR DEUX RÈGLES : `seances.service.js` avait SON
 * `enTexte`, en heure locale, correct. Deux fonctions homonymes qui divergent —
 * la cause n°1 d'instabilité du §4.2, à quelques fichiers de distance.
 *
 * `enJour` du domaine porte désormais la règle, une seule fois : elle accepte
 * aussi bien une `Date` qu'une chaîne déjà au bon format.
 */
const enTexte = (date) => (date ? enJour(date instanceof Date ? date : new Date(date)) : null);
