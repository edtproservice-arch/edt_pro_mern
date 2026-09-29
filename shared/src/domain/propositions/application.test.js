import { describe, it, expect } from 'vitest';
import {
  estProtegee,
  identiques,
  joursVises,
  normaliserProposition,
  planDuJour,
  statutGlobal,
} from './application.js';

const s = (seance, groupe, module = 'M101', salle = 'A12', extra = {}) => ({
  jour: 'Lundi',
  seance,
  groupe,
  module,
  salle,
  ...extra,
});

describe('planDuJour — appliquer REMPLACE le jour', () => {
  it('pose le nouveau, vide ce que la proposition laisse vide, garde l’identique', () => {
    const plan = planDuJour({
      jour: 'Lundi',
      cible: [s('S1', 'DEV101'), s('S3', 'DEV102')],
      actuelles: [s('S1', 'DEV101'), s('S2', 'DEV103'), s('S3', 'DEV104')],
    });
    expect(plan.inchangees.map((x) => x.seance)).toEqual(['S1']);
    expect(plan.aVider.map((x) => x.seance)).toEqual(['S2', 'S3']);
    expect(plan.aPoser.map((x) => x.seance)).toEqual(['S3']);
    expect(plan.bloquantes).toEqual([]);
  });

  it('reconnaît l’identique sans casse ni espaces superflus', () => {
    const plan = planDuJour({
      jour: 'Lundi',
      cible: [s('S1', 'dev101 ', 'm101', ' a12')],
      actuelles: [s('S1', 'DEV101')],
    });
    expect(plan.inchangees).toHaveLength(1);
    expect(plan.aPoser).toHaveLength(0);
  });

  it('ignore les autres jours, la S5 et la période du soir', () => {
    const plan = planDuJour({
      jour: 'Lundi',
      cible: [{ ...s('S1', 'DEV101'), jour: 'Mardi' }],
      actuelles: [
        s('S5', 'DEV101'),
        s('S2', 'DEV101', 'M1', '', { periode: 'soir' }),
        { ...s('S1', 'X'), jour: 'Mardi' },
      ],
    });
    expect(plan).toEqual({ aVider: [], aPoser: [], inchangees: [], protegees: [], bloquantes: [] });
  });

  it('une séance protégée RESTE quand la proposition laisse son créneau vide', () => {
    const efm = s('S2', 'DEV101', 'M101', 'A1', { estEfm: true });
    const plan = planDuJour({ jour: 'Lundi', cible: [], actuelles: [efm] });
    expect(plan.protegees).toEqual([efm]);
    expect(plan.aVider).toEqual([]);
    expect(plan.bloquantes).toEqual([]);
  });

  it('une séance protégée BLOQUE quand la proposition y met autre chose', () => {
    const plan = planDuJour({
      jour: 'Lundi',
      cible: [s('S2', 'DEV102')],
      actuelles: [s('S2', 'DEV101', 'M101', 'A12', { statut: 'absent' })],
    });
    expect(plan.bloquantes).toEqual([{ seance: 'S2', message: 'Lundi S2 : une absence occupe déjà ce créneau' }]);
    expect(plan.aPoser).toEqual([]);
  });

  it('une séance protégée identique à la proposition ne bloque pas', () => {
    const plan = planDuJour({
      jour: 'Lundi',
      cible: [s('S2', 'DEV101')],
      actuelles: [s('S2', 'DEV101', 'M101', 'A12', { estEfm: true })],
    });
    expect(plan.bloquantes).toEqual([]);
  });

  it('nomme chaque protection', () => {
    const bloque = (extra) =>
      planDuJour({ jour: 'Lundi', cible: [s('S1', 'Y')], actuelles: [s('S1', 'X', 'M', '', extra)] }).bloquantes[0]
        .message;
    expect(bloque({ estEfm: true })).toContain('un EFM');
    expect(bloque({ rattrapageDe: 'abc' })).toContain('un rattrapage');
    expect(bloque({ statut: 'rattrape' })).toContain('un rattrapage');
    expect(bloque({ statut: 'autre' })).toContain('une séance protégée');
  });

  it('refuse un jour inconnu', () => {
    expect(() => planDuJour({ jour: 'Dimanche' })).toThrow(TypeError);
  });
});

describe('estProtegee / identiques', () => {
  it('un statut absent vaut « planifié »', () => {
    expect(estProtegee({})).toBe(false);
    expect(estProtegee({ statut: 'planifie' })).toBe(false);
    expect(estProtegee({ estEfm: true })).toBe(true);
  });

  it('compare groupe, module et salle', () => {
    expect(identiques(s('S1', 'A'), s('S1', 'A'))).toBe(true);
    expect(identiques(s('S1', 'A'), s('S1', 'A', 'M101', 'B'))).toBe(false);
  });
});

describe('normaliserProposition', () => {
  it('trie par jour puis par créneau, salle vide par défaut', () => {
    const { seances, motif } = normaliserProposition({
      seances: [
        { jour: 'Mardi', seance: 'S1', groupe: 'B', module: 'M' },
        { jour: 'Lundi', seance: 'S3', groupe: 'A', module: 'M', salle: ' A12 ' },
      ],
    });
    expect(seances.map((x) => `${x.jour} ${x.seance}`)).toEqual(['Lundi S3', 'Mardi S1']);
    expect(seances[0].salle).toBe('A12');
    expect(seances[1].salle).toBe('');
    expect(motif).toBe('');
  });

  it('refuse deux séances sur le même créneau', () => {
    expect(() =>
      normaliserProposition({
        seances: [
          { jour: 'Lundi', seance: 'S1', groupe: 'A', module: 'M' },
          { jour: 'Lundi', seance: 'S1', groupe: 'B', module: 'M' },
        ],
      })
    ).toThrow(expect.objectContaining({ code: 'PROPOSITION_INVALIDE' }));
  });

  it('refuse une proposition vide, la S5, et un formateur glissé par le client', () => {
    expect(() => normaliserProposition({ seances: [] })).toThrow(/au moins une séance/);
    expect(() =>
      normaliserProposition({ seances: [{ jour: 'Lundi', seance: 'S5', groupe: 'A', module: 'M' }] })
    ).toThrow();
    expect(() =>
      normaliserProposition({
        seances: [{ jour: 'Lundi', seance: 'S1', groupe: 'A', module: 'M' }],
        formateurMatricule: '9863',
      })
    ).toThrow();
  });
});

describe('statutGlobal', () => {
  const tous = (etat) =>
    Object.fromEntries(['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'].map((j) => [j, etat]));

  it('se déduit des jours', () => {
    expect(statutGlobal()).toBe('en_attente');
    expect(statutGlobal({ Lundi: 'appliquee' })).toBe('partielle');
    expect(statutGlobal(tous('appliquee'))).toBe('appliquee');
    expect(statutGlobal(tous('refusee'))).toBe('refusee');
  });
});

describe('joursVises', () => {
  it('un jour, ou toute la semaine', () => {
    expect(joursVises('Mardi')).toEqual(['Mardi']);
    expect(joursVises()).toHaveLength(6);
  });
});
