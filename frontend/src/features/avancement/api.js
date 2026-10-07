import { api } from '@/lib/apiClient';

/**
 * Avancement réalisé / prévu (F7).
 * ← api/data/get_avancement_data.php · get_planned_progress.php
 *
 * ⚠️ UNE SEULE REQUÊTE pour les deux faces et les trois axes : le serveur fait
 * le même parcours quoi qu'il arrive, seule la clé d'agrégation change. En
 * séparer les appels ferait relire la base, les séances et l'import à chaque
 * bascule de l'écran.
 *
 * ⚠️ LE CHEMIN PORTE `/api/v2` EN ENTIER — `api.get` ne préfixe RIEN. Sans lui,
 * Vite répond 200 avec `index.html` (repli d'application à page unique) et le
 * garde `REPONSE_NON_JSON` d'`apiClient` lève. C'est le piège déjà payé sur
 * `comptesApi.js`.
 */
export const chargerAvancement = (date = null) =>
  api.get(`/api/v2/avancement${date ? `?date=${date}` : ''}`);

/**
 * Les points de la frise chronologique, par face.
 * ← `get_timeline_dates.php`
 */
export const chargerChronologie = () => api.get('/api/v2/avancement/chronologie');

/**
 * Les plages de chaque module — prévue au chronogramme, posée dans la grille.
 *
 * ⚠️ UNE ROUTE À PART, appelée SEULEMENT à l'ouverture du détail : elle relit
 * tous les chronogrammes de l'année, un parcours qu'on ne doit pas payer à
 * chaque ouverture de la page.
 */
export const chargerAchevement = (date = null) =>
  api.get(`/api/v2/avancement/achevement${date ? `?date=${date}` : ''}`);

/**
 * Le détail de l'achèvement des modules en Word, PDF ou Excel (2026-10-07).
 * L'écran envoie ses lignes déjà mises en texte — voir `AchevementModules`.
 */
export const exporterAchevement = (corps) =>
  api.telecharger('/api/v2/avancement/achevement/export', corps, {
    nomParDefaut: `achevement-modules.${corps.format}`,
  });

/** Les points de la courbe de la face e-note : le taux déclaré de chaque dépôt, par semaine. */
export const chargerPointsEnote = (date = null) =>
  api.get(`/api/v2/avancement/points-enote${date ? `?date=${date}` : ''}`);

/**
 * L'écart de saisie e-note / eDTpro, par formateur et par dépôt e-note.
 * Relit tous les imports de l'année : à ne charger que là où il s'affiche.
 */
export const chargerEcartsSaisie = () => api.get('/api/v2/avancement/ecarts-saisie');

/** Envoie l'état d'écart au formateur par la messagerie EDT Pro (directeur seul). */
export const envoyerEcartSaisie = (formateur, semaine) =>
  api.post('/api/v2/avancement/ecarts-saisie/envoyer', { formateur, semaine });

/** Le même envoi, à tous les formateurs en manque d'une semaine. Rend `{total, envoyes, echecs}`. */
export const envoyerEcartSaisieATous = (semaine) =>
  api.post('/api/v2/avancement/ecarts-saisie/envoyer-tous', { semaine });

/** Le détail d'une carte : par groupe et module, avec les séances de la grille. */
export const chargerDetailEcartSaisie = (formateur, semaine) =>
  api.get(
    `/api/v2/avancement/ecarts-saisie/detail?formateur=${encodeURIComponent(formateur)}&semaine=${semaine}`
  );
