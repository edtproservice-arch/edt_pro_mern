/**
 * La semaine CHOISIE à la main, commune à tous les écrans d'emploi du temps.
 *
 * ═══ (2026-10-16, demande du porteur : « garde la semaine sélectionnée même
 * après changement de page — l'Édition suit l'Emploi — et la semaine en cours
 * juste au démarrage, si je me déconnecte et me reconnecte ») ═══
 * Chaque page tenait son choix dans son propre état : quitter l'Emploi pour
 * l'Édition ramenait à la semaine en cours.
 *
 * ⚠️ `null` VEUT DIRE « SUIVRE LA SEMAINE EN COURS », pas « aucune semaine » :
 *    revenir sur la semaine courante efface le choix, pour que la bascule du
 *    samedi 6 h 30 (`useSemaineSuivie`) reprenne la main.
 *
 * ⚠️ `sessionStorage`, PAS `localStorage` : le choix survit au rechargement de
 *    l'onglet, pas à un nouvel onglet ni au lendemain. Et la connexion comme la
 *    déconnexion l'effacent (`features/auth/api.js`) : une nouvelle session
 *    s'ouvre sur la semaine en cours.
 *
 * ⚠️ LA VARIABLE DU MODULE DOUBLE LE STOCKAGE : en navigation privée stricte ou
 *    stockage bloqué, l'accès lève — le choix tient alors au moins d'une page à
 *    l'autre, tant que l'onglet n'est pas rechargé.
 */
const CLE = 'edtpro.semaine-choisie';
const FORMAT = /^\d{4}-W\d{1,3}$/i;

let enMemoire = null;

export function lireSemaineChoisie() {
  try {
    const valeur = sessionStorage.getItem(CLE);
    return valeur && FORMAT.test(valeur) ? valeur : null;
  } catch {
    return enMemoire;
  }
}

/** `null` (ou la semaine en cours, que l'appelant traduit en `null`) efface le choix. */
export function retenirSemaineChoisie(semaine) {
  enMemoire = semaine && FORMAT.test(semaine) ? semaine : null;
  try {
    if (enMemoire) sessionStorage.setItem(CLE, enMemoire);
    else sessionStorage.removeItem(CLE);
  } catch {
    /* stockage indisponible : la variable du module suffit */
  }
}

export function oublierSemaineChoisie() {
  retenirSemaineChoisie(null);
}
