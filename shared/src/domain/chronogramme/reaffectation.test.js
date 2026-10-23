import { describe, expect, it } from 'vitest';
import { cleLigne } from './fusion.js';
import { planningDepuisLignes, planningDesLignes } from './partage.js';
import {
  MOTIF_REAFFECTATION,
  changementsDeTitulaire,
  cleReaffectation,
  detecterReaffectations,
  fusionnerLigne,
  scinderParReaffectation,
} from './reaffectation.js';

const affectations = [{ formateur: 'F2', groupe: 'GM101', module: 'M205', type: 'presentiel' }];
const seance = (formateur, numero, autres = {}) => ({
  formateur,
  groupe: 'GM101',
  module: 'M205',
  type: 'P',
  numero,
  ...autres,
});
const K = cleReaffectation('GM101', 'M205', 'P');

describe('detecterReaffectations — les anciens titulaires (2026-10-22)', () => {
  it('reconnaît dans l’emploi l’ancien titulaire et sa dernière semaine', () => {
    const resultat = detecterReaffectations({
      affectations,
      seances: [seance('F1', 5), seance('F1', 6), seance('F1', 7), seance('F2', 8)],
    });
    expect(resultat.get(K)).toEqual([
      expect.objectContaining({ ancien: 'F1', derniereSemaine: 7, source: 'emploi' }),
    ]);
  });

  it('écarte un remplaçant : ses séances tombent après la première du titulaire', () => {
    const resultat = detecterReaffectations({
      affectations,
      seances: [seance('F2', 3), seance('F3', 6), seance('F3', 7), seance('F2', 8)],
    });
    expect(resultat.has(K)).toBe(false);
  });

  it('une seule semaine suffit (EGTS101 de GM101 : LAASSAL en S1, AAJLIYE dès S2)', () => {
    const resultat = detecterReaffectations({
      affectations,
      seances: [seance('F1', 1, { heures: 2.5 }), seance('F2', 2, { heures: 2.5 })],
    });
    expect(resultat.get(K)).toEqual([
      expect.objectContaining({ ancien: 'F1', derniereSemaine: 1, realise: { 1: 2.5 } }),
    ]);
  });

  it('« ce n’était pas une réaffectation » écarte l’ancien retrouvé dans l’emploi', () => {
    const resultat = detecterReaffectations({
      affectations,
      seances: [seance('F3', 1), seance('F2', 2)],
      journal: [{ groupe: 'GM101', module: 'M205', type: 'P', ancien: 'F3', ignoree: true }],
    });
    expect(resultat.has(K)).toBe(false);
  });

  it('le journal donne la date et l’auteur ; sa bascule fixée prime sur l’emploi', () => {
    const resultat = detecterReaffectations({
      affectations,
      seances: [seance('F1', 5), seance('F1', 6), seance('F1', 7)],
      journal: [{ groupe: 'GM101', module: 'M205', type: 'P', ancien: 'F1', date: '2026-10-20', auteur: 'Directeur', derniereSemaine: 6 }],
    });
    expect(resultat.get(K)).toEqual([
      expect.objectContaining({ ancien: 'F1', derniereSemaine: 6, source: 'manuel', auteur: 'Directeur' }),
    ]);
  });

  it('un ancien qui n’a jamais enseigné n’a rien à garder', () => {
    const resultat = detecterReaffectations({
      affectations,
      journal: [{ groupe: 'GM101', module: 'M205', type: 'P', ancien: 'F1' }],
    });
    expect(resultat.has(K)).toBe(false);
  });

  it('une séance synchrone mutualisée compte pour chacun de ses groupes', () => {
    const resultat = detecterReaffectations({
      affectations: [{ formateur: 'F2', groupe: 'GM101 GM102', module: 'M205', type: 'synchrone' }],
      seances: [seance('F1', 4, { groupe: 'GM101 GM102', type: 'S' }), seance('F1', 5, { groupe: 'GM101 GM102', type: 'S' })],
    });
    expect(resultat.get(cleReaffectation('GM102', 'M205', 'S'))?.[0].derniereSemaine).toBe(5);
  });
});

describe('changementsDeTitulaire — ce que le journal retient', () => {
  it('un changement de nom', () => {
    expect(
      changementsDeTitulaire(affectations.map((a) => ({ ...a, formateur: 'F1' })), affectations)
    ).toEqual([{ groupe: 'GM101', module: 'M205', type: 'P', ancien: 'F1', nouveau: 'F2' }]);
  });

  it('en deux temps : un retrait, puis une arrivée', () => {
    const avant = affectations.map((a) => ({ ...a, formateur: 'F1' }));
    expect(changementsDeTitulaire(avant, [])).toEqual([
      { groupe: 'GM101', module: 'M205', type: 'P', ancien: 'F1', nouveau: '' },
    ]);
    expect(changementsDeTitulaire([], affectations)).toEqual([
      { groupe: 'GM101', module: 'M205', type: 'P', ancien: '', nouveau: 'F2' },
    ]);
  });

  it('rien quand rien ne change', () => {
    expect(changementsDeTitulaire(affectations, affectations)).toEqual([]);
  });
});

describe('scinderParReaffectation — deux lignes, chacune ses semaines', () => {
  const semaines = Array.from({ length: 10 }, (_, i) => ({ numero: i + 1, disponible: true, joursDisponibles: 6 }));
  const module = {
    code: 'M205',
    masses: { presentiel: 40, synchrone: 0 },
    formateurs: ['BENNANI'],
    formateursPresentiel: ['BENNANI'],
    formateursSynchrone: [],
    reaffectations: { P: [{ ancien: 'F1', nom: 'ALAMI', derniereSemaine: 3 }] },
  };
  const planning = { M205: { 1: { heures: 5, type: 'P' }, 3: { heures: 5, type: 'P' }, 5: { heures: 10, type: 'P' } } };

  it('l’ancien garde ses heures, le titulaire le reste de la masse', () => {
    const [ancien, titulaire] = scinderParReaffectation([module], planning, semaines);
    expect(ancien).toMatchObject({ formateurs: ['ALAMI'], termine: true, plage: { de: 1, a: 3 }, masses: { presentiel: 10 } });
    expect(ancien.noteFormateur).toBe('S1–S3, terminé');
    expect(titulaire).toMatchObject({ formateurs: ['BENNANI'], plage: { de: 4, a: null }, masses: { presentiel: 30 } });
    expect(titulaire.noteFormateur).toBe('depuis S4');
    // La ligne du titulaire garde la clé du module : la grille la reconnaît.
    expect(cleLigne(titulaire)).toBe('M205');
  });

  it('chaque ligne ferme les semaines de l’autre', () => {
    const [ancien, titulaire] = scinderParReaffectation([module], planning, semaines);
    expect(ancien.semaines[4]).toMatchObject({ disponible: false, motif: MOTIF_REAFFECTATION });
    expect(titulaire.semaines[1]).toMatchObject({ disponible: false, motif: MOTIF_REAFFECTATION });
    expect(titulaire.semaines[4].disponible).toBe(true);
  });

  it('l’aller-retour ne mélange pas les semaines des deux formateurs', () => {
    const lignes = scinderParReaffectation([module], planning, semaines);
    const [ancien, titulaire] = lignes.map(cleLigne);
    const affiche = planningDesLignes(planning, lignes);
    expect(Object.keys(affiche[ancien])).toEqual(['1', '3']);
    expect(Object.keys(affiche[titulaire])).toEqual(['5']);

    // Le titulaire pose en S6 ; la saisie ne touche pas aux semaines de l'ancien.
    const saisi = { ...affiche, [titulaire]: { ...affiche[titulaire], 6: { heures: 5, type: 'P' } } };
    expect(planningDepuisLignes(saisi, lignes, planning).planning.M205).toEqual({
      1: { heures: 5, type: 'P' },
      3: { heures: 5, type: 'P' },
      5: { heures: 10, type: 'P' },
      6: { heures: 5, type: 'P' },
    });
  });

  it('l’ancien montre les heures FAITES dans l’emploi, retirées de la masse du titulaire (2026-10-23)', () => {
    // EGTS101 de GM101 : LAASSAL fait 2,5 h en S1 (emploi), le chronogramme n'a rien en S1.
    const egts = {
      code: 'EGTS101',
      masses: { presentiel: 15, synchrone: 0 },
      formateurs: ['AAJLIYE'],
      formateursPresentiel: ['AAJLIYE'],
      formateursSynchrone: [],
      reaffectations: { P: [{ ancien: 'F1', nom: 'LAASSAL', derniereSemaine: 1, realise: { 1: 2.5 } }] },
    };
    const plan = { EGTS101: { 3: { heures: 5, type: 'P' } } };
    const lignes = scinderParReaffectation([egts], plan, semaines);
    const [ancien, titulaire] = lignes;

    expect(ancien.realise).toEqual({ 1: { heures: 2.5, type: 'P' } });
    expect(ancien.masses.presentiel).toBe(2.5);
    expect(ancien.semaines[0]).toMatchObject({ disponible: false, motif: 'realise' });
    expect(titulaire.masses.presentiel).toBe(12.5);

    const affiche = planningDesLignes(plan, lignes);
    expect(affiche[cleLigne(ancien)]).toEqual({ 1: { heures: 2.5, type: 'P' } });
    // Les heures faites ne s'écrivent pas dans le chronogramme : elles restent celles de l'emploi.
    expect(planningDepuisLignes(affiche, lignes, plan).planning.EGTS101).toEqual({ 3: { heures: 5, type: 'P' } });
  });

  it('un module sans réaffectation est rendu tel quel', () => {
    const autre = { code: 'M101', masses: { presentiel: 20, synchrone: 0 } };
    expect(scinderParReaffectation([autre], planning, semaines)[0]).toBe(autre);
  });

  it('un seul type réaffecté : le module se scinde d’abord par type', () => {
    const mixte = {
      ...module,
      masses: { presentiel: 40, synchrone: 10 },
      formateursSynchrone: ['BENNANI'],
    };
    const lignes = scinderParReaffectation([mixte], planning, semaines);
    expect(lignes.map((l) => [l.typeSeul, l.termine ?? false])).toEqual([
      ['P', true],
      ['P', false],
      ['S', false],
    ]);
  });
});

describe('fusionnerLigne', () => {
  it('hors de sa plage, les cases de l’autre formateur restent intactes', () => {
    const origine = { 2: { heures: 5, type: 'P' }, 6: { heures: 5, type: 'P' } };
    expect(fusionnerLigne(origine, {}, { plage: { de: 4, a: null } })).toEqual({ 2: { heures: 5, type: 'P' } });
  });
});
