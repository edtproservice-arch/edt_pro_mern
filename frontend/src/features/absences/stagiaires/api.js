import { api } from '@/lib/apiClient';

/**
 * Absences, retards et indisciplines des stagiaires — la note de discipline (F9).
 * ⚠️ `/api/v2` écrit en entier : `api.get` ne préfixe rien (piège payé deux fois).
 */
const RACINE = '/api/v2/absences-stagiaires';
const requete = (parametres) => new URLSearchParams(parametres).toString();

export const chargerGroupes = () => api.get(`${RACINE}/groupes`);

/**
 * La feuille d'absence hebdomadaire d'un ou plusieurs groupes, en Word, PDF
 * ou Excel (2026-09-29) — `groupes` est la liste que le filtre de « Faire
 * l'appel » laisse visible sur la grille : un fichier, une page (ou un
 * onglet Excel) par groupe.
 */
export const exporterFeuilleAbsence = ({ format, groupes, semaine }) =>
  api.telecharger(`${RACINE}/export`, { format, groupes, semaine }, {
    nomParDefaut: `feuille-absence.${format}`,
  });

/**
 * Une feuille de présence d'épreuve d'un ou plusieurs groupes, en Word ou PDF
 * (2026-10-02) — `modele` : `eff` ou `cc-efm`. Une page par groupe.
 */
export const exporterFeuillePresence = (modele) => ({ format, groupes }) =>
  api.telecharger(`${RACINE}/presence/${modele}`, { format, groupes }, {
    nomParDefaut: `feuille-presence-${modele}.${format}`,
  });

/** Le tableau de bord du gestionnaire (2026-09-29) : absences et discipline, pour tout l'établissement. */
export const chargerTableauDeBord = () => api.get(`${RACINE}/tableau-bord`);

/** Les cours du jour ouverts à l'appel — ceux du formateur connecté, ou du groupe choisi. */
export const chargerSeancesDuJour = ({ date, groupe }) =>
  api.get(`${RACINE}/seances?${requete(groupe ? { date, groupe } : { date })}`);

export const chargerAppel = ({ date, seance, periode, groupe }) =>
  api.get(`${RACINE}/appel?${requete({ date, seance, periode, groupe })}`);

/** L'état de TOUTE la liste : `type` vaut 'absence', 'retard' ou `null` (présent). */
export const enregistrerAppel = (corps) => api.put(`${RACINE}/appel`, corps);

/**
 * Enregistre l'appel ET l'ATTESTE (2026-09-27) — le bouton « Valider l'appel »
 * du formateur, qui remplace l'enregistrement automatique pour lui.
 */
export const validerAppel = (corps) => api.put(`${RACINE}/appel/valider`, corps);

/**
 * Le signe « validé » sur la grille elle-même (2026-09-27, demande du
 * porteur : « un signe de validé sans cliquer sur la séance »).
 */
export const chargerValidationsAppel = ({ debut, fin }) =>
  api.get(`${RACINE}/appel/validations?${requete({ debut, fin })}`);

export const chargerRegistre = (filtre = {}) => {
  const propre = Object.fromEntries(Object.entries(filtre).filter(([, valeur]) => valeur));
  return api.get(`${RACINE}${Object.keys(propre).length ? `?${requete(propre)}` : ''}`);
};

export const justifierAbsence = (id, champs) => api.patch(`${RACINE}/${id}`, champs);
export const supprimerAbsence = (id) => api.delete(`${RACINE}/${id}`);

/**
 * Le(s) billet(s) d'excuse (Word, PDF ou Excel) d'une ou plusieurs absences
 * et retards JUSTIFIÉS (2026-09-29, demande du porteur : « si un seul
 * stagiaire justifié il s'affiche une seule billet… si deux stagiaires
 * justifient en même temps il s'affiche deux billets »), canevas transmis —
 * autant de billets que d'identifiants, dans le même fichier. Le serveur
 * refuse dès qu'une seule des absences demandées n'est pas justifiée.
 */
export const telechargerBillets = ({ format, ids }) =>
  api.telecharger(`${RACINE}/billets`, { format, ids }, { nomParDefaut: `billets-excuse.${format}` });

/** Une page de quinze billets vierges, à remplir à la main (Word ou PDF). */
export const telechargerBilletsVierges = (format) =>
  api.telecharger(`${RACINE}/billets/vierges`, { format }, { nomParDefaut: `billets-excuse-vierges.${format}` });

export const chargerNotes = (groupe) => api.get(`${RACINE}/notes?${requete({ groupe })}`);
export const chargerFiche = (matricule) => api.get(`${RACINE}/stagiaires/${encodeURIComponent(matricule)}`);

export const declarerIndiscipline = (corps) => api.post(`${RACINE}/indisciplines`, corps);
export const retirerIndiscipline = (id) => api.delete(`${RACINE}/indisciplines/${id}`);
