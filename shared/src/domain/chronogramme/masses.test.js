import { describe, it, expect } from 'vitest';
import { SEMAINES_DE_SERVICE, masseAnnuelle, masseHebdomadaire } from './masses.js';

const mod = (presentiel, synchrone = 0) => ({ masses: { presentiel, synchrone } });

describe('masseAnnuelle', () => {
  it('additionne le présentiel ET le synchrone', () => {
    // Les deux sont des heures dues : n'en compter qu'une sous-estime la
    // charge, et le chronogramme paraîtrait tenable alors qu'il ne l'est pas.
    expect(masseAnnuelle([mod(30, 10), mod(20)])).toBe(60);
  });

  it('rend 0 sur une liste vide', () => {
    expect(masseAnnuelle()).toBe(0);
    expect(masseAnnuelle([])).toBe(0);
  });

  it('tolère un module sans masses', () => {
    expect(masseAnnuelle([{ code: 'M101' }, mod(30)])).toBe(30);
  });
});

describe('masseHebdomadaire', () => {
  it('divise par les semaines de SERVICE, pas par les 45 de la grille', () => {
    /*
     * On ne dispense pas de cours sur les 45 semaines : vacances, stages et
     * examens en retirent une dizaine. Diviser par 45 annoncerait une charge
     * plus légère que la réalité.
     */
    expect(SEMAINES_DE_SERVICE).toBe(35);
    expect(masseHebdomadaire(1050)).toBe(30);
  });

  it('arrondit au CENTIÈME', () => {
    // À l'unité près, l'écart se chiffre en dizaines d'heures sur l'année et le
    // nombre affiché ne se recoupe plus avec la colonne « MHP ».
    expect(masseHebdomadaire(1060)).toBe(30.29);
  });

  it('rend 0 sans masse', () => {
    expect(masseHebdomadaire(0)).toBe(0);
    expect(masseHebdomadaire()).toBe(0);
  });
});
