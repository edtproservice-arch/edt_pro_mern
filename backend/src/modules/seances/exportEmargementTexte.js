import { dateFr } from './exportGlobalTexte.js';

/** `Emargement_Lundi_S4_2026-2027.docx` — sans accent ni espace, pour tout système de fichiers. */
export function nomFichierEmargement({ jour, semaineLabel, anneeScolaire }, extension) {
  const jourSansAccent = String(jour ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return `Emargement_${jourSansAccent}_${semaineLabel}_${anneeScolaire}-${anneeScolaire + 1}.${extension}`;
}

/**
 * La décomposition du taux global, sous lui dans la cellule Taux (2026-10-26) :
 * « Présentiel : … » puis « Synchrone : … ». UNE écriture, pour le Word (donc
 * le PDF) et l'Excel.
 *
 * ⚠️ SEULEMENT QUAND LE MODULE A LES DEUX MASSES : avec une seule, le détail
 *    répéterait le global mot pour mot.
 */
export function lignesParType(ligne) {
  if (!ligne?.presentiel || !ligne?.synchrone) return [];
  const ecrire = (libelle, { taux, pose, prevu }) => `${libelle} : ${taux}% (${pose}h / ${prevu}h)`;
  return [ecrire('Présentiel', ligne.presentiel), ecrire('Synchrone', ligne.synchrone)];
}

/**
 * Toutes les lignes de la cellule Taux (maquette du porteur, 2026-10-26) :
 * « Global : 22% (30h / 135h) », puis la décomposition quand elle a un sens.
 */
export const lignesTaux = (ligne) => [
  `Global : ${ligne.taux}% (${ligne.pose}h / ${ligne.prevu}h)`,
  ...lignesParType(ligne),
];

export { dateFr };
