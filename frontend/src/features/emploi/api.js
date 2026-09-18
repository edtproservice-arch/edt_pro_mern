import { api } from '@/lib/apiClient';

/**
 * Emploi du temps hebdomadaire (F5).
 * ← api/data/get_timetable.php + get_all_timetables.php
 *
 * ⚠️ LECTURE SEULE pour l'instant : aucune fonction n'écrit. L'édition arrive en
 * sous-livraison (b).
 */

/** Formateurs, groupes et salles — ce qui ne change pas d'une semaine à l'autre. */
export function chargerContexte() {
  return api.get('/api/v2/seances/contexte');
}

/** Les semaines déjà remplies, et celle du jour. */
export function chargerSemaines() {
  return api.get('/api/v2/seances/semaines');
}

/**
 * La fiche d'un module pour un groupe : intitulé complet et avancement semaine
 * par semaine. Interrogée au SURVOL, jamais au chargement de la page.
 *
 * ⚠️ `/module` se déclare AVANT `/:semaine` côté serveur — sans quoi la route
 * de semaine la capterait et chercherait une semaine nommée « module ».
 */
export function chargerFicheModule(groupe, module) {
  const parametres = new URLSearchParams({ groupe, module });
  return api.get(`/api/v2/seances/module?${parametres}`);
}

/** Toutes les séances d'une semaine — jour ET soir. */
export function chargerSemaine(semaine) {
  return api.get(`/api/v2/seances/${encodeURIComponent(semaine)}`);
}

/**
 * Pose ou remplace UNE séance.
 *
 * ⚠️ `id` DIT « je remplace celle-ci ». Sans lui la pose est une CRÉATION, et
 * un formateur déjà occupé sur le créneau devient un conflit — au lieu d'être
 * déplacé en silence.
 */
export function poserSeance(semaine, seance) {
  return api.put(`/api/v2/seances/${encodeURIComponent(semaine)}/case`, seance);
}

/**
 * Les modules RÉGIONAUX d'un groupe, avec leur intitulé complet.
 *
 * ⚠️ Une requête à part, et pas le contexte : l'intitulé se lit dans la
 * répartition DRIF, module par module. Le verser au contexte le ferait payer à
 * chaque ouverture de l'emploi du temps.
 */
export function chargerModulesRegionaux(groupe) {
  return api.get(`/api/v2/seances/modules-regionaux?${new URLSearchParams({ groupe })}`);
}

/**
 * Planifie un EFM régional : une surveillance par surveillant et par créneau.
 * ← `save_efm_regional.php`
 */
export function planifierEfm(semaine, examen) {
  return api.post(`/api/v2/seances/${encodeURIComponent(semaine)}/efm`, examen);
}

/** Vide une case. */
export function viderSeance(semaine, creneau) {
  return api.delete(`/api/v2/seances/${encodeURIComponent(semaine)}/case`, { body: creneau });
}

/**
 * Copie une AUTRE semaine dans celle-ci.
 * ← `importWeekBtn` / `showWeekDropdown()` de emploi.html
 *
 * ⚠️ REMPLACE la semaine visée : le serveur l'efface d'abord, dans la même
 * transaction. Le bilan rendu dit combien de séances ont été écrasées.
 */
export function importerSemaine(semaine, depuis) {
  return api.post(`/api/v2/seances/${encodeURIComponent(semaine)}/importer`, { depuis });
}

/** Efface une semaine, ou l'année entière. ← `effacerEmploiDuTemps()`. */
export function reinitialiserSeances({ portee, semaine }) {
  return api.post('/api/v2/seances/reinitialiser', { portee, semaine });
}

/**
 * Publier la semaine qui FAIT FOI. ← `publish_timetable.php`
 *
 * ⚠️ RÉSERVÉE AU DIRECTEUR côté serveur. L'écran n'affiche le bouton qu'à lui —
 * l'ancien le montrait aussi à l'admin, que le serveur refusait en 403 : un
 * bouton qui échoue toujours.
 */
export function publierSemaine(semaine) {
  return api.put('/api/v2/seances/publication', { semaine });
}

/** Retirer la publication — on retombe sur la règle du samedi 06h30. */
export function depublierSemaine() {
  return api.delete('/api/v2/seances/publication');
}
