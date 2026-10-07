/** Petits calculs communs aux trois formats de l'achèvement des modules. */

/**
 * Le poids de chaque colonne dans la largeur du tableau : l'intitulé du module
 * prend la place, les badges d'une lettre presque rien.
 */
const POIDS = {
  groupe: 9,
  module: 7,
  intitule: 24,
  formateur: 14,
  semestre: 5,
  regional: 5,
  debut: 7,
  fin: 9,
  source: 8,
  affecte: 7,
  realise: 7,
  taux: 6,
  statut: 7,
};

/** Les largeurs, en unités de `total`, proportionnelles aux poids. */
export function largeursColonnes(colonnes, total) {
  const poids = colonnes.map((colonne) => POIDS[colonne.id] ?? 8);
  const somme = poids.reduce((a, b) => a + b, 0);
  return poids.map((p) => Math.floor((p / somme) * total));
}

/** Largeur Excel (en caractères) d'une colonne. */
export const largeurExcel = (id) => Math.max(8, Math.round((POIDS[id] ?? 8) * 1.6));

export const nomFichierAchevement = (extension) => `Achevement_modules.${extension}`;

/** « Situation au 14/09/2026 » quand la page est rembobinée, rien sinon. */
export function libelleSituation(dateObservee) {
  if (!dateObservee) return null;
  const [annee, mois, jour] = String(dateObservee).slice(0, 10).split('-');
  return jour ? `Situation au ${jour}/${mois}/${annee}` : null;
}
