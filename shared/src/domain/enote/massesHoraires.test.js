import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLONNES_MASSES, arrondir, massesHoraires } from './massesHoraires.js';

/**
 * TEST DE CARACTÉRISATION (Phase 2 du plan).
 *
 * Rejoue `enoteMassesHoraires()` sur les 522 combinaisons d'heures réellement
 * présentes dans les imports de production, et exige le même résultat au
 * centième près.
 *
 * Ces heures alimentent le module d'avancement (F7), où le plan note qu'« un
 * écart d'arrondi est visible et contesté ».
 *
 * Fixtures régénérables : `php outils/caracterisation/generer-fixtures-masses.php`
 */
const ici = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  fs.readFileSync(path.join(ici, '__fixtures__/masses-horaires.json'), 'utf8')
);

/** Reconstruit une ligne e-note minimale à partir des 4 cellules utiles. */
function ligneDepuis(entree) {
  const ligne = [];
  ligne[COLONNES_MASSES.partS1] = entree.partS1;
  ligne[COLONNES_MASSES.partS2] = entree.partS2;
  ligne[COLONNES_MASSES.masseHorairePresentiel] = entree.mhp;
  ligne[COLONNES_MASSES.masseHoraireSynchrone] = entree.mhsyn;
  return ligne;
}

describe('massesHoraires — caractérisation sur données réelles', () => {
  it('dispose du corpus de production', () => {
    expect(fixture.total).toBeGreaterThanOrEqual(500);
  });

  it('reproduit enoteMassesHoraires sur les 522 combinaisons', () => {
    const ecarts = [];

    for (const cas of fixture.cas) {
      const obtenu = massesHoraires(ligneDepuis(cas.entree));

      for (const type of ['presentiel', 'synchrone']) {
        for (const champ of ['s1', 's2', 'total']) {
          const attendu = cas.sortie[type][champ];
          if (obtenu[type][champ] !== attendu) {
            ecarts.push({ entree: cas.entree, type, champ, attendu, obtenu: obtenu[type][champ] });
          }
        }
      }
    }

    expect(ecarts).toEqual([]);
  });

  it('conserve la somme : s1 + s2 retombe toujours sur le total', () => {
    // C'est la raison pour laquelle s2 est calculé par soustraction et non par
    // sa propre multiplication.
    for (const cas of fixture.cas) {
      const { presentiel, synchrone } = massesHoraires(ligneDepuis(cas.entree));
      expect(arrondir(presentiel.s1 + presentiel.s2)).toBe(presentiel.total);
      expect(arrondir(synchrone.s1 + synchrone.s2)).toBe(synchrone.total);
    }
  });
});

describe('arrondir — équivalence avec round() de PHP', () => {
  it("s'éloigne de zéro sur les demis, comme PHP", () => {
    // Math.round(-2.5) vaut -2 en JavaScript ; PHP donne -3.
    expect(arrondir(2.5, 0)).toBe(3);
    expect(arrondir(-2.5, 0)).toBe(-3);
    expect(arrondir(1.5, 0)).toBe(2);
  });

  it("corrige l'imprécision des flottants", () => {
    // 1.005 est stocké 1.00499999… : un arrondi naïf donnerait 1.
    expect(arrondir(1.005)).toBe(1.01);
    expect(arrondir(1.045)).toBe(1.05);
  });

  it('laisse les valeurs déjà arrondies intactes', () => {
    expect(arrondir(74.12)).toBe(74.12);
    expect(arrondir(0)).toBe(0);
  });
});

describe('massesHoraires — règles', () => {
  const ligne = (partS1, partS2, mhp, mhsyn = 0) =>
    ligneDepuis({ partS1, partS2, mhp, mhsyn });

  it('répartit au prorata des colonnes X et AB', () => {
    // 90 × (70 / 85) = 74.1176… → 74.12, et le reste va au S2.
    const { presentiel } = massesHoraires(ligne('70', '15', '90'));
    expect(presentiel).toEqual({ s1: 74.12, s2: 15.88, total: 90 });
  });

  it('porte tout sur le S1 quand aucune répartition n\'est exploitable', () => {
    const { presentiel } = massesHoraires(ligne('0', '0', '60'));
    expect(presentiel).toEqual({ s1: 60, s2: 0, total: 60 });
  });

  it('renvoie zéro pour un total nul ou absent', () => {
    expect(massesHoraires(ligne('30', '30', '0')).presentiel).toEqual({ s1: 0, s2: 0, total: 0 });
    expect(massesHoraires(ligne('30', '30', '')).presentiel).toEqual({ s1: 0, s2: 0, total: 0 });
  });

  it('accepte la virgule décimale française', () => {
    const { presentiel } = massesHoraires(ligne('22,5', '22,5', '45'));
    expect(presentiel).toEqual({ s1: 22.5, s2: 22.5, total: 45 });
  });

  it('traite présentiel et synchrone indépendamment', () => {
    const { presentiel, synchrone } = massesHoraires(ligne('70', '15', '90', '30'));
    expect(presentiel.total).toBe(90);
    expect(synchrone.total).toBe(30);
    expect(synchrone.s1).toBe(24.71); // 30 × (70/85)
  });

  it("refuse autre chose qu'une ligne", () => {
    expect(() => massesHoraires('45')).toThrow(TypeError);
  });
});
