import { dateFr } from './exportGlobalTexte.js';

/** `Emargement_Lundi_S4_2026-2027.docx` — sans accent ni espace, pour tout système de fichiers. */
export function nomFichierEmargement({ jour, semaineLabel, anneeScolaire }, extension) {
  const jourSansAccent = String(jour ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return `Emargement_${jourSansAccent}_${semaineLabel}_${anneeScolaire}-${anneeScolaire + 1}.${extension}`;
}

/**
 * La ligne « Synchrone » de la cellule Taux, ou `null` sans masse synchrone
 * (2026-10-26) — UNE écriture, pour le Word (donc le PDF) et l'Excel.
 */
export const libelleSynchrone = (ligne) =>
  ligne?.synchrone
    ? `Synchrone : ${ligne.synchrone.taux}% (${ligne.synchrone.pose}h / ${ligne.synchrone.prevu}h)`
    : null;

export { dateFr };
