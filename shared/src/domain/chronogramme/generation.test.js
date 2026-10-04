import { describe, expect, it } from 'vitest';
import {
  bornerALaFinDeFormation,
  derniereSemaineDuGroupe,
  estModuleMetierFormation,
  HEURES_PAR_JOUR_CIBLE,
  PLANCHER_HEBDOMADAIRE,
  PRIORITES_GENERATION as P,
  SEUIL_PETITE_MASSE,
  cibleDeLaSemaine,
  cibleHebdomadaire,
  fenetreDuSemestre,
  joursPerdusFormateur,
  plafondHebdomadaireModule,
  plafondSoupleGroupe,
  plancherHebdomadaire,
  prioriteGeneration,
  retirerReserve,
  semainesDuSemestre,
} from './generation.js';

describe('prioriteGeneration — règle A', () => {
  it('suit l’ordre donné par le porteur', () => {
    const ordre = [
      { estRegional: true, semestre: 'S1' },
      { estRegional: true, semestre: 'annuel' },
      { estRegional: true, semestre: 'S2' },
      { estRegional: false, semestre: 'S1' },
      { estRegional: false, semestre: 'annuel' },
      { estRegional: false, semestre: 'S2' },
    ].map(prioriteGeneration);
    expect(ordre).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('place tout régional avant tout module normal', () => {
    expect(prioriteGeneration({ estRegional: true, semestre: 'S2' })).toBeLessThan(
      prioriteGeneration({ estRegional: false, semestre: 'S1' })
    );
  });

  it('traite un module sans semestre connu comme annuel, non régional', () => {
    expect(prioriteGeneration()).toBe(P.NORMAL_ANNUEL);
  });
});

describe('cibleHebdomadaire — règles B et C', () => {
  it('vaut masse / 35 au-dessus du plancher', () => {
    expect(cibleHebdomadaire(1050)).toBe(30);
  });

  it('ne descend jamais sous 25 h au-delà de 360 h', () => {
    expect(cibleHebdomadaire(600)).toBe(PLANCHER_HEBDOMADAIRE);
    expect(cibleHebdomadaire(361)).toBe(PLANCHER_HEBDOMADAIRE);
  });

  it('reste à masse / 35, sans plancher, à 360 h ou moins', () => {
    expect(SEUIL_PETITE_MASSE).toBe(360);
    expect(cibleHebdomadaire(360)).toBeCloseTo(10.29, 2);
    expect(cibleHebdomadaire(175)).toBe(5);
  });

  it('rend 0 sans masse', () => {
    expect(cibleHebdomadaire(0)).toBe(0);
    expect(cibleHebdomadaire(undefined)).toBe(0);
  });
});

describe('joursPerdusFormateur et cibleDeLaSemaine — règle D', () => {
  it('retire 5 h par jour férié', () => {
    expect(HEURES_PAR_JOUR_CIBLE).toBe(5);
    expect(cibleDeLaSemaine(26, joursPerdusFormateur({ feries: 2 }))).toBe(16);
  });

  it('retire aussi stage partiel, formation et rentrée', () => {
    expect(joursPerdusFormateur({ formation: 3 })).toBe(3);
    expect(joursPerdusFormateur({ groupes: [0, 2, 4] })).toBe(4);
  });

  it('additionne les fériés au plus grand des autres motifs, sans les cumuler entre eux', () => {
    // Formation et stage peuvent tomber les mêmes jours : on ne retire pas deux fois.
    expect(joursPerdusFormateur({ feries: 1, formation: 2, groupes: [3] })).toBe(4);
  });

  it('ne perd jamais plus que la semaine', () => {
    expect(joursPerdusFormateur({ feries: 4, formation: 5 })).toBe(6);
    expect(cibleDeLaSemaine(25, 6)).toBe(0);
  });
});

describe('semainesDuSemestre', () => {
  it('coupe à la fin du premier semestre', () => {
    const s1 = semainesDuSemestre('S1');
    const s2 = semainesDuSemestre('S2');
    expect(s1.at(0)).toBe(1);
    expect(s1.at(-1)).toBe(17);
    expect(s2.at(0)).toBe(18);
    expect(s2.at(-1)).toBe(45);
  });
});

describe('plafondSoupleGroupe', () => {
  it('vaut 5 h par jour ouvert', () => {
    expect(plafondSoupleGroupe({ disponible: true, joursDisponibles: 6 })).toBe(30);
    expect(plafondSoupleGroupe({ disponible: true, joursDisponibles: 4 })).toBe(20);
  });

  it('vaut 0 pour une semaine fermée', () => {
    expect(plafondSoupleGroupe({ disponible: false, joursDisponibles: 6 })).toBe(0);
    expect(plafondSoupleGroupe(undefined)).toBe(0);
  });
});

describe('fenetreDuSemestre', () => {
  it('le S1 peut déborder sur le S2, avec la S17 pour échéance', () => {
    const { semaines, echeance } = fenetreDuSemestre('S1');
    expect(semaines.at(0)).toBe(1);
    expect(semaines.at(-1)).toBe(45);
    expect(echeance).toBe(17);
  });

  it('le S2 ne remonte jamais au S1', () => {
    const { semaines, echeance } = fenetreDuSemestre('S2');
    expect(semaines.at(0)).toBe(18);
    expect(echeance).toBeNull();
  });
});

describe('derniereSemaineDuGroupe', () => {
  it('S42 en 1ʳᵉ année, S41 en 2ᵉ, S18 en 3ᵉ année cours du jour', () => {
    expect(derniereSemaineDuGroupe('DEV101')).toBe(42);
    expect(derniereSemaineDuGroupe('GM201 (FQ)')).toBe(41);
    expect(derniereSemaineDuGroupe('DEV301')).toBe(18);
  });

  it('pas de borne pour une 3ᵉ année en cours du soir', () => {
    expect(derniereSemaineDuGroupe('DEV301 (CDS)')).toBeNull();
  });
});

describe('bornerALaFinDeFormation', () => {
  const semaines = [1, 2, 3].map((numero) => ({ numero, disponible: true, joursDisponibles: 6, motif: null }));

  it('ferme les semaines après la dernière, sans les retirer', () => {
    const bornees = bornerALaFinDeFormation(semaines, 2);
    expect(bornees).toHaveLength(3);
    expect(bornees[1].disponible).toBe(true);
    expect(bornees[2]).toMatchObject({ disponible: false, joursDisponibles: 0, motif: 'fin_formation' });
  });

  it('ne change rien sans borne', () => {
    expect(bornerALaFinDeFormation(semaines, null)).toBe(semaines);
  });
});

describe('plancher absolu au-delà de 900 h', () => {
  it('25 h minimum chaque semaine, fériés compris, au-delà de 900 h', () => {
    expect(plancherHebdomadaire(1053)).toBe(25);
    // 30,09 h − 2 fériés = 20 h : remonté à 25 h.
    expect(cibleDeLaSemaine(30.09, 2, plancherHebdomadaire(1053))).toBe(25);
  });

  it('10 h minimum entre 360 h (exclu) et 900 h', () => {
    expect(plancherHebdomadaire(900)).toBe(10);
    expect(plancherHebdomadaire(361)).toBe(10);
    // 25 h − 4 jours perdus = 5 h : remonté à 10 h.
    expect(cibleDeLaSemaine(25, 4, plancherHebdomadaire(600))).toBe(10);
    // Au-dessus du plancher, la règle D s'applique telle quelle.
    expect(cibleDeLaSemaine(25, 2, plancherHebdomadaire(600))).toBe(15);
  });

  it('aucun plancher à 360 h ou moins', () => {
    expect(plancherHebdomadaire(360)).toBe(0);
    expect(cibleDeLaSemaine(10, 2, plancherHebdomadaire(360))).toBe(0);
  });

  it('ne vise pas plus que les jours restants ne contiennent', () => {
    expect(cibleDeLaSemaine(30, 5, 25)).toBe(10);
    expect(cibleDeLaSemaine(30, 6, 25)).toBe(0);
  });
});

describe('plafondHebdomadaireModule — ne pas condenser un module', () => {
  it('une journée (10 h) au plus pour un module ordinaire', () => {
    expect(plafondHebdomadaireModule(140, 15)).toBe(10);
    expect(plafondHebdomadaireModule(35, 14)).toBe(10);
  });

  it('juste le rythme nécessaire quand la masse l’exige', () => {
    // 200 h en 15 semaines : 13,3 h → 15 h par semaine.
    expect(plafondHebdomadaireModule(200, 15)).toBe(15);
  });

  it('une journée sans semaine ouverte connue', () => {
    expect(plafondHebdomadaireModule(60, 0)).toBe(10);
  });
});

describe('retirerReserve — la marge des modules régionaux', () => {
  it('se prend sur le S2 d’un module annuel', () => {
    expect(retirerReserve({ s1: 40, s2: 40 }, 2.5)).toEqual({ s1: 40, s2: 37.5, retenu: 2.5 });
  });

  it('se prend sur le S1 d’un module du S1', () => {
    expect(retirerReserve({ s1: 60, s2: 0 }, 2.5)).toEqual({ s1: 57.5, s2: 0, retenu: 2.5 });
  });

  it('ne retire rien sans réserve', () => {
    expect(retirerReserve({ s1: 60, s2: 0 }, 0)).toEqual({ s1: 60, s2: 0, retenu: 0 });
  });
});

describe('estModuleMetierFormation', () => {
  it('reconnaît les intitulés de la répartition DRIF', () => {
    expect(estModuleMetierFormation('Métier et formation')).toBe(true);
    expect(estModuleMetierFormation('Métier et Formation dans le secteur automobile')).toBe(true);
    expect(estModuleMetierFormation('Se situer au regard du métier et de la démarche de formation.')).toBe(true);
  });

  it('ne prend pas les autres modules', () => {
    expect(estModuleMetierFormation('Algorithmique')).toBe(false);
    expect(estModuleMetierFormation('Formation en entreprise')).toBe(false);
    expect(estModuleMetierFormation('')).toBe(false);
  });
});
