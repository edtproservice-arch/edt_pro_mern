import { defineConfig } from 'vitest/config';

/**
 * Le seuil de couverture ne s'applique qu'à `src/domain` — c'est la règle n°4
 * du §5bis du plan : sans typage statique, les tests sont le seul garde-fou sur
 * les règles métier, et ce sont elles qui cassent (F4, F5, F6).
 *
 * Le reste du paquet (schémas Zod, constantes) est déclaratif : y exiger 90 %
 * ferait du bruit sans rien protéger.
 */
export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.js'],
      exclude: ['**/*.test.js', '**/index.js', '**/__fixtures__/**'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
