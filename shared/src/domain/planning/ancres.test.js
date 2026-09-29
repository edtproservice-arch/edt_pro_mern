import { afterEach, describe, expect, it } from 'vitest';

import { oublierRentrees, rentreesPour, rentreesRetenues, retenirRentrees } from './ancres.js';
import { lundiPremiereSemaine } from './anneeScolaire.js';
import { datesDeLaSemaine, semaineDe, valeurSemaine } from './semaines.js';

/** Les rentrées réelles de 2026-2027 : 2ᵉ et 3ᵉ années le 7, 1ʳᵉ le 11. */
const RENTREES_2026 = [
  { anneeFormation: 1, date: '2026-09-11' },
  { anneeFormation: 2, date: '2026-09-07' },
  { anneeFormation: 3, date: '2026-09-07' },
];
const jour = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

afterEach(() => oublierRentrees());

describe('ancres — les rentrées retenues par année scolaire', () => {
  it('sans rien de retenu, S1 reste la semaine du 1er septembre', () => {
    expect(jour(lundiPremiereSemaine(2026))).toBe('2026-08-31');
  });

  it('⚠️ retenues, elles valent pour TOUT calcul qui ne les reçoit pas (défaut du 2026-09-28)', () => {
    retenirRentrees(2026, RENTREES_2026);
    expect(jour(lundiPremiereSemaine(2026))).toBe('2026-09-07');
    // L'en-tête de la grille : lundi de S1 = 7 septembre, plus le 31 août.
    expect(jour(datesDeLaSemaine('2026-W1')[0])).toBe('2026-09-07');
    expect(valeurSemaine(new Date(2026, 8, 28))).toBe('2026-W4');
    expect(semaineDe(new Date(2026, 8, 8)).numero).toBe(1);
  });

  it('une rentrée EXPLICITE l’emporte sur la retenue', () => {
    retenirRentrees(2026, RENTREES_2026);
    expect(jour(lundiPremiereSemaine(2026, [{ anneeFormation: 1, date: '2026-09-14' }]))).toBe(
      '2026-09-14'
    );
    expect(rentreesPour(2026, [])).toEqual(rentreesRetenues(2026));
  });

  it('chaque année scolaire a son ancre', () => {
    retenirRentrees(2026, RENTREES_2026);
    expect(jour(lundiPremiereSemaine(2027))).toBe('2027-08-30');
  });

  it('retenir remplace, et une liste vide revient au 1er septembre', () => {
    retenirRentrees(2026, RENTREES_2026);
    retenirRentrees(2026, []);
    expect(jour(lundiPremiereSemaine(2026))).toBe('2026-08-31');
  });

  it('refuse une année ou une liste malformée', () => {
    expect(() => retenirRentrees('2026', [])).toThrow(TypeError);
    expect(() => retenirRentrees(2026, null)).toThrow(TypeError);
  });
});
