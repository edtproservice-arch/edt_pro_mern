import { describe, expect, it } from 'vitest';
import {
  bornerALaFinDeFormation,
  derniereSemaineDuGroupe,
  estGroupePIE,
  ouvrirAPartirDe,
  estModuleMetierFormation,
  HEURES_PAR_JOUR_CIBLE,
  PLANCHER_HEBDOMADAIRE,
  PRIORITES_GENERATION as P,
  SEUIL_PETITE_MASSE,
  cibleDeLaSemaine,
  cibleHebdomadaire,
  fenetreDuSemestre,
  ferieSurJourDisponible,
  joursDisponibles,
  joursPerdusFormateur,
  plafondHebdomadaireModule,
  plafondHebdomadaireSynchrone,
  plafondSoupleGroupe,
  plafondTolereGroupe,
  plancherHebdomadaire,
  poseMinimaleModule,
  prioriteGeneration,
  repartirSemestresAuPas,
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

  it('10 h aussi à 360 h ou moins', () => {
    expect(plancherHebdomadaire(360)).toBe(10);
    expect(plancherHebdomadaire(0)).toBe(0);
  });

  it('à 360 h ou moins, sous 10 h seulement si un férié tombe un jour où il est disponible', () => {
    const plancher = plancherHebdomadaire(360, { ferieSurJourDisponible: true });
    expect(plancher).toBe(2.5);
    // 10,29 h − 2 fériés = 0,29 h : un créneau, jamais zéro.
    expect(cibleDeLaSemaine(10.29, 2, plancher)).toBe(2.5);
    // Au-delà de 360 h, le férié ne fait pas tomber le plancher de 10 h.
    expect(plancherHebdomadaire(600, { ferieSurJourDisponible: true })).toBe(10);
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

describe('joursDisponibles et ferieSurJourDisponible', () => {
  const seances = (jour) => ['S1', 'S2', 'S3', 'S4'].map((seance) => ({ jour, seance }));

  it('un jour aux quatre séances de journée indisponibles n’est pas disponible', () => {
    const jours = joursDisponibles([...seances('Jeudi'), { jour: 'Mardi', seance: 'S1' }]);
    expect(jours.has('Jeudi')).toBe(false);
    expect(jours.has('Mardi')).toBe(true);
  });

  it('sans déclaration, tous les jours', () => {
    expect(joursDisponibles().size).toBe(6);
  });

  it('le férié compte s’il tombe un jour disponible', () => {
    // 2026-11-05 est un jeudi.
    const jours = joursDisponibles(seances('Jeudi'));
    expect(ferieSurJourDisponible([{ date: '2026-11-05' }], jours)).toBe(false);
    expect(ferieSurJourDisponible([{ date: '2026-11-06' }], jours)).toBe(true);
  });
});

describe('plafondTolereGroupe', () => {
  it('30 h + 5 h en semaine pleine, borné par la capacité', () => {
    const pleine = { disponible: true, joursDisponibles: 6 };
    expect(plafondTolereGroupe(pleine, 60)).toBe(35);
    expect(plafondTolereGroupe({ disponible: true, joursDisponibles: 1 }, 10)).toBe(10);
    expect(plafondTolereGroupe({ disponible: false }, 60)).toBe(0);
  });
});

describe('plafondHebdomadaireSynchrone — séances de 5 h', () => {
  it('une séance par semaine quand elle suffit', () => {
    expect(plafondHebdomadaireSynchrone(15, 10)).toBe(5);
  });

  it('un nombre entier de séances quand la masse l’exige', () => {
    expect(plafondHebdomadaireSynchrone(30, 4)).toBe(10);
  });
});

describe('repartirSemestresAuPas', () => {
  it('garde le total quand le découpage tombe hors pas', () => {
    expect(repartirSemestresAuPas(11.11, 8.89)).toEqual({ s1: 10, s2: 10 });
    expect(repartirSemestresAuPas(10.67, 9.33)).toEqual({ s1: 10, s2: 10 });
  });

  it('ne touche pas un découpage déjà au pas', () => {
    expect(repartirSemestresAuPas(40, 35)).toEqual({ s1: 40, s2: 35 });
  });

  it('un seul semestre : le total au pas', () => {
    expect(repartirSemestresAuPas(0, 12)).toEqual({ s1: 0, s2: 10 });
    expect(repartirSemestresAuPas(15, 0)).toEqual({ s1: 15, s2: 0 });
  });
});

describe('poseMinimaleModule — les longs modules', () => {
  it('5 h minimum à partir de 70 h', () => {
    expect(poseMinimaleModule('M201', 70)).toBe(5);
    expect(poseMinimaleModule('M102', 140)).toBe(5);
  });

  it('rien sous 70 h', () => {
    expect(poseMinimaleModule('M201', 67.5)).toBeNull();
  });

  it('jamais pour les modules qui commencent par EG', () => {
    expect(poseMinimaleModule('EGQ202', 75)).toBeNull();
    expect(poseMinimaleModule('egts102', 90)).toBeNull();
  });
});

describe('estGroupePIE', () => {
  it('reconnaît les groupes PIE à leur préfixe', () => {
    expect(estGroupePIE('PIE101 (FQ)')).toBe(true);
    expect(estGroupePIE('PIE202')).toBe(true);
  });

  it('ne prend pas les autres', () => {
    expect(estGroupePIE('PM101')).toBe(false);
    expect(estGroupePIE('GC_PIE')).toBe(false);
  });
});

describe('ouvrirAPartirDe', () => {
  it('ferme les semaines avant la première, sans les retirer', () => {
    const semaines = [1, 2, 3].map((numero) => ({ numero, disponible: true, joursDisponibles: 6 }));
    const ouvertes = ouvrirAPartirDe(semaines, 3);
    expect(ouvertes.map((s) => s.disponible)).toEqual([false, false, true]);
    expect(ouvrirAPartirDe(semaines, null)).toBe(semaines);
  });
});
