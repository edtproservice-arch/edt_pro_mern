import { api } from '@/lib/apiClient';

/**
 * Stagiaires — import Konosys et consultation (F11).
 * ← api/students/upload.php + get.php
 */

function parametres(filtres = {}) {
  const requete = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(filtres)) {
    if (String(valeur ?? '').trim() !== '') requete.set(cle, valeur);
  }
  return requete.toString();
}

export function chargerStagiaires(filtres) {
  return api.get(`/api/v2/stagiaires?${parametres(filtres)}`);
}

/** Valeurs des listes déroulantes, calculées par le serveur. */
export function chargerFiltresStagiaires(filtres) {
  return api.get(`/api/v2/stagiaires/filtres?${parametres(filtres)}`);
}

/** Effectifs par filière et par groupe — ce que les cartes affichent. */
export function chargerStatistiquesStagiaires() {
  return api.get('/api/v2/stagiaires/statistiques');
}

/** ⚠️ REMPLACE tous les stagiaires de l'établissement. */
export function importerKonosys(fichier) {
  return api.televerser('/api/v2/stagiaires/import', fichier);
}
