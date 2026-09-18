import { anneeDuNomGroupe, detecterConflits, separerFusion } from 'shared/domain';

/**
 * Une case peut-elle recevoir le rattrapage d'une absence — et dans quelle
 * salle ? (2026-09-14, plan validé par le porteur : « lorsque je clique sur la
 * case la séance se place automatiquement sans sélectionner le groupe puis le
 * module puis la salle ».)
 *
 * ═══ L'ÉCRAN GUIDE, LE SERVEUR GARANTIT ═══
 * `POST /absences/:id/rattrapage` refait chacun de ces contrôles. Les faire ici
 * sert à dire NON au clic, avec le motif, plutôt qu'après un aller-retour — la
 * règle déjà posée pour les listes de la grille (« PRIS », « EN STAGE »).
 *
 * ⚠️ LES CONFLITS PASSENT PAR `detecterConflits`, LA FONCTION DU SERVEUR : elle
 * seule sait qu'une fusion occupe chacun de ses groupes, qu'un groupe FQ occupe
 * ses constituants, et que TEAMS n'est pas un local. Une seconde règle aurait
 * refusé ici ce que le serveur accepte, ou l'inverse (§4.2).
 */

export const SALLE_A_DISTANCE = 'TEAMS';

const meme = (a, b) => String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();

/** Le cours manqué était-il à distance ? C'est sa salle qui le dit, comme partout. */
export const aDistance = (absence) => meme(absence?.salle, SALLE_A_DISTANCE);

const refus = (motif) => ({ ok: false, motif });

/**
 * @param {object} params
 * @param {object} params.absence l'absence telle que `GET /absences` la rend
 * @param {{semaine: string, jour: string, seance: string}} params.creneau
 * @param {object[]} params.seancesDuCreneau TOUTES les séances de ce créneau dans
 *   l'établissement, pas seulement celles du formateur — c'est là que se voient
 *   un groupe déjà en cours et une salle déjà prise.
 * @param {object} params.etatDuJour l'état du jour rendu par `GET /seances/:semaine`
 * @param {string[]} params.salles les espaces de l'établissement
 * @param {object[]} params.groupesFq la composition des groupes FQ
 * @param {string[]} params.ignorer séances à ne pas compter — le rattrapage déjà
 *   posé, qui va être déplacé et libérera sa place
 * @returns {{ok: true, salle: string, salleDOrigine: boolean} | {ok: false, motif: string}}
 */
export function evaluerCase({
  absence,
  creneau,
  seancesDuCreneau = [],
  etatDuJour,
  salles = [],
  groupesFq = [],
  ignorer = [],
}) {
  if (
    creneau.semaine === absence.semaine &&
    creneau.jour === absence.jour &&
    creneau.seance === absence.seance
  ) {
    return refus('C’est le créneau manqué lui-même');
  }

  if (!etatDuJour) return refus('Jour inconnu');
  if (etatDuJour.ferie) return refus(`Jour férié — ${etatDuJour.ferie.intitule}`);
  if (etatDuJour.vacances) return refus('Vacances');

  const membres = separerFusion(absence.groupe);

  // ⚠️ La rentrée d'abord : un groupe pas encore rentré n'est pas « en stage ».
  for (const membre of membres) {
    const gel = (etatDuJour.rentreesGelees ?? []).find(
      (rentree) => rentree.anneeFormation === anneeDuNomGroupe(membre)
    );
    if (gel) return refus(`${membre} ne fait sa rentrée que le ${gel.date}`);
  }

  const stage = (etatDuJour.stages ?? []).find((s) => membres.some((m) => meme(s.groupe, m)));
  if (stage) return refus(`${stage.groupe} est en stage`);

  if ((etatDuJour.formations ?? []).some((f) => meme(f.matricule, absence.formateurMatricule))) {
    return refus('Le formateur est en formation');
  }

  const existantes = seancesDuCreneau.filter((seance) => !ignorer.includes(seance.id));

  /*
   * ⚠️ LA SALLE N'EST PAS UN MOTIF DE REFUS ICI : c'est à nous d'en trouver une.
   * Seuls le formateur et le groupe interdisent la case.
   */
  const bloquant = detecterConflits(
    { formateurMatricule: absence.formateurMatricule, groupe: absence.groupe },
    existantes,
    { groupesFq }
  ).find((conflit) => conflit.type !== 'salle');
  if (bloquant) return refus(bloquant.message);

  /*
   * ═══ LA SALLE (décision A du porteur) ═══
   * Celle du cours manqué si elle est libre, sinon la première libre. Un cours à
   * distance reste sur TEAMS, qui n'est pas un local et ne se prend jamais.
   */
  if (aDistance(absence)) return { ok: true, salle: SALLE_A_DISTANCE, salleDOrigine: true };

  const libre = (salle) =>
    !detecterConflits({ salle }, existantes, { groupesFq }).some((conflit) => conflit.type === 'salle');

  const candidates = [absence.salle, ...salles].filter(
    (salle, rang, liste) =>
      salle &&
      !meme(salle, SALLE_A_DISTANCE) &&
      liste.findIndex((autre) => meme(autre, salle)) === rang
  );

  const salle = candidates.find(libre);
  if (!salle) return refus('Aucune salle libre sur ce créneau');

  return { ok: true, salle, salleDOrigine: meme(salle, absence.salle) };
}
