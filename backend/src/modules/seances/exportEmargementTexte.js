import { dateFr } from './exportGlobalTexte.js';

/** `Emargement_Lundi_S4_2026-2027.docx` — sans accent ni espace, pour tout système de fichiers. */
export function nomFichierEmargement({ jour, semaineLabel, anneeScolaire }, extension) {
  const jourSansAccent = String(jour ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return `Emargement_${jourSansAccent}_${semaineLabel}_${anneeScolaire}-${anneeScolaire + 1}.${extension}`;
}

export { dateFr };
