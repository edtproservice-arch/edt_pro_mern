import { api } from '@/lib/apiClient';

/**
 * Absences, retards et indisciplines des stagiaires — la note de discipline (F9).
 * ⚠️ `/api/v2` écrit en entier : `api.get` ne préfixe rien (piège payé deux fois).
 */
const RACINE = '/api/v2/absences-stagiaires';
const requete = (parametres) => new URLSearchParams(parametres).toString();

export const chargerGroupes = () => api.get(`${RACINE}/groupes`);

/** Les cours du jour ouverts à l'appel — ceux du formateur connecté, ou du groupe choisi. */
export const chargerSeancesDuJour = ({ date, groupe }) =>
  api.get(`${RACINE}/seances?${requete(groupe ? { date, groupe } : { date })}`);

export const chargerAppel = ({ date, seance, periode, groupe }) =>
  api.get(`${RACINE}/appel?${requete({ date, seance, periode, groupe })}`);

/** L'état de TOUTE la liste : `type` vaut 'absence', 'retard' ou `null` (présent). */
export const enregistrerAppel = (corps) => api.put(`${RACINE}/appel`, corps);

export const chargerRegistre = (filtre = {}) => {
  const propre = Object.fromEntries(Object.entries(filtre).filter(([, valeur]) => valeur));
  return api.get(`${RACINE}${Object.keys(propre).length ? `?${requete(propre)}` : ''}`);
};

export const justifierAbsence = (id, champs) => api.patch(`${RACINE}/${id}`, champs);
export const supprimerAbsence = (id) => api.delete(`${RACINE}/${id}`);

export const chargerNotes = (groupe) => api.get(`${RACINE}/notes?${requete({ groupe })}`);
export const chargerFiche = (matricule) => api.get(`${RACINE}/stagiaires/${encodeURIComponent(matricule)}`);

export const declarerIndiscipline = (corps) => api.post(`${RACINE}/indisciplines`, corps);
export const retirerIndiscipline = (id) => api.delete(`${RACINE}/indisciplines/${id}`);
