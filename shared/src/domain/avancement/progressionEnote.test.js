import { describe, expect, it } from 'vitest';
import { pointsEnote, progressionEnote } from './progression.js';

const ligne = (prevu, realise) => ({
  groupe: 'G1',
  fusionGroupe: '',
  module: 'M101',
  prevuPresentiel: prevu,
  prevuSynchrone: 0,
  realisePresentiel: realise,
  realiseSynchrone: 0,
});

describe('courbe de la face e-note', () => {
  it('donne à chaque semaine le taux déclaré de son dernier dépôt', () => {
    const semaineDe = (date) => (date.getDate() < 10 ? 1 : 3);
    const points = pointsEnote(
      [
        { importeLe: new Date('2026-09-05T09:00:00'), lignes: [ligne(100, 5)] },
        { importeLe: new Date('2026-09-21T09:00:00'), lignes: [ligne(100, 10)] },
        { importeLe: new Date('2026-09-22T09:00:00'), lignes: [ligne(100, 12)] },
      ],
      semaineDe
    );

    expect(points.map(({ numero, avancement }) => [numero, avancement])).toEqual([
      [1, 5],
      [3, 12],
    ]);
  });

  it('tient le dernier état entre deux dépôts et s’arrête à la semaine en cours', () => {
    const progression = [1, 2, 3, 4, 5].map((numero) => ({ numero, avancement: 99, regional: numero }));
    const courbe = progressionEnote(
      progression,
      [
        { numero: 2, avancement: 5 },
        { numero: 3, avancement: 12 },
      ],
      4
    );

    expect(courbe.map((point) => point.avancement)).toEqual([null, 5, 12, 12, null]);
    expect(courbe.map((point) => point.regional)).toEqual([1, 2, 3, 4, 5]);
  });
});
