import { describe, expect, it } from 'vitest';
import { vacancesEffectives } from './vacancesEffectives';

describe('vacancesEffectives', () => {
  const toussaint = { intitule: 'Toussaint', debut: '2026-10-25', fin: '2026-11-01' };
  const hiver = { intitule: 'Hiver', debut: '2027-01-24', fin: '2027-01-31' };
  const locale = { intitule: 'Moussem', debut: '2027-03-10', fin: '2027-03-12' };

  it('ajoute les vacances du réseau à celles de l’établissement', () => {
    expect(vacancesEffectives({ nationales: [toussaint], vacances: [locale] })).toEqual([toussaint, locale]);
  });

  it('écarte une période du réseau par son nom, sans tenir compte de la casse', () => {
    expect(vacancesEffectives({ nationales: [toussaint, hiver], ecartees: [' hiver '], vacances: [] })).toEqual([
      toussaint,
    ]);
  });

  it('ne rend qu’une fois une période recopiée dans les deux listes', () => {
    expect(vacancesEffectives({ nationales: [toussaint], vacances: [{ ...toussaint, intitule: 'Copie' }] })).toHaveLength(1);
  });

  it('accepte une réponse absente', () => {
    expect(vacancesEffectives(undefined)).toEqual([]);
  });
});
