import { describe, it, expect } from 'vitest';
import { massesGlobalesParGroupe, referenceDeLAxe } from './references.js';

const ligne = (surcharges = {}) => ({
  groupe: 'GM101',
  module: 'M101',
  masseDrif: 60,
  ...surcharges,
});

describe('massesGlobalesParGroupe', () => {
  it('somme les masses du référentiel par groupe', () => {
    const masses = massesGlobalesParGroupe([
      ligne({ module: 'M101', masseDrif: 60 }),
      ligne({ module: 'M102', masseDrif: 40 }),
      ligne({ groupe: 'GM102', masseDrif: 30 }),
    ]);

    expect(masses).toEqual({ GM101: 100, GM102: 30 });
  });

  /*
   * ⚠️ UNE LIGNE SANS MASSE DÉCLARÉE N'EST PAS UNE MASSE DE ZÉRO : elle
   * n'apporte rien au plafond. La compter créerait une entrée à 0 pour un groupe
   * dont on ne sait rien, et la courbe plongerait à zéro sur ce point.
   */
  it('ignore une ligne sans masse plutôt que de créer une entrée nulle', () => {
    expect(massesGlobalesParGroupe([ligne({ masseDrif: 0 })])).toEqual({});
    expect(massesGlobalesParGroupe([ligne({ masseDrif: undefined })])).toEqual({});
  });

  it('ignore une ligne sans groupe', () => {
    expect(massesGlobalesParGroupe([ligne({ groupe: '' })])).toEqual({});
  });

  it('rend un objet vide plutôt que de lever, sans ligne', () => {
    expect(massesGlobalesParGroupe()).toEqual({});
  });
});

describe('referenceDeLAxe', () => {
  const statutaires = { 'BRAHIM LOURID': 1000 };

  it('rend la masse statutaire sur l’axe formateur', () => {
    const reference = referenceDeLAxe('formateur', { statutaires });

    expect(reference.libelle).toBe('Masse horaire statutaire');
    expect(reference.valeurs['BRAHIM LOURID']).toBe(1000);
  });

  it('rend la masse globale sur l’axe groupe', () => {
    const reference = referenceDeLAxe('groupe', { lignes: [ligne()] });

    expect(reference.libelle).toBe('Masse horaire globale');
    expect(reference.valeurs.GM101).toBe(60);
  });

  /*
   * ⚠️ RIEN SUR L'AXE MODULE : ni la masse statutaire d'une personne ni le
   * programme d'un groupe ne s'y rapportent. L'existant n'en traçait pas non
   * plus.
   */
  it('ne rend rien sur l’axe module', () => {
    expect(referenceDeLAxe('module', { statutaires, lignes: [ligne()] })).toBeNull();
  });

  // Pas de courbe sans valeur : une ligne plate à zéro se lirait comme un plafond nul.
  it('ne rend rien quand la source est vide', () => {
    expect(referenceDeLAxe('formateur', { statutaires: {} })).toBeNull();
    expect(referenceDeLAxe('groupe', { lignes: [] })).toBeNull();
  });
});
