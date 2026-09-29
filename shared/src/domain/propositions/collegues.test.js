import { describe, it, expect } from 'vitest';
import { conflitAvecCollegues, conflitsAvecCollegues } from './collegues.js';

const collegue = {
  auteur: 'SOUFIANE AZHAR',
  seances: [
    { jour: 'Lundi', seance: 'S1', groupe: 'DEV101', module: 'M101', salle: 'A12' },
    { jour: 'Mardi', seance: 'S2', groupe: 'GM101 GM102', module: 'M205', salle: 'TEAMS' },
    { jour: 'Mercredi', seance: 'S3', groupe: 'APILC101 (FQ)', module: 'M110', salle: 'B3' },
  ],
};

describe('conflitAvecCollegues — la case « RÉSERVÉ »', () => {
  it('le même groupe sur le même créneau', () => {
    const conflit = conflitAvecCollegues({ jour: 'Lundi', seance: 'S1', groupe: 'DEV101', salle: 'B1' }, [collegue]);
    expect(conflit).toMatchObject({ type: 'groupe', auteur: 'SOUFIANE AZHAR' });
  });

  it('la même salle réelle, avec un autre groupe, sans tenir compte de la casse', () => {
    const conflit = conflitAvecCollegues({ jour: 'Lundi', seance: 'S1', groupe: 'DEV102', salle: 'a12' }, [collegue]);
    expect(conflit).toMatchObject({ type: 'salle' });
    expect(conflit.message).toContain('a12');
  });

  it('TEAMS n’est pas un local : aucun conflit de salle', () => {
    expect(
      conflitAvecCollegues({ jour: 'Mardi', seance: 'S2', groupe: 'DEV101', salle: 'TEAMS' }, [collegue])
    ).toBeNull();
  });

  it('un membre d’une fusion heurte la fusion', () => {
    expect(
      conflitAvecCollegues({ jour: 'Mardi', seance: 'S2', groupe: 'GM102', salle: 'C1' }, [collegue])
    ).toMatchObject({ type: 'groupe' });
  });

  it('un constituant heurte son groupe FQ — et seulement si la composition est connue', () => {
    const groupesFq = [{ groupeFq: 'APILC101 (FQ)', groupeConstituant: 'EEM101' }];
    const candidate = { jour: 'Mercredi', seance: 'S3', groupe: 'EEM101', salle: '' };
    expect(conflitAvecCollegues(candidate, [collegue], { groupesFq })).toMatchObject({ type: 'groupe' });
    expect(conflitAvecCollegues(candidate, [collegue])).toBeNull();
  });

  it('un autre créneau ne gêne pas', () => {
    expect(
      conflitAvecCollegues({ jour: 'Lundi', seance: 'S2', groupe: 'DEV101', salle: 'A12' }, [collegue])
    ).toBeNull();
  });

  it('sans proposition de collègue, rien n’est réservé', () => {
    expect(conflitAvecCollegues({ jour: 'Lundi', seance: 'S1', groupe: 'DEV101' })).toBeNull();
  });
});

describe('conflitsAvecCollegues', () => {
  it('ne rend que les séances en conflit', () => {
    const resultat = conflitsAvecCollegues(
      [
        { jour: 'Lundi', seance: 'S1', groupe: 'DEV101', salle: '' },
        { jour: 'Lundi', seance: 'S2', groupe: 'DEV101', salle: '' },
      ],
      [collegue]
    );
    expect(resultat).toHaveLength(1);
    expect(resultat[0].seance.seance).toBe('S1');
  });
});
