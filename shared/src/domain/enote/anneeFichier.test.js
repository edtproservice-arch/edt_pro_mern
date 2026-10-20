import { describe, it, expect } from 'vitest';
import { lireDate, verifierAnneeFichier } from './anneeFichier.js';
import { ENTETES_ENOTE } from './colonnes.js';

/** Ligne dont la colonne B (« Année ») vaut `annee`, et la colonne A `date`. */
const ligne = (annee, date = '') => {
  const cellules = new Array(51).fill('');
  cellules[0] = date;
  cellules[1] = annee;
  return cellules;
};

describe('verifierAnneeFichier', () => {
  it("admet les deux années civiles de l'année scolaire", () => {
    const resultat = verifierAnneeFichier([ligne('2026'), ligne('2027'), ligne(2026)], 2026);
    expect(resultat).toMatchObject({ conforme: true, admises: [2026, 2027], lignesHorsAnnee: 0 });
  });

  it("refuse une autre année, et dit laquelle", () => {
    const resultat = verifierAnneeFichier([ligne('2026'), ligne('2025'), ligne('2025'), ligne('2028')], 2026);
    expect(resultat).toMatchObject({ conforme: false, horsAnnee: [2025, 2028], lignesHorsAnnee: 3 });
  });

  it('lit une année écrite « 2025/2026 » ou dans une date', () => {
    expect(verifierAnneeFichier([ligne('2026/2027')], 2026).conforme).toBe(true);
    expect(verifierAnneeFichier([ligne('2025/2026')], 2026).conforme).toBe(false);
    expect(verifierAnneeFichier([ligne('15/09/2026')], 2026).conforme).toBe(true);
  });

  it('ne compte pas une cellule sans année', () => {
    expect(verifierAnneeFichier([ligne(''), ligne('2026')], 2026).conforme).toBe(true);
  });

  it("repère la colonne par son nom quand l'en-tête est là", () => {
    const entete = ['Autre', ...ENTETES_ENOTE];
    const decalee = ['', ...ligne('2025')];
    expect(verifierAnneeFichier([decalee], 2026, entete).conforme).toBe(false);
  });
});

describe('verifierAnneeFichier — date de mise à jour (colonne A)', () => {
  it("⚠️ refuse un export de 2025-2026 même si la colonne B dit 2026", () => {
    const resultat = verifierAnneeFichier([ligne('2026', '15/05/2026 09:30:00')], 2026);
    expect(resultat).toMatchObject({
      conforme: false,
      lignesHorsAnnee: 0,
      lignesDateHorsPeriode: 1,
      datesHorsPeriode: ['15/05/2026'],
      periode: { debut: '01/08/2026', fin: '31/07/2027' },
    });
  });

  it("admet toute date de l'année scolaire, bornes comprises", () => {
    for (const date of ['01/08/2026', '19/10/2026 10:00:00', '2027-03-01', '31/07/2027 23:59:59']) {
      expect(verifierAnneeFichier([ligne('2026', date)], 2026).conforme).toBe(true);
    }
  });

  it("refuse la veille et le lendemain de l'année scolaire", () => {
    expect(verifierAnneeFichier([ligne('2026', '31/07/2026')], 2026).conforme).toBe(false);
    expect(verifierAnneeFichier([ligne('2027', '01/08/2027')], 2026).conforme).toBe(false);
  });

  it('ne compte pas une date absente ou illisible', () => {
    expect(verifierAnneeFichier([ligne('2026', ''), ligne('2026', 'n/a')], 2026).conforme).toBe(true);
  });
});

describe('lireDate', () => {
  const jour = (date) => date && [date.getFullYear(), date.getMonth() + 1, date.getDate()];

  it('lit les formats rencontrés', () => {
    expect(jour(lireDate('19/10/2026 10:00:00'))).toEqual([2026, 10, 19]);
    expect(jour(lireDate('19-10-2026'))).toEqual([2026, 10, 19]);
    expect(jour(lireDate('2026-10-19T08:00:00.000Z'))).toEqual([2026, 10, 19]);
    expect(jour(lireDate(String(new Date(2026, 9, 19))))).toEqual([2026, 10, 19]);
    expect(jour(lireDate('46314'))).toEqual([2026, 10, 19]);
  });

  it('écarte ce qui n’est pas une date sûre', () => {
    expect(lireDate('')).toBeNull();
    expect(lireDate('31/02/2026')).toBeNull();
    expect(lireDate('10/19/26')).toBeNull();
    expect(lireDate('2026')).toBeNull();
  });
});
