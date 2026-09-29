import { describe, expect, it } from 'vitest';

import { adresseCase } from './useCaseCiblee';

describe('adresseCase', () => {
  it('mène à la case : groupe, module et semaine dans l’adresse', () => {
    expect(adresseCase({ groupe: 'GM103', module: 'M101', semaine: 4 })).toBe(
      '/app/parametres/chronogramme?groupe=GM103&module=M101&semaine=4'
    );
  });

  it('encode les groupes à espaces et parenthèses (« ACADA101 (FQ) »)', () => {
    const adresse = adresseCase({ groupe: 'ACADA101 (FQ)', module: 'M1', semaine: 9 });
    expect(new URL(adresse, 'http://x').searchParams.get('groupe')).toBe('ACADA101 (FQ)');
  });
});
