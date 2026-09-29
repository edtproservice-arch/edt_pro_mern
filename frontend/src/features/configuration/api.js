import { api } from '@/lib/apiClient';

/**
 * Configuration initiale de l'établissement (F3).
 * ← public/setup.html + api/setup/complete_setup.php
 *
 * L'écran a été construit avant ses routes : c'est lui qui a défini le
 * contrat, le serveur l'a suivi. Toutes les routes listées ici existent.
 */

/* ─── Étape 1 : base e-note ─────────────────────────────────────────────── */

/**
 * @param {File} fichier
 * @param {boolean} remplacer  Remplace la base DÉJÀ importée cette semaine.
 *   Sans ce drapeau, le serveur refuse un second dépôt dans la même semaine
 *   scolaire (409 `IMPORT_HEBDOMADAIRE`) — une seule base e-note par semaine.
 */
export function importerBaseEnote(fichier, remplacer = false) {
  return api.televerser('/api/v2/base/import', fichier, 'fichier', { remplacer });
}

export function chargerBase() {
  return api.get('/api/v2/base');
}

export function chargerResumeBase() {
  return api.get('/api/v2/base/resume');
}

/* ─── Étape 1 bis : carte construite à la main ──────────────────────────── */

/**
 * Répartition DRIF, interrogée par niveau de cascade.
 *
 * ⚠️ L'existant téléchargeait les **13 359 lignes** (3 Mo) à chaque ouverture
 * du panneau et filtrait en JavaScript. Ici chaque niveau est une requête
 * indexée qui rend quelques dizaines de valeurs.
 */
function parametres(filtres) {
  const query = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(filtres)) {
    if (valeur !== undefined && valeur !== null && valeur !== '') query.set(cle, valeur);
  }
  return query.toString();
}

export function chargerSecteurs() {
  return api.get('/api/v2/repartitions/secteurs');
}

export function chargerNiveaux(filtres) {
  return api.get(`/api/v2/repartitions/niveaux?${parametres(filtres)}`);
}

export function chargerAnnees(filtres) {
  return api.get(`/api/v2/repartitions/annees?${parametres(filtres)}`);
}

export function chargerFilieres(filtres) {
  return api.get(`/api/v2/repartitions/filieres?${parametres(filtres)}`);
}

export function chargerModulesFiliere(filiere, annee) {
  return api.get(`/api/v2/repartitions/modules?${parametres({ filiere, annee })}`);
}

/**
 * Modules de plusieurs ensembles (filière, année) en UN seul appel.
 *
 * La carte enregistrée en réclame un par filière et par année — dix pour seize
 * groupes. Un appel par ensemble, c'est autant de vérifications de jeton et
 * d'allers-retours vers la base, que le navigateur sérialise par vagues de six.
 *
 * @param {Array<{codeFiliere: string, anneeFormation: number}>} ensembles
 * @returns {Promise<{ensembles: Record<string, {filiere, modules}>}>} clés « CODE||ANNEE »
 */
export function chargerModulesEnsembles(ensembles) {
  const liste = ensembles.map(({ codeFiliere, anneeFormation }) => `${codeFiliere}:${anneeFormation}`);
  return api.get(`/api/v2/repartitions/modules-multiples?${parametres({ ensembles: liste.join(',') })}`);
}

/**
 * Analyse un classeur de formateurs et rend la liste lue.
 *
 * LECTURE SEULE : rien n'est écrit en base. La carte n'est enregistrée qu'au
 * bouton « Enregistrer la carte ». Le fichier est lu par le serveur, qui a déjà
 * `exceljs` — l'existant téléchargeait 861 Ko de SheetJS dans le navigateur.
 */
export function analyserFormateurs(fichier) {
  return api.televerser('/api/v2/base/formateurs/analyse', fichier);
}

/**
 * Exporte le bilan offre / demande en classeur Excel (6 feuilles).
 *
 * La carte À L'ÉCRAN part dans la requête : elle n'est pas encore enregistrée,
 * et c'est bien ce qu'on veut exporter. Le serveur recalcule le bilan avec la
 * même fonction de domaine que l'écran, donc les chiffres ne peuvent pas
 * diverger de ceux affichés.
 */
export function exporterBilan(carte) {
  return api.telecharger('/api/v2/base/bilan/export', carte, {
    nomParDefaut: 'bilan-offre-demande.xlsx',
  });
}

/**
 * Exporte la carte complète — 8 feuilles.
 *
 * La première, « AvancementProgramme », porte la carte au format e-note : le
 * fichier produit est directement RÉIMPORTABLE, ici ou dans l'emploi du temps.
 * C'est ce qui permet de transmettre sa carte, de la reprendre l'année suivante
 * ou de la reconstruire après une fausse manœuvre.
 */
export function exporterCarte(carte) {
  return api.telecharger('/api/v2/base/carte/export', carte, {
    nomParDefaut: 'carte-etablissement.xlsx',
  });
}

/**
 * Enregistre la carte — elle passe par le même parseur que l'import e-note.
 *
 * `version` : celle de la base que l'écran a lue (étape d3). Absente — c'est
 * le cas de l'assistant de configuration — l'écriture passe sans condition.
 */
export function enregistrerCarte(carte, version, confirmerSuppressions = false) {
  /*
   * ⚠️ `confirmerSuppressions` N'EST ENVOYÉ QUE S'IL EST VRAI (2026-09-22).
   *    Retirer un groupe de la carte détruit sa planification, ses séances et
   *    le rattachement de ses stagiaires : le serveur refuse en 409 tant que ce
   *    drapeau est absent, et rend le détail chiffré de ce qui partirait.
   *    L'envoyer « par confort » reviendrait à désarmer le garde-fou.
   */
  return api.post('/api/v2/base/carte', {
    ...carte,
    ...(version === undefined ? {} : { version }),
    ...(confirmerSuppressions ? { confirmerSuppressions: true } : {}),
  });
}

/* ─── Étape 2 : formateurs ──────────────────────────────────────────────── */

/**
 * Corrections des fiches formateurs : adresse, matricule, masse horaire.
 *
 * En lot, et non une requête par ligne : l'écran en modifie couramment
 * plusieurs dizaines d'un coup. Le serveur les applique dans une transaction —
 * un rejet partiel laisserait la base dans un état que personne n'a validé.
 *
 * @param {Record<string, {matricule?: string, email?: string, masseHoraire?: string|number}>} corrections
 *        indexées par `nomComplet`, l'identifiant que porte la base.
 */
export function corrigerFormateurs(corrections) {
  const formateurs = Object.entries(corrections).map(([nomComplet, champs]) => ({
    nomComplet,
    ...champs,
  }));

  return api.patch('/api/v2/base/formateurs', { formateurs });
}

/**
 * Ajoute, met à jour et retire des formateurs directement dans la base.
 *
 * @param {{ajouter?: Array<{nom: string, matricule?: string, email?: string, masseHoraire?: number}>,
 *          retirer?: string[]}} modification  `retirer` : des `nomComplet`
 */
export function modifierListeFormateurs({ ajouter = [], retirer = [] }) {
  return api.post('/api/v2/base/formateurs/liste', { ajouter, retirer });
}

/* ─── Étape 3 : calendrier ──────────────────────────────────────────────── */

/**
 * Jours fériés de l'année scolaire.
 * Le serveur interroge l'API des fêtes religieuses et applique les ajustements
 * déjà enregistrés par l'établissement.
 */
export function chargerJoursFeries(anneeScolaire) {
  return api.get(`/api/v2/calendrier/jours-feries?annee=${anneeScolaire}`);
}

/*
 * ⚠️ `confirmerSuppressions` (2026-09-23) : de nouvelles vacances qui recouvrent
 * des séances sont refusées en 409 « PERIODES_SUPPRESSIONS » ; l'écran renvoie la
 * même saisie avec ce drapeau une fois la question lue. Envoyé seulement s'il est
 * vrai, comme pour la carte.
 */
const drapeauConfirmation = ({ confirmerSuppressions } = {}) =>
  confirmerSuppressions ? { confirmerSuppressions: true } : {};

export function enregistrerCalendrier(calendrier, options) {
  return api.put('/api/v2/calendrier', { ...calendrier, ...drapeauConfirmation(options) });
}

/** Calendrier enregistré : périodes de vacances et ajustements de fériés. */
export function chargerCalendrier() {
  return api.get('/api/v2/calendrier');
}

/* ─── Étape 4 : espaces ─────────────────────────────────────────────────── */

/*
 * ⚠️ `version` (étape d3) : celle que la page a lue. Le serveur refuse en 409
 * une liste modifiée entre-temps. L'assistant de configuration n'en passe pas —
 * personne d'autre ne voit encore la page — et écrit sans condition.
 */
export function enregistrerEspaces(espaces, version) {
  // ⚠️ Un entier, sinon rien : passée telle quelle à `useMutation`, cette fonction reçoit
  // en second argument l'objet de contexte de TanStack Query — et l'envoyait au serveur.
  const versionLue = Number.isInteger(version) ? version : undefined;
  return api.put('/api/v2/etablissements/courant/espaces', { espaces, version: versionLue });
}

/* ─── Clôture ───────────────────────────────────────────────────────────── */

/** Marque la configuration comme terminée. ← complete_setup.php:300 */
/** Établissement courant — nom officiel, complexe, région, nom abrégé. */
export function chargerEtablissementCourant() {
  return api.get('/api/v2/etablissements/courant');
}

/**
 * Tous les établissements auxquels le compte connecté a accès — pour le
 * choisir après la connexion, ou en changer sans se déconnecter, quand un
 * compte (formateur mutualisé, directeur en supervisant plusieurs…) en
 * compte plus d'un. ← `GET /api/v2/etablissements`.
 */
export function chargerMesEtablissements() {
  return api.get('/api/v2/etablissements');
}

/**
 * Nom abrégé (étape 5).
 *
 * Il figure sur les documents imprimés, là où le nom officiel ne tient pas :
 * en-têtes de grille, cartes de stagiaire, listes d'émargement.
 */
export function enregistrerNomAbrege(nomAbrege) {
  return api.patch('/api/v2/etablissements/courant/nom-abrege', { nomAbrege });
}

/**
 * Où en est la configuration : ce qui est FAIT, lu dans les données du serveur.
 * → `{ etapes: {identite, espaces, base, formateurs, carte}, manquantes: string[] }`
 */
export function chargerProgressionConfiguration() {
  return api.get('/api/v2/etablissements/courant/configuration-progression');
}

export function terminerConfiguration() {
  return api.post('/api/v2/etablissements/courant/configuration-terminee');
}

export function chargerContexte() {
  return api.get('/api/v2/etablissements/courant');
}

/**
 * Périodes de stage, par groupe. ← table `stages`
 *
 * Remplacement complet : l'écran envoie la liste telle qu'affichée, une période
 * retirée doit disparaître.
 */
export function enregistrerStages(stages, version, options) {
  return api.put('/api/v2/etablissements/courant/stages', {
    stages,
    version,
    ...drapeauConfirmation(options),
  });
}

/** Formations suivies par les formateurs — ils y sont indisponibles. */
export function enregistrerFormations(formations, version, options) {
  return api.put('/api/v2/etablissements/courant/formations', {
    formations,
    version,
    ...drapeauConfirmation(options),
  });
}

/**
 * Composition des groupes FQ — quels groupes réels forment un groupe virtuel.
 *
 * ⚠️ La liste est REMPLACÉE : l'écran envoie l'état complet, comme les stages.
 */
export function enregistrerGroupesFq(groupesFq, version) {
  return api.put('/api/v2/etablissements/courant/groupes-fq', { groupesFq, version });
}

/* ─── Disponibilité et salles attribuées des formateurs ─────────────────── */

/** ← le panneau « Formateurs » de profile.html (profil-contraintes.js) */
export function chargerContraintesFormateurs() {
  return api.get('/api/v2/base/formateurs/contraintes');
}

/**
 * Écriture PARTIELLE d'un formateur : un champ absent n'est pas touché.
 * @param {{formateur: string, espaces?: string[], indisponibilites?: Array<{jour, seance}>}} contraintes
 */
export function enregistrerContraintesFormateur(contraintes) {
  return api.patch('/api/v2/base/formateurs/contraintes', contraintes);
}
