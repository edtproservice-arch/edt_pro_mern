import { describe, expect, it } from 'vitest';
import {
  estPartageParType,
  fusionnerType,
  planningDepuisLignes,
  planningDesLignes,
  scinderParType,
  verrouillerAutreType,
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

  it('refuse une saisie sur une semaine déjà prise par l’autre type', () => {
    const { cellules, refusees } = fusionnerType(
      planning.M205,
      { 7: { heures: 10, type: 'S' }, 15: { heures: 10, type: 'S' } },
      'S'
    );
    expect(refusees).toBe(1);
    expect(cellules[7]).toEqual({ heures: 5, type: 'P' });
  });

  it('verrouille, sur la ligne, les semaines de l’autre type', () => {
    const semaines = [7, 15, 16].map((numero) => ({ numero, disponible: true }));
    const [m204, p, s] = verrouillerAutreType(lignes, (l) => planning[l.cleSource ?? l.code], semaines);

    expect(m204).toBe(lignes[0]);
    expect(p.semaines.find((x) => x.numero === 15)).toMatchObject({ disponible: false, motif: 'autreType' });
    expect(s.semaines.find((x) => x.numero === 7)).toMatchObject({ disponible: false, motif: 'autreType' });
    expect(s.semaines.find((x) => x.numero === 16).disponible).toBe(true);
  });
});
