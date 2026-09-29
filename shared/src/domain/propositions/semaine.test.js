import { describe, it, expect } from 'vitest';
import { semaineEstPubliee, semaineProposable } from './semaine.js';

// Mercredi 23 septembre 2026 : la semaine suivante est la S5 de 2026-2027.
const MERCREDI = new Date(2026, 8, 23, 10, 0);

describe('semaineProposable — toujours la semaine suivante', () => {
  it('rend la semaine suivante de l’année active, ouverte', () => {
    expect(semaineProposable(2026, { maintenant: MERCREDI })).toEqual({
      semaine: '2026-W5',
      ouverte: true,
      motif: null,
    });
  });

  it('le dimanche appartient à la semaine qui s’achève : +7 j tombe dans la suivante', () => {
    // Dimanche 27/09 est en S4 ; +7 j → dimanche 04/10, S5.
    expect(semaineProposable(2026, { maintenant: new Date(2026, 8, 27, 20, 0) }).semaine).toBe('2026-W5');
  });

  it('se ferme quand la semaine suivante est celle qui est publiée', () => {
    expect(semaineProposable(2026, { maintenant: MERCREDI, semainePubliee: '2026-W5' })).toMatchObject({
      ouverte: false,
      motif: 'publiee',
    });
  });

  it('se ferme aussi quand la publication l’a DÉPASSÉE', () => {
    expect(semaineProposable(2026, { maintenant: MERCREDI, semainePubliee: '2026-W6' }).motif).toBe('publiee');
  });

  it('reste ouverte quand la publication est antérieure', () => {
    expect(semaineProposable(2026, { maintenant: MERCREDI, semainePubliee: '2026-W4' }).ouverte).toBe(true);
  });

  it('se ferme quand la semaine suivante sort de l’année active', () => {
    expect(semaineProposable(2026, { maintenant: new Date(2027, 7, 25) })).toMatchObject({
      ouverte: false,
      motif: 'hors_annee',
    });
  });

  it('refuse une année ou une date illisible', () => {
    expect(() => semaineProposable('2026')).toThrow(TypeError);
    expect(() => semaineProposable(2026, { maintenant: new Date('x') })).toThrow(TypeError);
  });
});

describe('semaineEstPubliee', () => {
  it('compare des semaines, pas des chaînes (zéro de remplissage compris)', () => {
    expect(semaineEstPubliee('2026-W5', '2026-W005')).toBe(true);
    expect(semaineEstPubliee('2026-W10', '2026-W9')).toBe(false);
  });

  it('une publication absente ou illisible ne ferme rien', () => {
    expect(semaineEstPubliee('2026-W5', null)).toBe(false);
    expect(semaineEstPubliee('2026-W5', 'illisible')).toBe(false);
    expect(semaineEstPubliee('illisible', '2026-W9')).toBe(false);
  });
});
