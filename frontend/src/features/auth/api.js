import { api } from '@/lib/apiClient';
import { decrireAppareil } from '@/lib/appareil';

/**
 * Appels d'authentification — API Express (`/api/v2/auth`).
 *
 * Basculé depuis l'API PHP le 2026-08-14. Les composants n'ont pas eu à changer :
 * c'est l'intérêt d'avoir regroupé les appels ici plutôt que dans les pages.
 *
 * Les champs partent en camelCase, exactement tels que les valide
 * `inscriptionSchema` / `connexionSchema` de `shared/schemas` — plus de
 * traduction vers les noms PHP (`nom_complet`, `mot_de_passe`…).
 */

export function seConnecter({ identifiant, motDePasse }) {
  return api.post('/api/v2/auth/connexion', {
    identifiant,
    motDePasse,
    appareil: decrireAppareil(),
  });
}

export function sInscrire(valeurs) {
  return api.post('/api/v2/auth/inscription', valeurs);
}

/** Validation d'un code à 6 chiffres — vérification d'e-mail ou d'appareil. */
export function verifierCode({ email, code, type }) {
  return api.post('/api/v2/auth/verification', {
    email,
    code,
    type,
    appareil: decrireAppareil(),
  });
}

/**
 * Renvoi d'un code. L'ancien code cesse aussitôt de fonctionner : il ne peut
 * jamais y avoir deux codes valides pour un même compte.
 */
export function renvoyerCode({ email, type }) {
  return api.post('/api/v2/auth/renvoi', { email, type });
}

export function seDeconnecter() {
  return api.post('/api/v2/auth/deconnexion');
}

/** Demande de réinitialisation. Répond toujours pareil, compte existant ou non. */
export function demanderReinitialisation(email) {
  return api.post('/api/v2/auth/mot-de-passe/demande', { email });
}

export function reinitialiserMotDePasse(valeurs) {
  return api.post('/api/v2/auth/mot-de-passe/reinitialisation', valeurs);
}

/** Demande d'essai par un directeur en attente d'approbation. */
export function demanderEssai() {
  return api.post('/api/v2/auth/essai');
}

export function recupererSession() {
  return api.get('/api/v2/auth/moi');
}

/** Met fin à une session déléguée et rend la main à l'administrateur. */
export function revenirAdmin() {
  return api.post('/api/v2/auth/retour-admin');
}

/** Referme la collaboration d'un administrateur : retour à l'administration. */
export function quitterCollaboration() {
  return api.post('/api/v2/auth/quitter-collaboration');
}

/**
 * Référentiel région → complexe → établissement.
 *
 * ═══ ⚠️ IL VIENT DE LA BASE, PLUS D'UN FICHIER ═══ (2026-09-02.)
 * `public/data/etablissements.json` a été supprimé : la liste se modifie
 * désormais depuis l'administration, sans redéploiement.
 *
 * ⚠️ LA ROUTE EST PUBLIQUE, et elle doit l'être : l'inscription se fait AVANT
 * toute session. Ce qui en sort est ce que le fichier exposait déjà en clair —
 * les noms officiels des établissements du réseau.
 */
export function chargerEtablissements() {
  return api.get('/api/v2/reseau').then((reponse) => reponse.reseau);
}

/**
 * Appareils connectés — une entrée par session ouverte.
 * ← api/profile/sessions.php
 */
export function chargerAppareils() {
  return api.get('/api/v2/auth/appareils');
}

/** Ferme toutes les sessions SAUF celle en cours. */
export function revoquerAutresAppareils() {
  return api.delete('/api/v2/auth/appareils');
}

/** Révoque une session : l'appareil devra se reconnecter. */
export function revoquerAppareil(id) {
  return api.delete(`/api/v2/auth/appareils/${id}`);
}

/**
 * Changement de mot de passe par un utilisateur connecté.
 *
 * Le mot de passe actuel est exigé, et les AUTRES sessions sont révoquées —
 * pas celle en cours, sinon on se déconnecterait soi-même en se protégeant.
 */
export function changerMotDePasse(valeurs) {
  return api.patch('/api/v2/auth/mot-de-passe', valeurs);
}

/** Modification des informations du profil (nom complet et email). */
export function modifierProfil(valeurs) {
  return api.patch('/api/v2/auth/profil', valeurs);
}
