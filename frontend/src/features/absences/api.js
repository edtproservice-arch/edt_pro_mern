import { api } from '@/lib/apiClient';

/**
 * Absences de formateurs et rattrapages (F8).
 * ← api/data/get_absences.php · update_rattrapage.php · save_observation.php
 */

/** Le registre de l'année, du plus récent au plus ancien. */
export function chargerAbsences({ rattrapees } = {}) {
  const parametres = rattrapees === undefined ? '' : `?rattrapees=${rattrapees ? 'oui' : 'non'}`;
  return api.get(`/api/v2/absences${parametres}`);
}

/**
 * Observation et/ou date de rattrapage.
 *
 * ⚠️ `dateRattrapage: null` ANNULE le rattrapage — et le serveur reprend alors
 * les heures déjà inscrites au chronogramme. Omettre le champ ne le touche pas :
 * ce n'est pas la même chose.
 */
export function modifierAbsence(id, champs) {
  return api.patch(`/api/v2/absences/${id}`, champs);
}

/**
 * Pose (ou déplace) la séance de rattrapage dans la grille — séance, date et
 * report au chronogramme d'un seul tenant (2026-09-14).
 *
 * ⚠️ SEULS LE CRÉNEAU ET LA SALLE PARTENT : le serveur relit groupe, module et
 * formateur dans l'absence, et refuse tout champ de plus.
 */
export function placerRattrapage(id, { semaine, jour, seance, salle }) {
  return api.post(`/api/v2/absences/${id}/rattrapage`, { semaine, jour, seance, salle });
}

/** Retire la séance de rattrapage : l'absence redevient « à rattraper ». */
export function annulerRattrapage(id) {
  return api.delete(`/api/v2/absences/${id}/rattrapage`);
}
