import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/apiClient', () => ({ api: { post: vi.fn(async () => ({ resultats: [] })) } }));

const { api } = await import('@/lib/apiClient');
const { ecrireLot } = await import('./api.js');

const ID_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ID_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const seance = (id, creneau) => ({
  id,
  jour: 'Lundi',
  seance: creneau,
  periode: 'jour',
  formateurMatricule: '15688',
  groupe: 'GM101',
  module: 'M101',
  salle: 'A12',
  statut: 'planifie',
});

describe('ecrireLot', () => {
  it('⚠️ envoie la SECONDE séance d’une permutation (2026-10-09)', async () => {
    // Oubliée, le serveur rejetait tout le lot : « Données invalides ».
    await ecrireLot('2026-W5', [
      { type: 'permuter', cle: 'x', cleSource: 'y', seance: seance(ID_A, 'S2'), autre: seance(ID_B, 'S1') },
    ]);

    const [, corps] = api.post.mock.calls.at(-1);
    expect(corps.operations[0].autre).toMatchObject({ id: ID_B, seance: 'S1' });
    expect(corps.operations[0].seance).toMatchObject({ id: ID_A, seance: 'S2' });
  });

  it('retire un identifiant provisoire, de chacune des deux séances', async () => {
    await ecrireLot('2026-W5', [
      { type: 'poser', cle: 'x', seance: seance('provisoire-Lundi-S1-jour-15688', 'S1') },
    ]);

    const [, corps] = api.post.mock.calls.at(-1);
    expect(corps.operations[0].seance.id).toBeUndefined();
  });
});
