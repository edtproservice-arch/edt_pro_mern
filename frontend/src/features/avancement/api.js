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
