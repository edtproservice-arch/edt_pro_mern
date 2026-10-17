import { describe, expect, it } from 'vitest';
import {
  calculerHeuresSupp,
  moisDeLaSemaine,
  quotaHeuresSupp,
  regimeFormateur,
  semaineCalendaire,
  seuilHebdomadaire,
} from './heuresSupplementaires.js';

describe('seuilHebdomadaire', () => {
  it('descend de 6 h puis de 5 h par jour fermé', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((n) => seuilHebdomadaire(n))).toEqual([26, 20, 15, 10, 5, 0, 0, 0]);
  });

  it('part de 36 h pour un formateur à 1260 h', () => {
    expect([0, 1, 2, 3].map((n) => seuilHebdomadaire(n, 36))).toEqual([36, 30, 25, 20]);
  });
});

describe('regimeFormateur', () => {
  it('910 h → 26 h, 1260 h → 36 h, le reste est vacataire', () => {
    expect(regimeFormateur(910)).toEqual({ statut: 'permanent', mhs: 26 });
    expect(regimeFormateur(1260)).toEqual({ statut: 'permanent', mhs: 36 });
    expect(regimeFormateur(1000)).toEqual({ statut: 'vacataire', mhs: null });
    expect(regimeFormateur(0)).toEqual({ statut: 'inconnu', mhs: null });
  });
});

describe('moisDeLaSemaine', () => {
  it('range la semaine dans le mois de son jeudi', () => {
    expect(moisDeLaSemaine('2025-09-29')).toBe('2025-10'); // 29 sept → 5 oct
    expect(moisDeLaSemaine('2025-12-29')).toBe('2026-01');
    expect(moisDeLaSemaine('2026-04-27')).toBe('2026-04'); // jeudi 30 avril
  });
});

describe('semaineCalendaire', () => {
  it('suit la norme ISO 8601', () => {
    expect(semaineCalendaire('2026-09-28')).toBe(40); // état « S-40 » du porteur
    expect(semaineCalendaire('2026-10-26')).toBe(44);
    expect(semaineCalendaire('2026-12-28')).toBe(53); // 2026 a 53 semaines
    expect(semaineCalendaire('2027-01-04')).toBe(1);
    expect(semaineCalendaire('2025-12-29')).toBe(1); // la S1 de 2026 commence en 2025
  });
});

describe('quotaHeuresSupp', () => {
  it('affecté − statutaire, jamais négatif, nul sans statutaire', () => {
    expect(quotaHeuresSupp(1000, 910)).toBe(90);
    expect(quotaHeuresSupp(800, 910)).toBe(0);
    expect(quotaHeuresSupp(1000, 0)).toBe(0);
    expect(quotaHeuresSupp(1400, 1260)).toBe(140);
    expect(quotaHeuresSupp(1200, 1000)).toBe(0); // vacataire
  });
});

describe('calculerHeuresSupp', () => {
  const semaine = (numero, lundi, heures, joursFermes = 0) => ({ numero, lundi, heures, joursFermes });

  it('ne compte que les heures entre le seuil et 35 h', () => {
    const { semaines } = calculerHeuresSupp({
      quota: 500,
      semaines: [
        semaine(1, '2025-09-01', 35),
        semaine(2, '2025-09-08', 40), // au-delà de 35 h : ignoré
        semaine(3, '2025-09-15', 30, 1), // un férié : seuil 20
        semaine(4, '2025-09-22', 20),
      ],
    });
    expect(semaines.map((s) => s.brut)).toEqual([9, 9, 10, 0]);
    expect(semaines.map((s) => s.horsPlafond)).toEqual([0, 5, 0, 0]);
  });

  it('plafonne le payé à 30 h par mois', () => {
    const resultat = calculerHeuresSupp({
      quota: 500,
      semaines: [
        semaine(5, '2025-10-06', 35),
        semaine(6, '2025-10-13', 35),
        semaine(7, '2025-10-20', 35),
        semaine(8, '2025-10-27', 35), // jeudi 30 octobre
      ],
    });
    expect(resultat.mois).toEqual([{ mois: '2025-10', heures: 140, objectif: 104, brut: 36, paye: 30 }]);
    expect(resultat.semaines.map((s) => s.paye)).toEqual([9, 9, 9, 3]);
    expect(resultat.semaines.map((s) => s.cumulMois)).toEqual([9, 18, 27, 30]);
    expect(resultat.semaines.map((s) => s.nonPaye)).toEqual([null, null, null, 'plafondMois']);
  });

  it('un formateur à 36 h n’a d’HS que les semaines où un férié baisse le seuil', () => {
    const { semaines } = calculerHeuresSupp({
      quota: 100,
      mhs: 36,
      semaines: [semaine(1, '2025-09-01', 35), semaine(2, '2025-09-08', 35, 1)],
    });
    expect(semaines.map((s) => [s.seuil, s.brut])).toEqual([[36, 0], [30, 5]]);
  });

  it('un vacataire n’a aucune heure supplémentaire', () => {
    const resultat = calculerHeuresSupp({ quota: 0, mhs: null, semaines: [semaine(1, '2025-09-01', 40)] });
    expect(resultat.semaines[0]).toMatchObject({ seuil: null, brut: 0, paye: 0, horsPlafond: 0 });
    expect(resultat.totaux).toMatchObject({ heures: 40, objectif: 0, brut: 0 });
  });

  it('ne compte ni juillet ni août', () => {
    const resultat = calculerHeuresSupp({
      quota: 100,
      semaines: [
        semaine(43, '2027-06-28', 35), // jeudi 1er juillet
        semaine(48, '2027-08-02', 35),
        semaine(42, '2027-06-21', 35),
      ],
    });
    expect(resultat.semaines.map((s) => s.numero)).toEqual([42]);
    expect(resultat.mois.map((m) => m.mois)).toEqual(['2027-06']);
    expect(resultat.totaux).toMatchObject({ heures: 35, brut: 9 });
  });

  it('cesse de compter une fois le quota épuisé', () => {
    const resultat = calculerHeuresSupp({
      quota: 20,
      semaines: [
        semaine(1, '2025-09-01', 35),
        semaine(2, '2025-09-08', 35),
        semaine(3, '2025-09-15', 35),
        semaine(10, '2025-11-03', 35),
      ],
    });
    expect(resultat.semaines.map((s) => s.paye)).toEqual([9, 9, 2, 0]);
    expect(resultat.semaines.map((s) => s.nonPaye)).toEqual([null, null, 'quota', 'quota']);
    expect(resultat.semaines.map((s) => s.restant)).toEqual([11, 2, 0, 0]);
    expect(resultat.totaux).toMatchObject({ paye: 20, quota: 20, restant: 0, brut: 36 });
  });
});
