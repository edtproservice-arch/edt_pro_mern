/**
 * ⚠️ LES NOMBRES DU FICHIER E-NOTE ARRIVENT EN TEXTE, ET PARFOIS À LA VIRGULE.
 * ← `parseNumber()` de `get_completion_status.php`, qui traite les deux
 * séparateurs. Une valeur « 12,5 » lue par `Number()` rend `NaN`, et la masse du
 * module disparaît de l'agrégat sans que rien ne le signale.
 *
 * ⚠️ IL VIT DANS SON PROPRE MODULE parce que DEUX fichiers en ont besoin —
 * `enote.js` pour les masses, `semestre.js` pour les parts S1/S2. Le laisser
 * dans `enote.js` aurait créé un cycle d'imports (celui-ci importe déjà
 * `semestre.js`) : ESM le tolère, jusqu'au jour où l'ordre d'évaluation change
 * et rend la fonction `undefined` sans erreur. Le piège est déjà consigné.
 *
 * ⚠️ ZÉRO, JAMAIS `NaN` : une cellule vide ou fautive doit se retirer du calcul,
 * pas le contaminer — un seul `NaN` rend le total entier illisible.
 */
export function nombre(valeur) {
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : 0;

  const brut = String(valeur ?? '')
    .replace(/\s/gu, '')
    .replace(',', '.');
  const lu = Number.parseFloat(brut);
  return Number.isFinite(lu) ? lu : 0;
}
