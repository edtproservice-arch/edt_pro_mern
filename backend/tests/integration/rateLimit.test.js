import { describe, it, expect } from 'vitest';
import { SEUILS } from '../../src/middleware/rateLimit.js';

/**
 * Test de non-régression sur les SEUILS eux-mêmes.
 *
 * Raison d'être : en PHP, `login.php:42` appelait
 * `check_rate_limit("login_$ip", 500, 300)` — 500 tentatives par 5 minutes,
 * alors que `environment.php:88` annonçait un défaut de 5. La protection contre
 * la force brute était donc désactivée en production sans que rien ne le
 * signale. Ce test échoue si quelqu'un relâche à nouveau le seuil.
 */
describe('Seuils de limitation de débit', () => {
  it('la connexion reste à 5 tentatives par 5 minutes', () => {
    expect(SEUILS.connexion.maximum).toBe(5);
    expect(SEUILS.connexion.fenetreMs).toBe(5 * 60 * 1000);
  });

  it('les seuils restent dans des ordres de grandeur défendables', () => {
    expect(SEUILS.connexion.maximum).toBeLessThanOrEqual(10);
    expect(SEUILS.inscription.maximum).toBeLessThanOrEqual(5);
    expect(SEUILS.code.maximum).toBeLessThanOrEqual(20);
  });
});
