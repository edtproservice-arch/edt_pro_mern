import { describe, expect, it } from 'vitest';
import { adopterVersion, creneauSuivant, marquesCopiees, memesEtats } from './appelOutils';

describe('creneauSuivant', () => {
  it('rend le créneau suivant de la journée, jamais le soir', () => {
    expect(creneauSuivant('S1')).toBe('S2');
    expect(creneauSuivant('S3')).toBe('S4');
    expect(creneauSuivant('S4')).toBeNull();
    expect(creneauSuivant('S5')).toBeNull();
  });
});

describe('marquesCopiees', () => {
  const cible = [
    { matricule: 'A', marque: null },
    { matricule: 'B', marque: { type: 'retard' } },
    { matricule: 'C', marque: null },
    { matricule: 'Z', marque: { type: 'absence' } }, // hors de la liste d'origine
  ];

  it('recopie l’état de l’origine tel quel — absents, retards ET présents', () => {
    const { marques, changees } = marquesCopiees(cible, { A: 'absence', B: null, C: 'retard' });
    expect(marques.map((m) => [m.matricule, m.type])).toEqual([
      ['A', 'absence'],
      ['B', null],
      ['C', 'retard'],
      ['Z', 'absence'],
    ]);
    expect(changees).toBe(3);
  });

  it('compte les marques de la cible qu’elle remplace', () => {
    expect(marquesCopiees(cible, { B: 'absence' }).remplacees).toBe(1);
    expect(marquesCopiees(cible, { A: 'absence' }).remplacees).toBe(0);
  });

  it('garde la marque d’un stagiaire que l’origine ne connaît pas, et ne compte rien d’identique', () => {
    const { marques, changees } = marquesCopiees(cible, { A: null, B: 'retard' });
    expect(marques.find((m) => m.matricule === 'Z').type).toBe('absence');
    expect(changees).toBe(0);
  });
});

describe('adopterVersion', () => {
  const m = ['A', 'B'];
  const ancienne = { A: null, B: null };
  const nouvelle = { A: null, B: 'absence' };

  it('adopte la version du serveur quand rien n’est en saisie', () => {
    expect(adopterVersion(ancienne, ancienne, nouvelle, m)).toBe(nouvelle);
  });

  it('garde la saisie en cours', () => {
    const saisie = { A: 'retard', B: null };
    expect(adopterVersion(saisie, ancienne, nouvelle, m)).toBe(saisie);
  });

  // Le défaut du 2026-09-14 : comparer à la NOUVELLE référence gardait la copie en cache.
  it('comparée à la nouvelle version au lieu de l’ancienne, elle garderait la copie périmée', () => {
    expect(adopterVersion(ancienne, nouvelle, nouvelle, m)).toBe(ancienne);
  });
});

describe('memesEtats', () => {
  it('compare stagiaire par stagiaire, un état absent valant « présent »', () => {
    expect(memesEtats({ A: null }, {}, ['A'])).toBe(true);
    expect(memesEtats({ A: 'absence' }, { A: null }, ['A'])).toBe(false);
  });
});
