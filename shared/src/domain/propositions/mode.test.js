import { describe, it, expect } from 'vitest';
import { MODES_PROPOSITION, ecartsAuMode, modeDeProposition } from './mode.js';

const s = (jour, seance, groupe, module = 'M101', salle = 'A12', extra = {}) => ({
  jour,
  seance,
  groupe,
  module,
  salle,
  ...extra,
});

describe('modeDeProposition — les trois cas du porteur', () => {
  it('emploi vide, pas de chronogramme : libre', () => {
    expect(modeDeProposition({})).toBe(MODES_PROPOSITION.LIBRE);
  });

  it('emploi planifié par le directeur : déplacer seulement', () => {
    expect(modeDeProposition({ actuelles: [s('Lundi', 'S1', 'GM101')] })).toBe(MODES_PROPOSITION.DEPLACER);
  });

  it('chronogramme présent, emploi vide : importer', () => {
    expect(modeDeProposition({ aImporter: [{ groupe: 'GM101', module: 'M101', nombre: 2 }] })).toBe(
      MODES_PROPOSITION.CHRONOGRAMME
    );
  });

  it('⚠️ l’emploi planifié l’emporte sur le chronogramme', () => {
    expect(
      modeDeProposition({
        actuelles: [s('Lundi', 'S1', 'GM101')],
        aImporter: [{ groupe: 'GM101', module: 'M101', nombre: 2 }],
      })
    ).toBe(MODES_PROPOSITION.DEPLACER);
  });

  it('⚠️ un EFM seul ne rend pas l’emploi « planifié »', () => {
    expect(modeDeProposition({ actuelles: [s('Lundi', 'S1', 'GM101', 'M', '', { estEfm: true })] })).toBe(
      MODES_PROPOSITION.LIBRE
    );
  });

  it('une ligne de chronogramme à zéro séance ne compte pas', () => {
    expect(modeDeProposition({ aImporter: [{ groupe: 'GM101', module: 'M101', nombre: 0 }] })).toBe(
      MODES_PROPOSITION.LIBRE
    );
  });
});

describe('ecartsAuMode — déplacer', () => {
  const actuelles = [s('Lundi', 'S1', 'GM101'), s('Mardi', 'S2', 'GM102', 'M102')];

  it('accepte les mêmes séances à d’autres places', () => {
    const seances = [s('Jeudi', 'S4', 'GM101'), s('Lundi', 'S1', 'GM102', 'M102')];
    expect(ecartsAuMode({ mode: 'deplacer', seances, actuelles })).toEqual([]);
  });

  it('refuse un ajout, un retrait et un changement de salle', () => {
    expect(ecartsAuMode({ mode: 'deplacer', seances: [...actuelles, s('Jeudi', 'S1', 'GM101')], actuelles })).toEqual([
      'Séance ajoutée : GM101 · M101 · A12 — seul un déplacement est permis',
    ]);
    expect(ecartsAuMode({ mode: 'deplacer', seances: [actuelles[0]], actuelles })[0]).toMatch(/^Séance retirée : GM102/);
    expect(
      ecartsAuMode({ mode: 'deplacer', seances: [s('Lundi', 'S1', 'GM101', 'M101', 'B02'), actuelles[1]], actuelles })
    ).toHaveLength(2);
  });

  it('ignore les séances protégées de l’emploi actuel', () => {
    const avecEfm = [...actuelles, s('Mercredi', 'S1', 'GM101', 'EFM', '', { estEfm: true })];
    expect(ecartsAuMode({ mode: 'deplacer', seances: actuelles, actuelles: avecEfm })).toEqual([]);
  });
});

describe('ecartsAuMode — chronogramme', () => {
  const aImporter = [{ groupe: 'GM101 GM102', module: 'M205', nombre: 2 }];

  it('accepte jusqu’au nombre prévu, salle au choix', () => {
    const seances = [s('Lundi', 'S1', 'GM101 GM102', 'M205', 'TEAMS'), s('Mardi', 'S1', 'gm101 gm102', 'm205', '')];
    expect(ecartsAuMode({ mode: 'chronogramme', seances, aImporter })).toEqual([]);
    expect(ecartsAuMode({ mode: 'chronogramme', seances: [], aImporter })).toEqual([]);
  });

  it('refuse une séance hors chronogramme ou en surnombre', () => {
    const trop = [1, 2, 3].map((i) => s('Lundi', `S${i}`, 'GM101 GM102', 'M205'));
    expect(ecartsAuMode({ mode: 'chronogramme', seances: trop, aImporter })).toEqual([
      'GM101 GM102 · M205 : 3 séances pour 2 prévues au chronogramme',
    ]);
    expect(ecartsAuMode({ mode: 'chronogramme', seances: [s('Lundi', 'S1', 'GM101')], aImporter })).toEqual([
      'GM101 · M101 n’est pas au chronogramme de cette semaine',
    ]);
  });
});

describe('ecartsAuMode — libre', () => {
  it('ne contraint rien', () => {
    expect(ecartsAuMode({ mode: 'libre', seances: [s('Lundi', 'S1', 'X')] })).toEqual([]);
  });
});
