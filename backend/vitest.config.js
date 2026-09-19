import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./tests/setup.js'],
    // Les variables sont posées ici, donc AVANT l'import de src/config/env.js,
    // qui valide sa configuration au chargement et arrête le processus si une
    // clé manque.
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/placeholder',
      JWT_ACCESS_SECRET: 'secret-de-test-access-suffisamment-long-pour-zod',
      JWT_REFRESH_SECRET: 'secret-de-test-refresh-suffisamment-long-pour-zod',
      HTTP_ORIGINES: 'https://front.test',
    },
    // Chaque fichier de test a sa propre base en mémoire : pas d'interférence.
    pool: 'forks',
    // Démarrer trop d'instances MongoDB en mémoire à la fois sature le poste et
    // provoque des échecs intermittents sans rapport avec le code testé.
    // `minForks` doit être fixé aussi : sa valeur par défaut, déduite du nombre
    // de cœurs, dépasserait `maxForks` et Vitest refuserait de démarrer.
    poolOptions: { forks: { minForks: 1, maxForks: 3 } },
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
