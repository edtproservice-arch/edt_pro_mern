import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';

/**
 * Vérifie que l'app se monte sans serveur HTTP — la propriété qui rend toute
 * l'API testable, et qui manquait à l'architecture PHP.
 */
describe('GET /api/v2/health', () => {
  it('répond ok', async () => {
    const response = await request(createApp()).get('/api/v2/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, status: 'ok' });
  });

  it('renvoie du JSON sur une route inconnue, pas du HTML', async () => {
    const response = await request(createApp()).get('/api/v2/inexistant');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });
});
