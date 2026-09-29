import { describe, it, expect } from 'vitest';
import { calculerTrajectoire } from './TableauDeBordAccueil';

/** 39 semaines, +2 points par semaine active, vacances en S5. */
function progression(jusqua) {
  let cumul = 0;
  return Array.from({ length: 39 }, (_, rang) => {
    const numero = rang + 1;
    const vacances = numero === 5;
    if (numero <= jusqua && !vacances) cumul += 2;
    return { numero, libelle: `S${numero}`, avancement: cumul, regional: numero * 2.5, vacances };
  });
}

describe('calculerTrajectoire', () => {
  it('projette au rythme récent, sans compter les vacances', () => {
    const t = calculerTrajectoire(progression(6), 6);
    // S3 → S6 : 3 semaines actives (S5 en vacances), +6 points
    expect(t.actuel).toBe(10);
    expect(t.rythme).toBe(2);
    expect(t.restantes).toBe(33);
    expect(t.fin).toBe(76);
    expect(t.ecart).toBe(-5);
  });

  it('plafonne la projection à 100 %', () => {
    const points = progression(6).map((p) => ({ ...p, avancement: p.avancement * 5 }));
    expect(calculerTrajectoire(points, 6).fin).toBe(100);
  });

  it('ne projette rien la première semaine', () => {
    const t = calculerTrajectoire(progression(1), 1);
    expect(t.rythme).toBeNull();
    expect(t.fin).toBeNull();
  });

  it('trace la projection à partir de la semaine en cours seulement', () => {
    const { points } = calculerTrajectoire(progression(6), 6);
    expect(points[4].projection).toBeNull();
    expect(points[5].projection).toBe(10);
    expect(points[6].avancement).toBeNull();
  });
});
