import { describe, it, expect } from 'vitest';
import { avecTotauxRepartition, totauxRepartition } from './totaux.js';

describe('totaux de la répartition', () => {
  it('additionne le présentiel des deux semestres, et le distanciel synchrone + asynchrone', () => {
    expect(
      totauxRepartition({ mhpS1: 40, mhpS2: 30, mhsynS1: 10, mhasynS1: 5, mhsynS2: 2.5, mhasynS2: 0 })
    ).toEqual({ mhpTotale: 70, mhdTotale: 17.5, mhpCalculee: true, mhdCalculee: true });
  });

  // ⚠️ 506 lignes du référentiel n'ont qu'un total : le recalcul y écrirait 0.
  it('garde un total saisi quand aucune masse semestrielle ne le détaille', () => {
    expect(totauxRepartition({ mhpS1: 0, mhpS2: 0, mhpTotale: 315, mhdTotale: 12 })).toEqual({
      mhpTotale: 315,
      mhdTotale: 12,
      mhpCalculee: false,
      mhdCalculee: false,
    });
  });

  it('remplace un total faux dès que le détail existe', () => {
    expect(avecTotauxRepartition({ mhpS1: 40, mhpS2: 30, mhpTotale: 999, module: 'X' })).toMatchObject({
      mhpTotale: 70,
      mhdTotale: 0,
      module: 'X',
    });
  });

  it('arrondit au centième', () => {
    expect(totauxRepartition({ mhpS1: 0.1, mhpS2: 0.2 }).mhpTotale).toBe(0.3);
  });
});
