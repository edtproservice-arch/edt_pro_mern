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
