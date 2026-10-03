import { describe, expect, it } from 'vitest';
import { horsSalleImposee, sallesImposees } from './sallesModule.js';
import { salleParDefaut } from './contraintesFormateurs.js';

describe('sallesImposees', () => {
  const table = { 'GM101||M101': ['b02'], 'GM102||M101': ['A12'], 'GM101||M102': ['Disparue'] };
  const espaces = ['A12', 'B02'];

  it('rend les salles du (groupe, module), avec l’orthographe de l’établissement', () => {
    expect(sallesImposees(table, 'GM101', 'M101', espaces)).toEqual(['B02']);
  });

  it('cumule les salles des membres d’une fusion', () => {
    expect(sallesImposees(table, 'GM101 GM102', 'M101', espaces)).toEqual(['B02', 'A12']);
  });

  it('écarte une salle qui n’existe plus', () => {
    expect(sallesImposees(table, 'GM101', 'M102', espaces)).toEqual([]);
  });

  it('lit une Map comme un objet', () => {
    expect(sallesImposees(new Map(Object.entries(table)), 'GM101', 'M101', espaces)).toEqual(['B02']);
  });
});

describe('horsSalleImposee', () => {
  it('signale un local hors des salles imposées', () => {
    expect(horsSalleImposee('A12', ['B02'])).toBe(true);
    expect(horsSalleImposee('b02', ['B02'])).toBe(false);
  });

  it('ne refuse ni l’absence de salle, ni TEAMS, ni un module sans consigne', () => {
    expect(horsSalleImposee('', ['B02'])).toBe(false);
    expect(horsSalleImposee('TEAMS', ['B02'])).toBe(false);
    expect(horsSalleImposee('A12', [])).toBe(false);
  });
});

describe('salleParDefaut — avec des salles imposées', () => {
  const index = new Map([['9863', { espaces: ['A12'] }]]);

  it('propose la salle du module plutôt que celle du formateur', () => {
    expect(salleParDefaut(index, '9863', [], { imposees: ['B02'] })).toBe('B02');
  });

  it('rend vide plutôt qu’une salle du formateur si la salle du module est prise', () => {
    const prise = [{ id: 'x', salle: 'B02', groupe: 'GM102', formateurMatricule: '1' }];
    expect(salleParDefaut(index, '9863', prise, { imposees: ['B02'] })).toBe('');
  });
});
