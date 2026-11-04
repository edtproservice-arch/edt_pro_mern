import { describe, expect, it } from 'vitest';
import { cleFusion, sansSynchroneEnDouble } from './reconstruction.js';

/*
 * 2026-11-04, retour du porteur : M204 de GEOCF201/GEOCF202 — 15 h de synchrone
 * mutualisé — affiché 30 h au chronogramme d'AYOUB FOULAL.
 */
const synchrone = (groupe, autres = {}) => ({
  formateur: 'BM15058',
  groupe,
  module: 'M204',
  type: 'synchrone',
  s1Heures: 15,
  s2Heures: 0,
  ...autres,
});
const presentiel = (groupe) => ({ formateur: 'BM15058', groupe, module: 'M204', type: 'presentiel', s1Heures: 45, s2Heures: 0 });

describe('cleFusion', () => {
  it('ne dépend pas de l’ordre ni de la casse', () => {
    expect(cleFusion('GEOCF202 GEOCF201')).toBe(cleFusion('geocf201 GEOCF202'));
  });

  it('garde les suffixes attachés à leur groupe', () => {
    expect(cleFusion('PIE102 (FQ) PIE101 (FQ)')).toBe('PIE101 (FQ) PIE102 (FQ)');
  });
});

describe('sansSynchroneEnDouble — une séance mutualisée comptée une fois', () => {
  it('écarte la même séance écrite dans l’autre ordre', () => {
    const affectations = [
      presentiel('GEOCF201'),
      synchrone('GEOCF201 GEOCF202'),
      presentiel('GEOCF202'),
      synchrone('GEOCF202 GEOCF201'),
    ];
    const resultat = sansSynchroneEnDouble(affectations);
    expect(resultat.filter((a) => a.type === 'synchrone')).toHaveLength(1);
    // Le présentiel n'est jamais touché : deux groupes en salle, deux cours.
    expect(resultat.filter((a) => a.type === 'presentiel')).toHaveLength(2);
  });

  it('garde deux séances réellement différentes', () => {
    const autreFormateur = sansSynchroneEnDouble([
      synchrone('GEOCF201 GEOCF202'),
      synchrone('GEOCF201 GEOCF202', { formateur: '9518' }),
    ]);
    expect(autreFormateur).toHaveLength(2);

    const autresGroupes = sansSynchroneEnDouble([synchrone('GEOCF201 GEOCF202'), synchrone('GEOCF201')]);
    expect(autresGroupes).toHaveLength(2);
  });
});
