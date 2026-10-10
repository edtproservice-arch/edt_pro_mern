import { describe, expect, it } from 'vitest';

import { semainesTouchees } from './semainesProtegees';

describe('semainesTouchees — ce qu’une écriture du chronogramme change', () => {
  const avant = {
    M1: { 3: { heures: 5, type: 'P' }, 4: { heures: 2.5, type: 'P' } },
    M2: { 5: { heures: 5, type: 'S' } },
  };

  it('rien de changé, rien de touché', () => {
    expect([...semainesTouchees(avant, avant)]).toEqual([]);
  });

  it('une valeur modifiée, ajoutée ou retirée', () => {
    const apres = {
      M1: { 3: { heures: 7.5, type: 'P' } }, // S3 changée, S4 retirée
      M2: { 5: { heures: 5, type: 'S' }, 9: { heures: 2.5, type: 'P' } }, // S9 ajoutée
    };
    expect([...semainesTouchees(avant, apres)].sort((a, b) => a - b)).toEqual([3, 4, 9]);
  });

  it('un module entier ajouté ou retiré', () => {
    expect([...semainesTouchees(avant, { M1: avant.M1 })]).toEqual([5]);
  });
});
