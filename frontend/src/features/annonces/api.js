import { api } from '@/lib/apiClient';

/**
 * Annonces du bandeau passant, doublées en messagerie (2026-10-10).
 * La CIBLE suit le rôle de l'auteur côté serveur : admin → directeurs,
 * directeur → formateurs, gestionnaire → stagiaires.
 */

/** Directeur ou gestionnaire — l'établissement de la session. */
export const publierAnnonce = (annonce) => api.post('/api/v2/annonces', annonce);

/** Administrateur — `etablissementIds` vide : tout le réseau. */
export const publierAnnonceAdmin = (annonce) => api.post('/api/v2/annonces/admin', annonce);

export const chargerEtablissementsAnnonce = () => api.get('/api/v2/annonces/admin/etablissements');

/** Les formateurs (directeur) ou les groupes (gestionnaire) qu'on peut viser. */
export const chargerChoixAnnonce = () => api.get('/api/v2/annonces/choix');

export const chargerAnnoncesPubliees = () => api.get('/api/v2/annonces/publiees');

export const retirerAnnonce = (id) => api.delete(`/api/v2/annonces/${id}`);

/** Les annonces en cours du compte connecté — celles de son bandeau. */
export const chargerMesAnnonces = () => api.get('/api/v2/annonces/mes');
