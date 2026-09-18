import { api } from '@/lib/apiClient';

/**
 * Référentiel DRIF — écriture (F15, administrateur seul).
 * ← api/admin/upload_repartition.php
 *
 * ⚠️ LE PRÉFIXE `/api/v2` EST OBLIGATOIRE : sans lui, Vite répond 200 avec
 * `index.html` (repli d'application à page unique), la réponse n'est pas du
 * JSON et le garde `REPONSE_NON_JSON` du client lève. C'est le piège déjà payé
 * deux fois sur ce projet — `comptesApi.js` puis l'avancement.
 */
const BASE = '/api/v2/admin/repartitions';

const parametres = (filtres = {}) =>
  new URLSearchParams(
    Object.entries(filtres).filter(([, valeur]) => valeur !== '' && valeur != null)
  );

export function chargerLignes(filtres = {}) {
  return api.get(`${BASE}?${parametres(filtres)}`);
}

export function chargerFacettes() {
  return api.get(`${BASE}/facettes`);
}

export function chargerFilieres(filtres = {}) {
  return api.get(`${BASE}/filieres?${parametres(filtres)}`);
}

/** Les métiers de la sélection — 364 au référentiel, d'où une liste scopée. */
export function chargerMetiers(filtres = {}) {
  return api.get(`${BASE}/metiers?${parametres(filtres)}`);
}

export function creerLigne(corps) {
  return api.post(BASE, corps);
}

export function modifierLigne(id, corps) {
  return api.patch(`${BASE}/${id}`, corps);
}

export function supprimerLigne(id) {
  return api.delete(`${BASE}/${id}`);
}

/** Filière entière, ou une seule de ses années. */
export function supprimerFiliere(code, annee) {
  const suffixe = annee ? `?annee=${annee}` : '';
  return api.delete(`${BASE}/filieres/${encodeURIComponent(code)}${suffixe}`);
}

/**
 * Import d'un classeur, en deux temps.
 *
 * ⚠️ `mode: 'analyse'` N'ÉCRIT RIEN : c'est ce qui permet d'annoncer le bilan
 * avant de toucher au référentiel national.
 *
 * ⚠️ `mode: 'remplacer'` VIDE LE RÉFÉRENTIEL avant d'écrire le fichier. Le
 * nombre de lignes détruites est annoncé par l'analyse, et l'écran le fait
 * confirmer.
 */
export function importerClasseur({ fichier, mode = 'analyse', corrections = false }) {
  /* `televerser` compose le `FormData` et convertit les champs en texte — un
     booléen brut arriverait en « [object Object] » côté serveur. */
  return api.televerser(`${BASE}/import`, fichier, 'fichier', { mode, corrections });
}
