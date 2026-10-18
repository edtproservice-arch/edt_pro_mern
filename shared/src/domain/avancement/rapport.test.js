import { describe, it, expect } from 'vitest';
import { rapportAvancement } from './rapport.js';

const ligne = (surcharges = {}) => ({
  groupe: 'SMP201',
  fusionGroupe: '',
  module: 'EGQ202',
  semestre: 'S1',
  annee: '2',
  formateurPresentiel: 'ZINEB EL OMARI',
  formateurSynchrone: 'ZINEB EL OMARI',
  prevuPresentiel: 75,
  prevuSynchrone: 20,
  realisePresentiel: 30,
  realiseSynchrone: 10,
  estRegional: false,
  ...surcharges,
});

describe('rapportAvancement — le rapport d’un formateur ou d’un groupe', () => {
  it('un formateur : un module par groupe, le groupe en complément, l’intitulé du groupe', () => {
    const rapport = rapportAvancement(
      [ligne(), ligne({ groupe: 'SMP202' }), ligne({ formateurPresentiel: 'AUTRE', formateurSynchrone: 'AUTRE', module: 'EGQ203' })],
      {
        type: 'formateur',
        sujet: 'ZINEB EL OMARI',
        intitules: { EGQ202: 'Intitulé général' },
        intitulesParGroupe: { 'SMP202||EGQ202': 'Intitulé de SMP202' },
      }
    );

    const parts = { affectePresentiel: 75, affecteDistanciel: 20, realisePresentiel: 30, realiseDistanciel: 10 };
    expect(rapport.lignes).toEqual([
      { module: 'EGQ202', intitule: 'Intitulé général', complement: 'SMP201', affecte: 95, realise: 40, ...parts },
      { module: 'EGQ202', intitule: 'Intitulé de SMP202', complement: 'SMP202', affecte: 95, realise: 40, ...parts },
    ]);
    expect(rapport.total).toMatchObject({ affecte: 190, realise: 80, affectePresentiel: 150, affecteDistanciel: 40 });
  });

  it('⚠️ un formateur ne porte que SES heures : le synchrone assuré par un collègue est retiré', () => {
    const rapport = rapportAvancement([ligne({ formateurSynchrone: 'COLLÈGUE' })], {
      type: 'formateur',
      sujet: 'ZINEB EL OMARI',
    });

    expect(rapport.lignes[0]).toMatchObject({ affecte: 75, realise: 30, affecteDistanciel: 0 });
    expect(rapport.total).toMatchObject({ affecte: 75, realise: 30 });
  });

  it('⚠️ une séance synchrone mutualisée ne compte qu’une fois dans le total', () => {
    const rapport = rapportAvancement(
      [ligne({ fusionGroupe: 'SMP201 SMP202' }), ligne({ groupe: 'SMP202', fusionGroupe: 'SMP201 SMP202' })],
      { type: 'formateur', sujet: 'ZINEB EL OMARI' }
    );

    // Deux lignes (une par groupe), mais 20 h synchrones prévues une seule fois.
    expect(rapport.lignes).toHaveLength(2);
    expect(rapport.total).toMatchObject({ affecte: 170, realise: 70, affecteDistanciel: 20 });
  });

  it('un groupe : ses modules, leurs formateurs en complément ; les autres filtres de la page s’appliquent', () => {
    const brutes = [
      ligne(),
      ligne({ module: 'EGQ210', semestre: 'S2', formateurPresentiel: 'AHMED', formateurSynchrone: '' }),
      ligne({ groupe: 'SMP202', module: 'EGQ999' }),
    ];

    const tous = rapportAvancement(brutes, { type: 'groupe', sujet: 'SMP201' });
    expect(tous.lignes.map((l) => [l.module, l.complement])).toEqual([
      ['EGQ202', 'ZINEB EL OMARI'],
      ['EGQ210', 'AHMED'],
    ]);

    const s1 = rapportAvancement(brutes, { type: 'groupe', sujet: 'SMP201', filtres: { semestre: ['S1'], groupe: ['SMP202'] } });
    expect(s1.lignes.map((l) => l.module)).toEqual(['EGQ202']);
  });

  it('écarte les modules sans aucune heure, affectée ou réalisée', () => {
    const rapport = rapportAvancement(
      [ligne({ prevuPresentiel: 0, prevuSynchrone: 0, realisePresentiel: 0, realiseSynchrone: 0 })],
      { type: 'groupe', sujet: 'SMP201' }
    );
    expect(rapport.lignes).toEqual([]);
  });
});
