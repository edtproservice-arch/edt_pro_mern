import { describe, it, expect } from 'vitest';
import { totalAvancement } from 'shared/domain';
import { partsAvancement } from './barreAvancement';

const total = (prevuPresentiel, realisePresentiel, prevuSynchrone = 0, realiseSynchrone = 0) => ({
  prevuPresentiel,
  realisePresentiel,
  prevuSynchrone,
  realiseSynchrone,
});

describe('partsAvancement', () => {
  it('reprend les heures du total, sans les recalculer', () => {
    const parts = partsAvancement(total(100, 30, 10, 5));

    expect(parts).toMatchObject({
      realisePresentiel: 30,
      realiseSynchrone: 5,
      prevuPresentiel: 100,
      prevuSynchrone: 10,
      prevu: 110,
    });
  });

  /*
   * ⚠️ LE POINT QUI COMPTE : les deux segments se mesurent sur le prévu TOTAL.
   * Calculés chacun sur le sien (25 % et 50 %), ils feraient 75 % de piste pour
   * un taux global de 31,8 % — la barre dirait autre chose que le chiffre écrit
   * juste au-dessus.
   */
  it('mesure les deux segments sur le prévu TOTAL, jamais chacun sur le sien', () => {
    const parts = partsAvancement(total(100, 25, 20, 10));

    // 25/120 et 10/120, pas 25/100 et 10/20.
    expect(parts.partPresentiel).toBeCloseTo((25 / 120) * 100, 6);
    expect(parts.partSynchrone).toBeCloseTo((10 / 120) * 100, 6);
    // Leur somme EST le taux global : c'est ce que la barre illustre.
    expect(parts.partPresentiel + parts.partSynchrone).toBeCloseTo((35 / 120) * 100, 6);
  });

  it('borne la barre à 100 % quand le réalisé dépasse le prévu', () => {
    const parts = partsAvancement(total(100, 150, 20, 40));

    // Le dépassement reste dans les CHIFFRES (190 h réalisées) …
    expect(parts.realisePresentiel + parts.realiseSynchrone).toBe(190);
    // … mais la piste ne déborde pas.
    expect(parts.partPresentiel + parts.partSynchrone).toBeLessThanOrEqual(100);
  });

  /*
   * ⚠️ UN PRÉSENTIEL EN DÉPASSEMENT NE POUSSE PAS LE DISTANCIEL HORS DE LA
   * PISTE : borné chacun de son côté à 100, les deux segments auraient fait
   * 200 % de largeur, et le second serait sorti du cadre.
   */
  it('ne laisse pas un présentiel débordant chasser le distanciel', () => {
    const parts = partsAvancement(total(100, 300, 100, 50));

    expect(parts.partPresentiel).toBe(100);
    expect(parts.partSynchrone).toBe(0);
  });

  it('rend des parts nulles quand rien n’est prévu — jamais NaN', () => {
    const parts = partsAvancement(total(0, 0, 0, 0));

    expect(parts.prevu).toBe(0);
    expect(parts.partPresentiel).toBe(0);
    expect(parts.partSynchrone).toBe(0);
  });

  it('supporte un total absent', () => {
    expect(partsAvancement()).toMatchObject({ prevu: 0, partPresentiel: 0, partSynchrone: 0 });
  });
});

/*
 * ═══ ⚠️⚠️ LE TEST QUI AURAIT ATTRAPÉ LE DÉFAUT DU 2026-09-06 ═══
 * La barre sommait les LIGNES d'avancement, qui sont éclatées par groupe : une
 * séance synchrone mutualisée y comptait deux fois (« 160 h » au lieu de 120),
 * pendant que le chiffre en tête du même écran, lui, passait par
 * `totalAvancement`. Ce test part donc de LIGNES RÉELLES et vérifie que les deux
 * s'accordent — c'est le lien entre les deux, pas l'arithmétique de la barre,
 * qui était rompu.
 */
describe('partsAvancement — accord avec le chiffre affiché en tête', () => {
  /** Deux groupes, UNE séance synchrone mutualisée entre eux. */
  const lignes = [
    {
      module: 'EGQ102',
      groupe: 'OPCM101',
      fusionGroupe: 'OPCM101 OPCM102',
      formateurPresentiel: 'ZINEB',
      formateurSynchrone: 'ZINEB',
      prevuPresentiel: 0,
      realisePresentiel: 0,
      prevuSynchrone: 20,
      realiseSynchrone: 5,
    },
    {
      module: 'EGQ102',
      groupe: 'OPCM102',
      fusionGroupe: 'OPCM101 OPCM102',
      formateurPresentiel: 'ZINEB',
      formateurSynchrone: 'ZINEB',
      prevuPresentiel: 0,
      realisePresentiel: 0,
      prevuSynchrone: 20,
      realiseSynchrone: 5,
    },
  ];

  it('ne compte qu’une fois une séance synchrone mutualisée', () => {
    const global = totalAvancement(lignes);
    const parts = partsAvancement(global);

    // La séance est donnée UNE fois, même si deux groupes la reçoivent.
    expect(global.prevuSynchrone).toBe(20);
    expect(parts.prevuSynchrone).toBe(20);
    expect(parts.realiseSynchrone).toBe(5);
  });

  it('la ventilation de la barre ADDITIONNE le total affiché en tête', () => {
    const global = totalAvancement(lignes);
    const parts = partsAvancement(global);

    // C'est l'incohérence qu'a vue le porteur : 800 + 160 ≠ 920.
    expect(parts.prevuPresentiel + parts.prevuSynchrone).toBe(global.prevu);
    expect(parts.realisePresentiel + parts.realiseSynchrone).toBe(global.realise);
  });
});
