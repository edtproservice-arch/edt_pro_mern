import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLONNES_MASSES, PAS_CHRONOGRAMME, arrondir, massesHoraires } from './massesHoraires.js';

/**
 * TEST DE CARACTÉRISATION (Phase 2 du plan).
 *
 * Rejoue `enoteMassesHoraires()` sur les 522 combinaisons d'heures réellement
 * présentes dans les imports de production, et exige le même résultat au
 * centième près LÀ OÙ LA MASSE AFFECTÉE ÉGALE LE DRIF.
 *
 * ⚠️ Écart volontaire depuis le 2026-10-07 : quand l'affectée diffère du DRIF,
 * le S1 est arrondi au pas du chronogramme (2,5 h) au lieu du centième. Ces
 * cas-là sont vérifiés par leurs propriétés (somme conservée, pas respecté).
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

/** Reconstruit une ligne e-note minimale à partir des cellules utiles. */
function ligneDepuis(entree) {
  const ligne = [];
  ligne[COLONNES_MASSES.partS1] = entree.partS1;
  ligne[COLONNES_MASSES.partS2] = entree.partS2;
  ligne[COLONNES_MASSES.partSynS1] = entree.synS1;
  ligne[COLONNES_MASSES.partSynS2] = entree.synS2;
  ligne[COLONNES_MASSES.masseHorairePresentiel] = entree.mhp;
  ligne[COLONNES_MASSES.masseHoraireSynchrone] = entree.mhsyn;
  return ligne;
}

describe('massesHoraires — caractérisation sur données réelles', () => {
  it('dispose du corpus de production', () => {
    expect(fixture.total).toBeGreaterThanOrEqual(500);
  });

  it("reproduit enoteMassesHoraires quand l'affectée égale le DRIF", () => {
    const ecarts = [];
    const nb = (valeur) => Number.parseFloat(String(valeur || '0').replace(',', '.'));

    for (const cas of fixture.cas) {
      const obtenu = massesHoraires(ligneDepuis(cas.entree));
      const drif = arrondir(nb(cas.entree.partS1) + nb(cas.entree.partS2));
      const sansEcart = { presentiel: 'mhp', synchrone: 'mhsyn' };

      for (const type of ['presentiel', 'synchrone']) {
        if (arrondir(nb(cas.entree[sansEcart[type]])) !== drif) continue;
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

  it('place le S1 au pas du chronogramme quand le DRIF a deux semestres', () => {
    for (const cas of fixture.cas) {
      const { presentiel } = massesHoraires(ligneDepuis(cas.entree));
      if (presentiel.s1 === 0 || presentiel.s2 === 0) continue;
      const nb = (valeur) => Number.parseFloat(String(valeur || '0').replace(',', '.'));
      if (arrondir(presentiel.total) === arrondir(nb(cas.entree.partS1) + nb(cas.entree.partS2))) continue;

      expect(presentiel.s1 % PAS_CHRONOGRAMME).toBe(0);
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

  it("reprend le DRIF tel quel quand l'affectée lui est égale", () => {
    const { presentiel } = massesHoraires(ligne('38', '47', '85'));
    expect(presentiel).toEqual({ s1: 38, s2: 47, total: 85 });
  });

  it("partage l'écart au prorata du DRIF, S1 arrondi au pas de 2,5 h", () => {
    // DRIF 50 + 30 = 80, affectée 47,5 : 47,5 × 50/80 = 29,69 → 30, S2 = 17,5.
    const { presentiel } = massesHoraires(ligne('50', '30', '47.5'));
    expect(presentiel).toEqual({ s1: 30, s2: 17.5, total: 47.5 });

    // 90 × (70 / 85) = 74,12 → 75, et le reste va au S2.
    expect(massesHoraires(ligne('70', '15', '90')).presentiel).toEqual({ s1: 75, s2: 15, total: 90 });
  });

  it("ne perd aucune heure quand l'affectée n'est pas un multiple du pas", () => {
    // 47 × 50/80 = 29,38 → 30 ; le S2 garde le reste, 17.
    const { presentiel } = massesHoraires(ligne('50', '30', '47'));
    expect(presentiel).toEqual({ s1: 30, s2: 17, total: 47 });
  });

  it("porte tout l'écart sur le seul semestre prévu au DRIF", () => {
    expect(massesHoraires(ligne('0', '60', '32.5')).presentiel).toEqual({ s1: 0, s2: 32.5, total: 32.5 });
    expect(massesHoraires(ligne('15', '0', '7.5')).presentiel).toEqual({ s1: 7.5, s2: 0, total: 7.5 });
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

  it('répartit le synchrone selon SES colonnes DRIF (Y et AC)', () => {
    // MHP : 0 au S1, 60 au S2 — MHSYN : 5 et 5. Affectée sync : 5.
    const { presentiel, synchrone } = massesHoraires(
      ligneDepuis({ partS1: '0', partS2: '60', synS1: '5', synS2: '5', mhp: '32.5', mhsyn: '5' })
    );
    expect(presentiel).toEqual({ s1: 0, s2: 32.5, total: 32.5 });
    // 5 × 5/10 = 2,5 : l'ancien calcul suivait le MHP et mettait tout au S2.
    expect(synchrone).toEqual({ s1: 2.5, s2: 2.5, total: 5 });
  });

  it('retombe sur la répartition présentielle sans colonnes DRIF synchrones', () => {
    const { synchrone } = massesHoraires(ligne('70', '15', '90', '30'));
    // 30 × (70/85) = 24,71 → 25.
    expect(synchrone).toEqual({ s1: 25, s2: 5, total: 30 });
  });

  it("refuse autre chose qu'une ligne", () => {
    expect(() => massesHoraires('45')).toThrow(TypeError);
  });
});
