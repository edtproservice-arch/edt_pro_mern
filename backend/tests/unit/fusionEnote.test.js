import { describe, it, expect } from 'vitest';
import { TYPES_COURS } from 'shared/constants';
import { fusionnerAvecExistante } from '../../src/modules/base/enoteImport.service.js';

/**
 * ═══ L'IMPORT HEBDOMADAIRE GARDE CE QUI A ÉTÉ FAIT DANS eDTpro (2026-10-10) ═══
 * La base en place fait foi ; le fichier n'ajoute que ce qu'elle ne connaît pas.
 */
const aff = (groupe, module, formateur, s1Heures, type = TYPES_COURS.PRESENTIEL) => ({
  groupe,
  module,
  formateur,
  type,
  s1Heures,
  s2Heures: 0,
});

const existante = {
  formateurs: [
    { nomComplet: 'ALAMI SARA', matricule: '1001', email: 'sara@ofppt.ma', masseHoraire: 910 },
  ],
  // GM199 : groupe créé dans eDTpro, absent d'e-note.
  groupes: ['GM101', 'GM199'],
  fusionGroupes: [],
  // M101 réaffecté à 1001 et ramené à 45 h dans eDTpro.
  affectations: [aff('GM101', 'M101', '1001', 45), aff('GM199', 'M102', '1001', 30)],
  groupeModes: new Map([['GM101', 'Alterné']]),
};

const fichier = {
  formateurs: ['x'],
  formateursDetails: [
    { nomComplet: 'ALAMI SARA', matricule: '1001', email: '', masseHoraire: 910 },
    { nomComplet: 'BENNANI ALI', matricule: '2002', email: '', masseHoraire: 910 },
  ],
  groupes: ['GM101', 'GM102'],
  fusionGroupes: [],
  affectations: [aff('GM101', 'M101', '2002', 30), aff('GM102', 'M101', '2002', 30)],
  groupeModes: { GM101: 'Résidentiel', GM102: 'Résidentiel' },
};

describe('fusionnerAvecExistante', () => {
  const { structure, ajouts } = fusionnerAvecExistante(existante, fichier);

  it('garde les affectations faites dans eDTpro, et n’ajoute que les nouvelles', () => {
    expect(structure.affectations).toEqual([
      aff('GM101', 'M101', '1001', 45),
      aff('GM199', 'M102', '1001', 30),
      aff('GM102', 'M101', '2002', 30),
    ]);
  });

  it('ne retire aucun groupe, et ajoute ceux du fichier', () => {
    expect(structure.groupes).toEqual(['GM101', 'GM102', 'GM199']);
  });

  it('garde les formateurs connus tels quels (adresse comprise), et ajoute les nouveaux', () => {
    expect(structure.formateursDetails.map((f) => [f.matricule, f.email])).toEqual([
      ['1001', 'sara@ofppt.ma'],
      ['2002', ''],
    ]);
  });

  it('garde le mode choisi pour un groupe connu', () => {
    expect(structure.groupeModes).toEqual({ GM101: 'Alterné', GM102: 'Résidentiel' });
  });

  it('dit ce que le fichier a ajouté', () => {
    expect(ajouts).toEqual({ groupes: 1, affectations: 1, formateurs: 1 });
  });

  it('sans base en place, prend le fichier tel quel', () => {
    expect(fusionnerAvecExistante(null, fichier)).toEqual({ structure: fichier, ajouts: null });
  });
});
