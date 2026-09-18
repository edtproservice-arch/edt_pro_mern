import { describe, expect, it } from 'vitest';
import {
  CRENEAUX_CONTRAINTES,
  creneauAEviter,
  indexerContraintes,
  normaliserContraintes,
  salleParDefaut,
} from './contraintesFormateurs.js';

describe('normaliserContraintes', () => {
  it('ne garde que les salles connues, sans doublon ni TEAMS', () => {
    const resultat = normaliserContraintes(
      { espaces: ['Salle 2', ' Salle 1 ', 'Salle 2', 'Fantôme', 'TEAMS'] },
      ['Salle 1', 'Salle 2', 'TEAMS']
    );
    expect(resultat.espaces).toEqual(['Salle 2', 'Salle 1']);
  });

  it('écarte le soir et les jours inconnus, trie dans l’ordre de la semaine, dédoublonne', () => {
    const resultat = normaliserContraintes({
      indisponibilites: [
        { jour: 'Mardi', seance: 'S3' },
        { jour: 'Lundi', seance: 'S2' },
        { jour: 'Lundi', seance: 'S1' },
        { jour: 'Lundi', seance: 'S2' },
        { jour: 'Lundi', seance: 'S5' },
        { jour: 'Dimanche', seance: 'S1' },
      ],
    });
    expect(resultat.indisponibilites).toEqual([
      { jour: 'Lundi', seance: 'S1' },
      { jour: 'Lundi', seance: 'S2' },
      { jour: 'Mardi', seance: 'S3' },
    ]);
  });

  it('rend des listes vides sans entrée', () => {
    expect(normaliserContraintes()).toEqual({ espaces: [], indisponibilites: [] });
    expect(CRENEAUX_CONTRAINTES).toEqual(['S1', 'S2', 'S3', 'S4']);
  });
});

describe('creneauAEviter', () => {
  const index = indexerContraintes([
    { formateur: '18494', espaces: [], indisponibilites: [{ jour: 'Lundi', seance: 'S3' }] },
    { formateur: '', espaces: ['Salle 1'] },
  ]);

  it('reconnaît un créneau déclaré, et lui seul', () => {
    expect(creneauAEviter(index, '18494', 'Lundi', 'S3')).toBe(true);
    expect(creneauAEviter(index, ' 18494 ', 'Lundi', 'S3')).toBe(true);
    expect(creneauAEviter(index, '18494', 'Lundi', 'S4')).toBe(false);
    expect(creneauAEviter(index, 'autre', 'Lundi', 'S3')).toBe(false);
  });

  it('ignore une entrée sans formateur et un index absent', () => {
    expect(index.size).toBe(1);
    expect(creneauAEviter(null, '18494', 'Lundi', 'S3')).toBe(false);
    expect(creneauAEviter(index, '', 'Lundi', 'S3')).toBe(false);
  });
});

describe('salleParDefaut', () => {
  const index = indexerContraintes([{ formateur: '15688', espaces: ['Salle 3', 'Salle 1'] }]);

  it('propose la première salle attribuée libre', () => {
    const occupees = [{ id: 'a', groupe: 'GM101', salle: 'Salle 3', formateurMatricule: 'x' }];
    expect(salleParDefaut(index, '15688', occupees)).toBe('Salle 1');
    expect(salleParDefaut(index, '15688', [])).toBe('Salle 3');
  });

  it('ne compte pas la séance qu’on modifie comme une occupation', () => {
    const occupees = [{ id: 'a', groupe: 'GM101', salle: 'Salle 3' }];
    expect(salleParDefaut(index, '15688', occupees, { id: 'a' })).toBe('Salle 3');
  });

  it('rend une chaîne vide sans salle attribuée ou libre', () => {
    expect(salleParDefaut(index, 'inconnu', [])).toBe('');
    const pleines = [
      { id: 'a', groupe: 'G1', salle: 'Salle 3' },
      { id: 'b', groupe: 'G2', salle: 'Salle 1' },
    ];
    expect(salleParDefaut(index, '15688', pleines)).toBe('');
  });
});
