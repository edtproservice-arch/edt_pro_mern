import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';

/**
 * CORS : le front (Vercel) et l'API (Railway) sont sur deux origines.
 *
 * ⚠️ LE PRÉVOL DOIT SE MÉMORISER. Sans `Access-Control-Max-Age`, le navigateur ne
 * le retient que quelques secondes : chaque requête coûte alors DEUX allers-
 * retours au lieu d'un — ce que l'hébergé paie et que le local (même origine,
 * proxy de Vite) ne voit jamais.
 */
const app = createApp();

describe('CORS — prévol', () => {
  it('⚠️ répond au prévol d’une origine autorisée, et le fait mémoriser', async () => {
    const reponse = await request(app)
      .options('/api/v2/seances/2026-W3/lot')
      .set('Origin', 'https://front.test')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-annee-scolaire');

    expect(reponse.status).toBe(204);
    expect(reponse.headers['access-control-allow-origin']).toBe('https://front.test');
    expect(reponse.headers['access-control-allow-credentials']).toBe('true');
    expect(Number(reponse.headers['access-control-max-age'])).toBeGreaterThanOrEqual(3600);
  });

  it('⚠️ n’accorde RIEN à une origine inconnue', async () => {
    // Le CORS permissif de l'application PHP reflétait n'importe quelle origine
    // avec `credentials: true` : il ne doit surtout pas revenir.
    const reponse = await request(app)
      .options('/api/v2/seances/2026-W3/lot')
      .set('Origin', 'https://pirate.test');

    expect(reponse.headers['access-control-allow-origin']).toBeUndefined();
    expect(reponse.headers['access-control-max-age']).toBeUndefined();
  });
});
