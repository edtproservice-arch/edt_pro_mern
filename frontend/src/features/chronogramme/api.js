import { api } from '@/lib/apiClient';

/**
 * Chronogramme — planning annuel prévisionnel, par groupe (F7).
 * ← api/profile/get_chronogramme_data.php + save_chronogramme.php
 */

export function chargerGroupesChronogramme() {
  return api.get('/api/v2/chronogrammes');
}

export function chargerChronogramme(groupe) {
  return api.get(`/api/v2/chronogrammes/${encodeURIComponent(groupe)}`);
}

/** Formateurs de l'année, pour le sélecteur du mode formateur. */
export function chargerFormateursChronogramme() {
  return api.get('/api/v2/chronogrammes/par-formateur');
}

/** Modules partagés entre présentiel et synchrone, pour « À traiter ». */
export function chargerPartagesParType() {
  return api.get('/api/v2/chronogrammes/partages-type');
}

/**
 * Grille d'un formateur : ses modules dans TOUS les groupes où il intervient.
 *
 * ⚠️ L'ENREGISTREMENT PASSE PAR LES GROUPES. Il n'y a pas de route d'écriture
 * « par formateur » : le chronogramme est stocké par groupe, et l'écran répartit
 * ce qu'il a saisi entre les groupes concernés. Une route d'écriture symétrique
 * donnerait deux chemins vers la même donnée, donc deux occasions de diverger.
 */
export function chargerChronogrammeFormateur(formateur) {
  return api.get(`/api/v2/chronogrammes/par-formateur/${encodeURIComponent(formateur)}`);
}

/**
 * Envoie à ce formateur son chronogramme à remplir (2026-09-22, demande du porteur) : il
 * obtient le droit de modifier la page, et reçoit un message dédié.
 */
export function envoyerChronogrammeFormateur(formateur) {
  return api.post(`/api/v2/chronogrammes/par-formateur/${encodeURIComponent(formateur)}/envoyer`);
}

/**
 * Le même envoi que ci-dessus, pour tous les formateurs de l'année en un clic (2026-09-22,
 * demande du porteur).
 */
export function envoyerChronogrammeATousLesFormateurs() {
  return api.post('/api/v2/chronogrammes/par-formateur/tous/envoyer');
}

/**
 * Renvoie au directeur, pour validation, le chronogramme du formateur CONNECTÉ (2026-09-22,
 * demande du porteur). Le message qui en résulte porte la grille elle-même — voir
 * `CarteChronogrammeFormateur`, dans la messagerie.
 */
export function renvoyerChronogrammeFormateur(formateur) {
  return api.post(`/api/v2/chronogrammes/par-formateur/${encodeURIComponent(formateur)}/renvoyer`);
}

/**
 * ⚠️ Remplacement INTÉGRAL du planning du groupe.
 *
 * `version` (étape d3) : celle du planning sur lequel repose la saisie. Si un
 * collègue a enregistré le groupe entre-temps, le serveur refuse en 409
 * (`VERSION_PERIMEE`) au lieu d'effacer son travail.
 */
export function enregistrerChronogramme(groupe, planning, version) {
  return api.put(`/api/v2/chronogrammes/${encodeURIComponent(groupe)}`, { planning, version });
}

/**
 * Classeur d'export — un onglet par sujet.
 *
 * En POST : la liste peut compter soixante noms avec espaces et parenthèses, et
 * une URL les tronquerait sans le dire.
 */
export function exporterChronogramme(mode, sujets) {
  return api.telecharger(
    '/api/v2/chronogrammes/export',
    { mode, sujets },
    { nomParDefaut: `chronogramme-${mode}.xlsx` }
  );
}

/**
 * Relecture d'un classeur retouché hors ligne.
 *
 * ⚠️ FUSION, JAMAIS REMPLACEMENT : seules les cellules que le fichier NOMME
 * bougent. Une feuille de formateur ne porte qu'une fraction des modules d'un
 * groupe — un remplacement y effacerait ceux de ses collègues.
 */
export function importerChronogramme(fichier) {
  return api.televerser('/api/v2/chronogrammes/import', fichier, 'fichier');
}

/**
 * Charge hebdomadaire de tous les formateurs et de tous les groupes.
 *
 * ⚠️ Sur TOUS les chronogrammes de l'année, pas seulement ceux affichés :
 * c'est tout l'intérêt du tableau, et c'est pourquoi le calcul est côté
 * serveur.
 */
export function chargerCharge() {
  return api.get('/api/v2/chronogrammes/charge');
}

/**
 * L'emploi du temps est-il lié au chronogramme ?
 * ← `api/profile/get_chrono_status.php`
 *
 * ⚠️ `liee` ET `planifie` ARRIVENT ENSEMBLE. Le verrou ne mord que si les deux
 * sont vraies, et deux appels séparés laisseraient l'écran afficher un instant
 * un verrou déjà levé — ou l'inverse. Le serveur rend `verrouActif` tout
 * calculé, pour que personne n'en donne une seconde lecture.
 */
export function chargerLiaison() {
  return api.get('/api/v2/chronogrammes/liaison');
}

/**
 * Associe ou dissocie l'emploi du temps et le chronogramme.
 * ← `api/profile/set_liaison_chronogramme.php`
 *
 * ⚠️ `liee` PART TOUJOURS EXPLICITEMENT : le serveur refuse une requête sans
 * lui, plutôt que de faire basculer l'établissement dans un état qu'il n'a pas
 * demandé.
 */
export function definirLiaison(liee) {
  return api.put('/api/v2/chronogrammes/liaison', { liee });
}

/**
 * Complétude de l'emploi du temps face au chronogramme.
 * ← `api/data/get_completude.php`
 *
 * @param {string} [semaine] « 2026-W9 » pour le détail ; absent, un taux par semaine.
 */
export function chargerCompletude(semaine) {
  const requete = semaine ? `?semaine=${encodeURIComponent(semaine)}` : '';
  return api.get(`/api/v2/chronogrammes/completude${requete}`);
}

/**
 * Place les séances « À placer » d'une semaine, sans toucher à ce qui est posé.
 *
 * ⚠️ `simulation: true` PAR DÉFAUT, ici comme au serveur : l'écran montre
 *    d'abord ce qui serait posé, et où, puis confirme.
 */
export function placerManquantes(semaine, { simulation = true } = {}) {
  return api.post('/api/v2/chronogrammes/completude/placer', { semaine, simulation });
}

/**
 * Reporte dans le chronogramme les séances déjà posées dans l'emploi du temps.
 * ← `api/profile/reporter_emploi_vers_chronogramme.php`
 *
 * ⚠️ `simulation: true` PAR DÉFAUT, ici comme au serveur : le report réécrit
 * des volumes sur plusieurs groupes, et annoncer l'ampleur après coup n'est pas
 * une confirmation.
 */
export function reporterVersChronogramme(simulation = true) {
  return api.post('/api/v2/chronogrammes/report', { simulation });
}
