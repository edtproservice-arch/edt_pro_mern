import { describe, expect, it } from 'vitest';
import { cleCasePresentiel, cleCaseSynchrone, cleEnTeteEnsemble, repliCase } from './casesCarte';

// La clé d'ensemble du domaine contient elle-même `||`.
const ENSEMBLE = 'GC_GE_TS||1||Résidentiel';

describe('cases de la carte', () => {
  it('replie une cellule présentielle sur l’en-tête de son ensemble', () => {
    const cle = cleCasePresentiel(ENSEMBLE, 'GE101 (GC)', 'M101');
    expect(repliCase(cle)).toBe(cleEnTeteEnsemble(ENSEMBLE));
  });

  it('replie un bloc synchrone sur l’en-tête de son ensemble', () => {
    expect(repliCase(cleCaseSynchrone(ENSEMBLE, 'EGTS104'))).toBe(`E::${ENSEMBLE}`);
  });

  it('ne replie ni un en-tête, ni une clé inconnue', () => {
    expect(repliCase(cleEnTeteEnsemble(ENSEMBLE))).toBeNull();
    expect(repliCase('GM101||M101||3')).toBeNull();
    expect(repliCase(undefined)).toBeNull();
  });

  it('garde des clés distinctes pour deux groupes homonymes de deux filières', () => {
    expect(cleCasePresentiel('GC_GE_TS||1||Résidentiel', 'GE101', 'M101')).not.toBe(
      cleCasePresentiel('GE_GE_TS||1||Résidentiel', 'GE101', 'M101')
    );
  });
});
