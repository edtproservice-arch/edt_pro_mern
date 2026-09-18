import { describe, it, expect } from 'vitest';
import { SEUIL_HEBDOMADAIRE, chargesHebdomadaires } from './charge.js';

const P = (heures) => ({ heures, type: 'P' });
const S = (heures) => ({ heures, type: 'S' });

describe('chargesHebdomadaires — présentiel', () => {
  it('additionne les heures d’un formateur sur ses groupes', () => {
    const { formateurs } = chargesHebdomadaires([
      { groupe: 'GM101', module: 'M101', formateur: 'BRAHIM', planning: { 5: P(5) } },
      { groupe: 'GM102', module: 'M101', formateur: 'BRAHIM', planning: { 5: P(5) } },
    ]);

    expect(formateurs.BRAHIM.semaines[5]).toEqual({ presentiel: 10, synchrone: 0, total: 10 });
    expect(formateurs.BRAHIM.total).toBe(10);
  });

  it('compte chaque groupe séparément', () => {
    const { groupes } = chargesHebdomadaires([
      { groupe: 'GM101', module: 'M101', formateur: 'BRAHIM', planning: { 5: P(5) } },
      { groupe: 'GM102', module: 'M101', formateur: 'BRAHIM', planning: { 5: P(5) } },
    ]);

    expect(groupes.GM101.semaines[5].total).toBe(5);
    expect(groupes.GM102.semaines[5].total).toBe(5);
  });
});

describe('chargesHebdomadaires — la règle du synchrone', () => {
  /** Une séance mutualisée : deux lignes, un seul ensemble. */
  const mutualisee = [
    { groupe: 'GM101', module: 'M101', formateur: 'BRAHIM', ensemble: 'GM101 GM102', planning: { 5: S(10) } },
    { groupe: 'GM102', module: 'M101', formateur: 'BRAHIM', ensemble: 'GM101 GM102', planning: { 5: S(10) } },
  ];

  it('⚠️ ne compte QU’UNE FOIS pour le FORMATEUR', () => {
    /*
     * Il ne donne la séance qu'une fois. La compter par groupe ferait croire à
     * une surcharge inexistante — et le tableau accuserait un dépassement que
     * le générateur ignore.
     */
    const { formateurs } = chargesHebdomadaires(mutualisee);
    expect(formateurs.BRAHIM.semaines[5]).toEqual({ presentiel: 0, synchrone: 10, total: 10 });
  });

  it('la compte pour CHAQUE GROUPE couvert', () => {
    // Les deux groupes reçoivent bien ces heures : c'est le sens de la séance.
    const { groupes } = chargesHebdomadaires(mutualisee);
    expect(groupes.GM101.semaines[5].total).toBe(10);
    expect(groupes.GM102.semaines[5].total).toBe(10);
  });

  it('deux ensembles DIFFÉRENTS pèsent chacun leur poids', () => {
    /*
     * Même personne, même module, mais deux séances distinctes — GM101 d'un
     * côté, GM102 de l'autre. Les dédoublonner effacerait la moitié de sa
     * charge : c'est le défaut déjà rencontré sur le bilan de la carte.
     */
    const { formateurs } = chargesHebdomadaires([
      { groupe: 'GM101', module: 'M101', formateur: 'BRAHIM', ensemble: 'GM101', planning: { 5: S(10) } },
      { groupe: 'GM102', module: 'M101', formateur: 'BRAHIM', ensemble: 'GM102', planning: { 5: S(10) } },
    ]);

    expect(formateurs.BRAHIM.semaines[5].synchrone).toBe(20);
  });

  it('l’ordre des groupes dans l’ensemble ne change rien', () => {
    // « GM102 GM101 » et « GM101 GM102 » décrivent la même séance.
    const { formateurs } = chargesHebdomadaires([
      { groupe: 'GM101', module: 'M101', formateur: 'BRAHIM', ensemble: 'GM101 GM102', planning: { 5: S(10) } },
      { groupe: 'GM102', module: 'M101', formateur: 'BRAHIM', ensemble: 'GM102 GM101', planning: { 5: S(10) } },
    ]);

    expect(formateurs.BRAHIM.semaines[5].synchrone).toBe(10);
  });

  it('deux FORMATEURS distincts ne se dédoublonnent pas entre eux', () => {
    const { formateurs } = chargesHebdomadaires([
      { groupe: 'GM101', module: 'M101', formateur: 'BRAHIM', ensemble: 'GM101 GM102', planning: { 5: S(10) } },
      { groupe: 'GM102', module: 'M101', formateur: 'SAID', ensemble: 'GM101 GM102', planning: { 5: S(10) } },
    ]);

    expect(formateurs.BRAHIM.semaines[5].synchrone).toBe(10);
    expect(formateurs.SAID.semaines[5].synchrone).toBe(10);
  });
});

describe('chargesHebdomadaires — bornes et mise en forme', () => {
  it('accepte « S12 » comme 12', () => {
    // L'existant stockait des clés « S12 » ; la grille raisonne en nombres.
    const { groupes } = chargesHebdomadaires([
      { groupe: 'GM101', module: 'M101', formateur: 'BRAHIM', planning: { S12: P(5) } },
    ]);
    expect(groupes.GM101.semaines[12].total).toBe(5);
  });

  it('écarte une semaine hors des 45', () => {
    const { groupes } = chargesHebdomadaires([
      { groupe: 'GM101', module: 'M101', formateur: 'BRAHIM', planning: { 99: P(5), 3: P(5) } },
    ]);
    expect(Object.keys(groupes.GM101.semaines)).toEqual(['3']);
  });

  it('n’attribue rien à un formateur ABSENT', () => {
    // « -- » est ce que l'existant posait pour « pas de formateur » : le prendre
    // pour un nom créerait une ligne fantôme en tête du tableau.
    const { formateurs, groupes } = chargesHebdomadaires([
      { groupe: 'GM101', module: 'M101', formateur: '--', planning: { 5: P(5) } },
      { groupe: 'GM101', module: 'M102', formateur: '', planning: { 5: P(5) } },
    ]);

    expect(formateurs).toEqual({});
    // Le groupe, lui, reçoit bien ces heures : elles sont planifiées.
    expect(groupes.GM101.semaines[5].total).toBe(10);
  });

  it('n’inscrit PAS un sujet dont toutes les semaines sont vides', () => {
    // Une ligne à zéro remplirait le tableau de lignes qu'on doit parcourir des
    // yeux pour rien.
    const { formateurs } = chargesHebdomadaires([
      { groupe: 'GM101', module: 'M101', formateur: 'BRAHIM', planning: { 5: P(0) } },
    ]);
    expect(formateurs).toEqual({});
  });

  it('compte les semaines en DÉPASSEMENT', () => {
    const { formateurs } = chargesHebdomadaires([
      { groupe: 'GM101', module: 'M101', formateur: 'BRAHIM', planning: { 5: P(20), 6: P(10) } },
      { groupe: 'GM102', module: 'M101', formateur: 'BRAHIM', planning: { 5: P(15) } },
    ]);

    expect(formateurs.BRAHIM.semaines[5].total).toBe(35);
    expect(formateurs.BRAHIM.depassements).toBe(1);
    expect(SEUIL_HEBDOMADAIRE).toBe(30);
  });

  it('sépare présentiel et synchrone dans les totaux', () => {
    const { groupes } = chargesHebdomadaires([
      { groupe: 'GM101', module: 'M101', formateur: 'BRAHIM', planning: { 5: P(5), 6: S(2.5) } },
    ]);

    expect(groupes.GM101.presentiel).toBe(5);
    expect(groupes.GM101.synchrone).toBe(2.5);
    expect(groupes.GM101.total).toBe(7.5);
  });

  it('tolère une entrée vide', () => {
    expect(chargesHebdomadaires()).toEqual({ formateurs: {}, groupes: {} });
  });
});
