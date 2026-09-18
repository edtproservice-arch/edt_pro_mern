import { describe, expect, it } from 'vitest';
import { evaluerCase } from './placementRattrapage';

const absence = {
  semaine: '2026-W3',
  jour: 'Lundi',
  seance: 'S1',
  formateurMatricule: '9863',
  groupe: 'GM101',
  module: 'M101',
  salle: 'A12',
};

const creneau = { semaine: '2026-W4', jour: 'Lundi', seance: 'S2' };
const jourOuvert = { jour: 'Lundi', date: '2026-09-21', stages: [], formations: [], rentreesGelees: [] };

const evaluer = (surcharges = {}) =>
  evaluerCase({
    absence,
    creneau,
    seancesDuCreneau: [],
    etatDuJour: jourOuvert,
    salles: ['A12', 'B02'],
    ...surcharges,
  });

describe('evaluerCase — un clic place le rattrapage', () => {
  it('prend la SALLE DU COURS MANQUÉ quand elle est libre', () => {
    expect(evaluer()).toEqual({ ok: true, salle: 'A12', salleDOrigine: true });
  });

  it('⚠️ PREND LA PREMIÈRE SALLE LIBRE quand celle d’origine est occupée', () => {
    const resultat = evaluer({
      seancesDuCreneau: [{ id: 'x', formateurMatricule: '1', groupe: 'PM101', module: 'M1', salle: 'A12' }],
    });
    expect(resultat).toEqual({ ok: true, salle: 'B02', salleDOrigine: false });
  });

  it('refuse quand AUCUNE salle n’est libre', () => {
    const seancesDuCreneau = ['A12', 'B02'].map((salle, rang) => ({
      id: String(rang),
      formateurMatricule: `F${rang}`,
      groupe: `G${rang}`,
      module: 'M1',
      salle,
    }));
    expect(evaluer({ seancesDuCreneau })).toMatchObject({ ok: false });
  });

  it('⚠️ UN COURS À DISTANCE RESTE SUR TEAMS, même si des salles sont prises', () => {
    const resultat = evaluer({ absence: { ...absence, salle: 'TEAMS', groupe: 'GM101 GM102' } });
    expect(resultat).toMatchObject({ ok: true, salle: 'TEAMS' });
  });

  it('refuse un créneau où le GROUPE a déjà cours — y compris par une fusion', () => {
    const resultat = evaluer({
      seancesDuCreneau: [
        { id: 'y', formateurMatricule: '2', groupe: 'GM101 GM102', module: 'M2', salle: 'TEAMS' },
      ],
    });
    expect(resultat).toMatchObject({ ok: false, motif: expect.stringContaining('GM101 GM102') });
  });

  it('refuse un créneau où le FORMATEUR est déjà pris', () => {
    const resultat = evaluer({
      seancesDuCreneau: [{ id: 'z', formateurMatricule: '9863', groupe: 'PM101', module: 'M3', salle: 'B02' }],
    });
    expect(resultat.ok).toBe(false);
  });

  it('⚠️ LE RATTRAPAGE DÉJÀ POSÉ NE COMPTE PAS : il va être déplacé', () => {
    const resultat = evaluer({
      seancesDuCreneau: [{ id: 'r', formateurMatricule: '9863', groupe: 'GM101', module: 'M101', salle: 'A12' }],
      ignorer: ['r'],
    });
    expect(resultat).toMatchObject({ ok: true, salle: 'A12' });
  });

  it('refuse le créneau manqué lui-même, un férié, des vacances', () => {
    expect(evaluer({ creneau: { semaine: '2026-W3', jour: 'Lundi', seance: 'S1' } }).ok).toBe(false);
    expect(evaluer({ etatDuJour: { ...jourOuvert, ferie: { intitule: 'Aïd' } } }).ok).toBe(false);
    expect(evaluer({ etatDuJour: { ...jourOuvert, vacances: true } }).ok).toBe(false);
  });

  it('refuse un groupe en STAGE, pas encore RENTRÉ, ou un formateur en FORMATION', () => {
    expect(evaluer({ etatDuJour: { ...jourOuvert, stages: [{ groupe: 'gm101' }] } }).ok).toBe(false);
    expect(
      evaluer({ etatDuJour: { ...jourOuvert, rentreesGelees: [{ anneeFormation: 1, date: '2026-09-25' }] } })
    ).toMatchObject({ ok: false, motif: expect.stringContaining('2026-09-25') });
    expect(evaluer({ etatDuJour: { ...jourOuvert, formations: [{ matricule: '9863' }] } }).ok).toBe(false);
  });
});
