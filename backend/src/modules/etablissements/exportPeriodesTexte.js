/** Petits textes communs aux trois formats de l'export des périodes (stages, formations). */

export const TYPES_PERIODES = {
  stages: {
    titre: 'Périodes de stage',
    colonneSujet: 'Groupe',
    colonneDetail: 'Mode',
    sujets: 'groupe(s)',
    fichier: 'Periodes_stage',
  },
  // « Congés et formations » (2026-10-11) : chaque période porte son MOTIF, une colonne de plus.
  formations: {
    titre: 'Congés et formations des formateurs',
    colonneSujet: 'Formateur',
    colonneDetail: 'Matricule',
    colonneMotif: 'Motif',
    sujets: 'formateur(s)',
    fichier: 'Conges_et_formations',
  },
};

/** « AAAA-MM-JJ » → « JJ/MM/AAAA » — sans `Date`, donc sans décalage de fuseau. */
export function dateFr(jour) {
  const [annee, mois, date] = String(jour).split('-');
  return `${date}/${mois}/${annee}`;
}

/** Jours calendaires, bornes comprises — la règle de l'écran (`ListePeriodes.compter`). */
export function nombreJours({ debut, fin }) {
  const ecart = Date.UTC(...decouper(fin)) - Date.UTC(...decouper(debut));
  return Math.round(ecart / 86400000) + 1;
}

function decouper(jour) {
  const [annee, mois, date] = String(jour).split('-').map(Number);
  return [annee, mois - 1, date];
}

/** « Periodes_stage_2026-2027.docx » */
export function nomFichierPeriodes(type, anneeScolaire, extension) {
  const annee = Number.isInteger(anneeScolaire) ? `_${anneeScolaire}-${anneeScolaire + 1}` : '';
  return `${TYPES_PERIODES[type].fichier}${annee}.${extension}`;
}
