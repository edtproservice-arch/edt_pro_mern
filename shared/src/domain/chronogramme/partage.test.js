import { describe, expect, it } from 'vitest';
import {
  cellulesDuType,
  deplierModules,
  estDepliable,
  estPartageParType,
  fusionnerType,
  planningDeplie,
  planningDepuisLignes,
  planningDesLignes,
  planningReplie,
  scinderParType,
} from './partage.js';

const M205 = {
  code: 'M205',
  masses: { presentiel: 65, synchrone: 10 },
  formateurs: ['NABIL KADANI', 'ZOUHAIR ADNAOUI'],
  formateursPresentiel: ['ZOUHAIR ADNAOUI'],
  formateursSynchrone: ['NABIL KADANI'],
};
const M204 = {
  code: 'M204',
  masses: { presentiel: 65, synchrone: 10 },
  formateurs: ['NABIL KADANI'],
  formateursPresentiel: ['NABIL KADANI'],
  formateursSynchrone: ['NABIL KADANI'],
};

const planning = {
  M205: { 7: { heures: 5, type: 'P' }, 8: { heures: 5, type: 'P' }, 15: { heures: 10, type: 'S' } },
  M204: { 1: { heures: 10, type: 'P' } },
};

describe('scinderParType', () => {
  it('scinde un module assuré par deux personnes, une par type', () => {
    expect(estPartageParType(M205)).toBe(true);
    const lignes = scinderParType([M204, M205]);

    expect(lignes).toHaveLength(3);
    expect(lignes[0]).toBe(M204);
    expect(lignes[1]).toMatchObject({
      cle: 'M205#P',
      typeSeul: 'P',
      formateurs: ['ZOUHAIR ADNAOUI'],
      masses: { presentiel: 65, synchrone: 0 },
    });
    expect(lignes[2]).toMatchObject({
      cle: 'M205#S',
      typeSeul: 'S',
      formateurs: ['NABIL KADANI'],
      masses: { presentiel: 0, synchrone: 10 },
    });
  });

  it('garde une seule ligne quand la même personne assure les deux types', () => {
    expect(estPartageParType(M204)).toBe(false);
  });
});

describe('aller-retour du planning', () => {
  const lignes = scinderParType([M204, M205]);

  it('chaque ligne ne montre que les cellules de son type', () => {
    const plat = planningDesLignes(planning, lignes);
    expect(Object.keys(plat['M205#P'])).toEqual(['7', '8']);
    expect(Object.keys(plat['M205#S'])).toEqual(['15']);
    expect(plat.M204).toBe(planning.M204);
  });

  it('une saisie sur une ligne ne touche pas la part de l’autre', () => {
    const plat = planningDesLignes(planning, lignes);
    plat['M205#S'] = { ...plat['M205#S'], 16: { heures: 5, type: 'S' } };

    const { planning: suivant, refusees } = planningDepuisLignes(plat, lignes, planning);
    expect(refusees).toBe(0);
    expect(suivant.M205).toEqual({ ...planning.M205, 16: { heures: 5, type: 'S' } });
  });

  /*
   * ⚠️ 2026-10-01 : une semaine déjà prise par l'autre type n'est plus refusée,
   * elle devient une case MIXTE — la part du collègue reste intacte.
   */
  it('une saisie sur une semaine de l’autre type forme une case MIXTE', () => {
    const { cellules, refusees } = fusionnerType(
      planning.M205,
      { 7: { heures: 2.5, type: 'S' }, 15: { heures: 10, type: 'S' } },
      'S'
    );
    expect(refusees).toBe(0);
    expect(cellules[7]).toEqual({ heures: 7.5, type: 'PS', presentiel: 5, synchrone: 2.5 });
    expect(cellules[8]).toEqual({ heures: 5, type: 'P' });
    expect(cellules[15]).toEqual({ heures: 10, type: 'S' });
  });

  it('chaque ligne ne voit que SA part d’une case mixte', () => {
    const mixte = { M205: { 7: { heures: 7.5, type: 'PS', presentiel: 5, synchrone: 2.5 } } };
    const plat = planningDesLignes(mixte, lignes);
    expect(plat['M205#P'][7]).toEqual({ heures: 5, type: 'P' });
    expect(plat['M205#S'][7]).toEqual({ heures: 2.5, type: 'S' });
  });

  it('effacer une part d’une case mixte laisse l’autre en case simple', () => {
    const mixte = { M205: { 7: { heures: 7.5, type: 'PS', presentiel: 5, synchrone: 2.5 } } };
    const plat = planningDesLignes(mixte, lignes);
    plat['M205#S'] = {};

    const { planning: suivant } = planningDepuisLignes(plat, lignes, mixte);
    expect(suivant.M205).toEqual({ 7: { heures: 5, type: 'P' } });
  });
});

describe('déplier un module dans la grille', () => {
  it('ne déplie qu’un module à DEUX masses, et pas une ligne déjà scindée', () => {
    expect(estDepliable(M204)).toBe(true);
    expect(estDepliable({ ...M204, masses: { presentiel: 65, synchrone: 0 } })).toBe(false);
    expect(estDepliable({ ...M204, typeSeul: 'P' })).toBe(false);
  });

  it('rend les modules TELS QUELS tant que rien n’est déplié', () => {
    const modules = [M204];
    expect(deplierModules(modules, new Set())).toBe(modules);
    expect(deplierModules(modules, new Set(['M999']))[0]).toBe(M204);
  });

  it('une ligne dépliée devient deux, chacune avec SA masse', () => {
    const [p, s] = deplierModules([M204], new Set(['M204']));
    expect(p).toMatchObject({ cleGrille: 'M204', typeSeul: 'P', masses: { presentiel: 65, synchrone: 0 } });
    expect(s).toMatchObject({ cleGrille: 'M204', typeSeul: 'S', masses: { presentiel: 0, synchrone: 10 } });
    expect(p.cle).not.toBe(s.cle);
  });

  it('aller-retour : P et S la MÊME semaine se réunissent en une case mixte', () => {
    const lignes = deplierModules([M204], new Set(['M204']));
    const [p, s] = lignes;
    const plat = planningDeplie(planning, lignes);
    expect(plat[p.cle][1]).toEqual({ heures: 10, type: 'P' });
    expect(plat[s.cle]).toEqual({});

    plat[s.cle] = { 1: { heures: 2.5, type: 'S' }, 2: { heures: 5, type: 'S' } };
    const replie = planningReplie(plat, lignes);

    expect(replie.M204).toEqual({
      1: { heures: 12.5, type: 'PS', presentiel: 10, synchrone: 2.5 },
      2: { heures: 5, type: 'S' },
    });
    expect(replie[p.cle]).toBeUndefined();
    expect(replie[s.cle]).toBeUndefined();
    // Les autres modules ne bougent pas.
    expect(replie.M205).toBe(planning.M205);
  });

  it('cellulesDuType extrait la part d’un type en case simple', () => {
    const cellules = { 3: { heures: 7.5, type: 'PS', presentiel: 5, synchrone: 2.5 }, 4: { heures: 5, type: 'P' } };
    expect(cellulesDuType(cellules, 'S')).toEqual({ 3: { heures: 2.5, type: 'S' } });
    expect(cellulesDuType(cellules, 'P')).toEqual({ 3: { heures: 5, type: 'P' }, 4: { heures: 5, type: 'P' } });
  });
});
