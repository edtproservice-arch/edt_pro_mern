import { describe, it, expect } from 'vitest';
import { etatDuBloc, instantPresent } from './etatAgenda.js';

const matinee = { horaires: [{ debut: '08:30', fin: '11:00' }, { debut: '11:00', fin: '13:30' }] };
// Vendredi S2 + S3 : un écart RÉEL de deux heures (12:30 → 14:30).
const vendredi = { horaires: [{ debut: '10:30', fin: '12:30' }, { debut: '14:30', fin: '16:30' }] };

const le = (heure) => ({ date: '2026-09-12', heure });

describe('etatDuBloc', () => {
  it('un jour passé est terminé, un jour à venir est à venir', () => {
    expect(etatDuBloc(matinee, '2026-09-11', le('09:00')).etat).toBe('termine');
    expect(etatDuBloc(matinee, '2026-09-14', le('09:00')).etat).toBe('avenir');
  });

  it("aujourd'hui, avant le début : « aujourd'hui » ; après la fin : terminé", () => {
    expect(etatDuBloc(matinee, '2026-09-12', le('07:45')).etat).toBe('aujourdhui');
    expect(etatDuBloc(matinee, '2026-09-12', le('13:30')).etat).toBe('termine');
  });

  it('pendant le bloc : en cours, avec le créneau courant et la progression', () => {
    expect(etatDuBloc(matinee, '2026-09-12', le('08:30'))).toEqual({
      etat: 'encours',
      creneauCourant: 0,
      progression: 0,
    });
    const midi = etatDuBloc(matinee, '2026-09-12', le('11:00'));
    expect(midi).toMatchObject({ etat: 'encours', creneauCourant: 1, progression: 0.5 });
  });

  it("⚠️ dans l'écart réel du Vendredi : en PAUSE, pas en cours", () => {
    expect(etatDuBloc(vendredi, '2026-09-12', le('13:15'))).toMatchObject({
      etat: 'pause',
      creneauCourant: null,
    });
    expect(etatDuBloc(vendredi, '2026-09-12', le('14:30'))).toMatchObject({
      etat: 'encours',
      creneauCourant: 1,
    });
  });

  it('sans date ni horaire, rien à dire', () => {
    expect(etatDuBloc(matinee, undefined, le('09:00')).etat).toBe('inconnu');
    expect(etatDuBloc({}, '2026-09-12', le('09:00')).etat).toBe('inconnu');
  });
});

describe('instantPresent', () => {
  it("rend la date et l'heure LOCALES, avec leurs zéros de tête", () => {
    expect(instantPresent(new Date(2026, 8, 5, 8, 7))).toEqual({ date: '2026-09-05', heure: '08:07' });
  });
});
