import { describe, expect, it } from 'vitest';
import {
  NOTE_DISCIPLINE_MAX,
  examenDiscipline,
  noteDiscipline,
  sanctionAssiduite,
  sanctionComportement,
} from './bareme.js';

/*
 * Chaque ligne de la grille réglementaire, telle qu'imprimée. La colonne
 * « journées » vaut 2 séances (légende : 1 journée = 5 h, 1 séance = 2,5 h).
 */
const GRILLE_ASSIDUITE = [
  { retards: 4, journees: 1, points: 1, sanction: '1ère mise en garde', autorite: 'SG' },
  { retards: 8, journees: 2, points: 2, sanction: '2ème mise en garde', autorite: 'SG' },
  { retards: 12, journees: 3, points: 3, sanction: '1er avertissement', autorite: 'D' },
  { retards: 16, journees: 4, points: 4, sanction: '2ème avertissement', autorite: 'D' },
  { retards: 20, journees: 5, points: 5, sanction: 'Blâme', autorite: 'CD' },
  { retards: 24, journees: 6, points: 6, sanction: 'Exclusion de 2 jours', autorite: 'CD' },
  ...[7, 8, 9, 10].map((n) => ({
    retards: n * 4,
    journees: n,
    points: n,
    sanction: 'Exclusion temporaire ou définitive à l’appréciation du Conseil de discipline',
    autorite: 'CD',
  })),
];

describe('noteDiscipline — assiduité, ligne par ligne de la grille', () => {
  for (const ligne of GRILLE_ASSIDUITE) {
    it(`${ligne.retards} retards → −${ligne.points} · ${ligne.sanction} (${ligne.autorite})`, () => {
      const { assiduite } = noteDiscipline({ retards: ligne.retards });
      expect(assiduite.pointsRetires).toBe(ligne.points);
      expect(assiduite.note).toBe(10 - ligne.points);
      expect(assiduite.sanction.libelle).toBe(ligne.sanction);
      expect(assiduite.sanction.autorite).toBe(ligne.autorite);
    });

    it(`${ligne.journees} journée(s) = ${ligne.journees * 2} séances → même ligne`, () => {
      const { assiduite } = noteDiscipline({ seancesAbsentes: ligne.journees * 2 });
      expect(assiduite.pointsRetires).toBe(ligne.points);
      expect(assiduite.sanction.libelle).toBe(ligne.sanction);
    });
  }

  it('« au-delà de 40 retards » → exclusion définitive, note à 0', () => {
    const { assiduite } = noteDiscipline({ retards: 41 });
    expect(assiduite.sanction.libelle).toBe('Exclusion définitive');
    expect(assiduite.note).toBe(0);
  });

  it('« au-delà de 10 journées » → exclusion définitive, et les points ne sont pas plafonnés', () => {
    const { assiduite } = noteDiscipline({ seancesAbsentes: 24 });
    expect(assiduite.sanction.libelle).toBe('Exclusion définitive');
    expect(assiduite.pointsRetires).toBe(12);
    expect(assiduite.note).toBe(0);
  });

  it('10 points pile relèvent encore de l’appréciation du Conseil', () => {
    expect(sanctionAssiduite(10).libelle).toMatch(/appréciation/);
  });
});

describe('noteDiscipline — retards et absences s’additionnent (décision du porteur)', () => {
  it('2 retards + 1 séance = −1 point = 1ère mise en garde', () => {
    const { assiduite } = noteDiscipline({ retards: 2, seancesAbsentes: 1 });
    expect(assiduite.pointsRetires).toBe(1);
    expect(assiduite.sanction.libelle).toBe('1ère mise en garde');
  });

  it('en dessous d’un point, aucune sanction mais la note baisse', () => {
    const { assiduite } = noteDiscipline({ seancesAbsentes: 1 });
    expect(assiduite.pointsRetires).toBe(0.5);
    expect(assiduite.note).toBe(9.5);
    expect(assiduite.sanction).toBeNull();
  });

  it('3 retards : 0,75 point exact, sans erreur de flottant', () => {
    expect(noteDiscipline({ retards: 3 }).assiduite.note).toBe(9.25);
  });

  it('le palier se lit à l’arrondi inférieur : 1,75 point reste une 1ère mise en garde', () => {
    const { assiduite } = noteDiscipline({ retards: 3, seancesAbsentes: 2 });
    expect(assiduite.pointsRetires).toBe(1.75);
    expect(assiduite.sanction.libelle).toBe('1ère mise en garde');
  });
});

describe('noteDiscipline — comportement', () => {
  const GRILLE_COMPORTEMENT = [
    [1, 'Mise en garde', 'SG'],
    [2, 'Avertissement', 'D'],
    [3, 'Blâme', 'CD'],
    [4, 'Exclusion de 2 jours', 'CD'],
    [5, 'Exclusion définitive', 'CD'],
  ];

  for (const [rang, libelle, autorite] of GRILLE_COMPORTEMENT) {
    it(`${rang}ème indiscipline → −${rang} · ${libelle} (${autorite})`, () => {
      const { comportement } = noteDiscipline({ indisciplines: rang });
      expect(comportement.pointsRetires).toBe(rang);
      expect(comportement.note).toBe(5 - rang);
      expect(comportement.sanction.libelle).toBe(libelle);
      expect(comportement.sanction.autorite).toBe(autorite);
    });
  }

  it('au-delà de la 5ème, la note reste à 0 et l’exclusion définitive', () => {
    const { comportement } = noteDiscipline({ indisciplines: 7 });
    expect(comportement.note).toBe(0);
    expect(sanctionComportement(7).libelle).toBe('Exclusion définitive');
  });

  it('aucune indiscipline : 5/5, pas de sanction', () => {
    expect(sanctionComportement(0)).toBeNull();
    expect(noteDiscipline().comportement.note).toBe(5);
  });
});

describe('noteDiscipline — note sur 15 et sur 20', () => {
  it('un stagiaire sans rien : 15/15, 20/20', () => {
    const note = noteDiscipline();
    expect(note.note15).toBe(NOTE_DISCIPLINE_MAX);
    expect(note.note20).toBe(20);
  });

  it('examens de passage : ND × 20/15, au centième', () => {
    // Assiduité 9,5 + comportement 4 = 13,5 → 18.
    const note = noteDiscipline({ seancesAbsentes: 1, indisciplines: 1 });
    expect(note.note15).toBe(13.5);
    expect(note.note20).toBe(18);
    // 9,25 + 5 = 14,25 → 19.
    expect(noteDiscipline({ retards: 3 }).note20).toBe(19);
    // 9,75 + 5 = 14,75 → 19,666… → 19,67.
    expect(noteDiscipline({ retards: 1 }).note20).toBe(19.67);
  });
});

describe('noteDiscipline — examen selon l’année de formation', () => {
  it('1ʳᵉ année : examen de passage, note sur 20', () => {
    const note = noteDiscipline({ seancesAbsentes: 1, indisciplines: 1, anneeFormation: 1 });
    expect(note.examen).toEqual({ type: 'passage', sur: 20 });
    expect(note.note20).toBe(18);
    expect(note.noteExamen).toBe(18);
  });

  it('2ᵉ et 3ᵉ année : fin de formation, la note reste sur 15 sans conversion', () => {
    for (const anneeFormation of [2, 3]) {
      const note = noteDiscipline({ seancesAbsentes: 1, indisciplines: 1, anneeFormation });
      expect(note.examen).toEqual({ type: 'fin', sur: 15 });
      expect(note.note15).toBe(13.5);
      expect(note.note20).toBeNull();
      expect(note.noteExamen).toBe(13.5);
    }
  });

  it('sans année : note sur 20 calculée, examen inconnu', () => {
    const note = noteDiscipline({ retards: 3 });
    expect(note.examen).toBeNull();
    expect(note.noteExamen).toBeNull();
    expect(note.note20).toBe(19);
  });

  it('refuse une année de formation invalide', () => {
    expect(() => examenDiscipline(0.5)).toThrow(TypeError);
  });
});

describe('noteDiscipline — entrées', () => {
  it('refuse un compte négatif ou décimal', () => {
    expect(() => noteDiscipline({ retards: -1 })).toThrow(TypeError);
    expect(() => noteDiscipline({ seancesAbsentes: 1.5 })).toThrow(TypeError);
    expect(() => noteDiscipline({ indisciplines: '2' })).toThrow(TypeError);
    expect(() => sanctionAssiduite(-1)).toThrow(TypeError);
  });
});
