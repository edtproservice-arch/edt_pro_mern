import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Confronte les TROIS implémentations de normalisation des noms de formateurs
 * sur le corpus réel, et liste les divergences.
 *
 *   node outils/caracterisation/comparer-implementations.mjs
 *
 * Les sorties PHP viennent des fixtures générées par
 * `generer-fixtures-noms.php`. Les variantes JavaScript sont recopiées
 * VERBATIM depuis public/emploi.html — surtout ne pas les « corriger » ici :
 * l'objectif est de constater ce que fait le code en production, pas ce qu'il
 * devrait faire.
 */
const ici = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(ici, '../../shared/src/domain/formateurs/__fixtures__');

// --- Copies conformes de public/emploi.html ---------------------------------

/** ← emploi.html, getBaseNameJS() */
function getBaseNameJS(nomComplet) {
  const words = String(nomComplet || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0];
  if (words.length === 3) {
    return words[1].length <= 3 ? `${words[1]} ${words[2]}` : words[2];
  }
  return words[words.length - 1];
}

/** ← emploi.html:6003, getFormattedName() — noter l'absence de mise en majuscules */
function getFormattedNameJS(name) {
  if (!name) return '';
  const words = name.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length <= 1) return name;
  if (words.length === 2) return words[1];
  const avantDernier = words[words.length - 2];
  const dernier = words[words.length - 1];
  return avantDernier.length < 4 ? `${avantDernier} ${dernier}` : dernier;
}

// --- Comparaison ------------------------------------------------------------

const { cas } = JSON.parse(fs.readFileSync(path.join(fixtures, 'noms-unitaires.json'), 'utf8'));

const divergences = [];

for (const cible of cas) {
  const resultats = {
    'PHP getBaseName': cible.getBaseName,
    'PHP getFormattedName': cible.getFormattedName,
    'JS getBaseNameJS': getBaseNameJS(cible.entree),
    'JS getFormattedName': getFormattedNameJS(cible.entree),
  };

  const distinctes = new Set(Object.values(resultats));
  if (distinctes.size > 1) {
    divergences.push({ entree: cible.entree, mots: cible.entree.split(/\s+/).length, resultats });
  }
}

console.log(`corpus              : ${cas.length} noms`);
console.log(`noms divergents     : ${divergences.length}`);
console.log('');

for (const d of divergences) {
  console.log(`« ${d.entree} »  (${d.mots} mots)`);
  for (const [impl, valeur] of Object.entries(d.resultats)) {
    console.log(`    ${impl.padEnd(22)} → ${valeur}`);
  }
  console.log('');
}

// Récapitulatif par paire d'implémentations : laquelle s'écarte le plus ?
const implementations = Object.keys(divergences[0]?.resultats ?? {});
if (implementations.length) {
  console.log('--- accord deux à deux sur le corpus entier ---');
  for (let i = 0; i < implementations.length; i += 1) {
    for (let j = i + 1; j < implementations.length; j += 1) {
      const a = implementations[i];
      const b = implementations[j];
      const desaccords = cas.filter((c) => {
        const r = {
          'PHP getBaseName': c.getBaseName,
          'PHP getFormattedName': c.getFormattedName,
          'JS getBaseNameJS': getBaseNameJS(c.entree),
          'JS getFormattedName': getFormattedNameJS(c.entree),
        };
        return r[a] !== r[b];
      }).length;
      console.log(`  ${a.padEnd(22)} vs ${b.padEnd(22)} : ${desaccords} désaccord(s)`);
    }
  }
}

fs.writeFileSync(
  path.join(fixtures, 'divergences.json'),
  JSON.stringify({ genereLe: new Date().toISOString(), divergences }, null, 2)
);
