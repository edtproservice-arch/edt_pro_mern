import { describe, it, expect } from 'vitest';
import {
  cleSynchrone,
  effacerAvecJumelles,
  poserAvecJumelles,
  groupesJumeaux,
  lignesJumelles,
  massesCumulees,
  posesCumulees,
  totalSemaineFusionnee,
} from './fusion.js';
import { TYPES, totauxModule } from './planning.js';

/*
 * Le cas RÉEL signalé par le porteur : ZINEB EL OMARI enseigne EGQ202 à SMP201
 * et SMP202, fusionnés en synchrone. La vue formateur en fait DEUX lignes.
 */
const lignes = [
  {
    cle: 'SMP201||EGQ202',
    groupe: 'SMP201',
    code: 'EGQ202',
    fusionSynchrone: 'SMP201 SMP202',
    masses: { presentiel: 75, synchrone: 20 },
  },
  {
    cle: 'SMP202||EGQ202',
    groupe: 'SMP202',
    code: 'EGQ202',
    fusionSynchrone: 'SMP201 SMP202',
    masses: { presentiel: 75, synchrone: 20 },
  },
  // Un module NON fusionné, pour vérifier qu'il n'est pas emporté.
  { cle: 'PM101||EGT105', groupe: 'PM101', code: 'EGT105', masses: { presentiel: 30, synchrone: 0 } },
];

describe('cleSynchrone — une séance, un identifiant', () => {
  it('deux groupes fusionnés partagent la même clé', () => {
    expect(cleSynchrone(lignes[0])).toBe(cleSynchrone(lignes[1]));
  });

  /*
   * ⚠️ FUSION VIDE = « fusionné avec personne », pas « inconnu » : on retombe
   * sur le groupe, qui EST l'identité de cette séance.
   */
  it('sans fusion, la clé retombe sur le groupe', () => {
    expect(cleSynchrone({ groupe: 'GM101', code: 'M1' })).toBe('GM101||M1');
    expect(cleSynchrone({ groupe: 'GM102', code: 'M1' })).not.toBe(cleSynchrone({ groupe: 'GM101', code: 'M1' }));
  });

  it('le CODE fait partie de la clé — deux modules d’une même fusion sont distincts', () => {
    const a = { groupe: 'SMP201', code: 'A', fusionSynchrone: 'SMP201 SMP202' };
    const b = { groupe: 'SMP201', code: 'B', fusionSynchrone: 'SMP201 SMP202' };
    expect(cleSynchrone(a)).not.toBe(cleSynchrone(b));
  });
});

/*
 * ═══ ⚠️⚠️ GROUPESJUMEAUX — MODE GROUPE (2026-09-03) ═══
 * Signalé par le porteur : la propagation ne jouait qu'en mode formateur, où
 * une seule grille porte les deux groupes comme deux LIGNES. En mode groupe,
 * chaque groupe est une grille SÉPARÉE — il n'y a pas de `modules` partagé à
 * filtrer, seulement un NOM à désigner. C'est tout ce que cette fonction fait :
 * nommer les groupes jumeaux, à charge de l'appelant de vérifier s'ils sont
 * chargés à l'écran avant d'y écrire.
 */
describe('groupesJumeaux', () => {
  const module = {
    code: 'EGQ202',
    fusionSynchrone: 'SMP201 SMP202',
    masses: { presentiel: 75, synchrone: 20 },
  };

  it('nomme l’autre groupe de la fusion, jamais soi-même', () => {
    expect(groupesJumeaux(module, 'SMP201')).toEqual(['SMP202']);
    expect(groupesJumeaux(module, 'SMP202')).toEqual(['SMP201']);
  });

  it('rend une liste vide sans fusion déclarée', () => {
    expect(groupesJumeaux({ code: 'EGT105', masses: { synchrone: 0 } }, 'PM101')).toEqual([]);
    expect(groupesJumeaux({ code: 'EGT105' }, 'PM101')).toEqual([]);
  });

  // Un module sans masse synchrone n'a pas de jumelle, même si un libellé de
  // fusion traîne encore dessus — deux groupes peuvent partager un code de
  // module en présentiel sans rien mutualiser.
  it('rend une liste vide sans masse synchrone, même avec un libellé de fusion', () => {
    const sansSynchrone = { ...module, masses: { presentiel: 75, synchrone: 0 } };
    expect(groupesJumeaux(sansSynchrone, 'SMP201')).toEqual([]);
  });

  it('rend une liste vide sur un module absent', () => {
    expect(groupesJumeaux(null, 'SMP201')).toEqual([]);
    expect(groupesJumeaux(undefined, 'SMP201')).toEqual([]);
  });

  // Une fusion à trois groupes ou plus rend TOUS les autres.
  it('rend tous les autres groupes d’une fusion à trois', () => {
    const trois = { ...module, fusionSynchrone: 'SMP201 SMP202 SMP203' };
    expect(groupesJumeaux(trois, 'SMP202')).toEqual(['SMP201', 'SMP203']);
  });
});

describe('lignesJumelles', () => {
  it('rend l’autre groupe de la fusion, jamais soi-même', () => {
    expect(lignesJumelles(lignes, lignes[0]).map((l) => l.groupe)).toEqual(['SMP202']);
  });

  /*
   * ⚠️ UN MODULE SANS MASSE SYNCHRONE N'A PAS DE JUMELLE. Deux groupes peuvent
   * partager un code en PRÉSENTIEL sans rien mutualiser : ce sont deux cours
   * distincts, dans deux salles.
   */
  it('aucune jumelle pour un module purement présentiel', () => {
    expect(lignesJumelles(lignes, lignes[2])).toEqual([]);
  });

  it('aucune jumelle quand la fusion ne porte qu’un groupe', () => {
    const seul = [{ cle: 'GM101||M1', groupe: 'GM101', code: 'M1', masses: { presentiel: 0, synchrone: 10 } }];
    expect(lignesJumelles(seul, seul[0])).toEqual([]);
  });
});

describe('massesCumulees — le défaut signalé', () => {
  /*
   * ⚠️ C'EST LE CŒUR DU CORRECTIF : 20 h de synchrone diffusées à deux groupes
   * restent 20 h pour le formateur, pas 40.
   */
  it('ne compte le synchrone fusionné QU’UNE FOIS', () => {
    expect(massesCumulees(lignes)).toEqual({ presentiel: 180, synchrone: 20 });
  });

  it('le PRÉSENTIEL, lui, s’additionne — ce sont deux cours en salle', () => {
    expect(massesCumulees(lignes).presentiel).toBe(75 + 75 + 30);
  });

  /*
   * ⚠️ `MAX` et non « le premier trouvé » : deux lignes d'un même ensemble
   * portant des durées différentes est un état incohérent que rien n'empêche.
   */
  it('retient le MAXIMUM quand deux lignes divergent', () => {
    const bancal = [lignes[0], { ...lignes[1], masses: { presentiel: 75, synchrone: 5 } }];
    expect(massesCumulees(bancal).synchrone).toBe(20);
  });

  it('en mode GROUPE, rien ne change — une ligne, une séance', () => {
    const modeGroupe = [
      { code: 'A', masses: { presentiel: 10, synchrone: 5 } },
      { code: 'B', masses: { presentiel: 20, synchrone: 15 } },
    ];
    expect(massesCumulees(modeGroupe)).toEqual({ presentiel: 30, synchrone: 20 });
  });
});

describe('posesCumulees', () => {
  const planning = {
    'SMP201||EGQ202': { 10: { heures: 5, type: TYPES.SYNCHRONE }, 11: { heures: 2.5, type: TYPES.PRESENTIEL } },
    'SMP202||EGQ202': { 10: { heures: 5, type: TYPES.SYNCHRONE } },
  };

  it('le synchrone posé sur les deux lignes ne compte qu’une fois', () => {
    expect(posesCumulees(lignes, planning, totauxModule)).toEqual({
      presentiel: 2.5,
      synchrone: 5,
    });
  });
});

describe('totalSemaineFusionnee — la colonne « Total / semaine »', () => {
  const planning = {
    'SMP201||EGQ202': { 10: { heures: 5, type: TYPES.SYNCHRONE } },
    'SMP202||EGQ202': { 10: { heures: 5, type: TYPES.SYNCHRONE } },
    'PM101||EGT105': { 10: { heures: 2.5, type: TYPES.PRESENTIEL } },
  };

  it('additionne le présentiel et ne compte le synchrone qu’une fois', () => {
    expect(totalSemaineFusionnee(planning, 10, lignes)).toBe(7.5);
  });

  it('une semaine vide rend zéro', () => {
    expect(totalSemaineFusionnee(planning, 42, lignes)).toBe(0);
  });

  /*
   * ⚠️ LE PRÉSENTIEL DE DEUX GROUPES S'ADDITIONNE, même sur le même module :
   * le formateur donne bien deux cours cette semaine-là.
   */
  it('deux cours en salle la même semaine comptent double', () => {
    const enSalle = {
      'SMP201||EGQ202': { 10: { heures: 5, type: TYPES.PRESENTIEL } },
      'SMP202||EGQ202': { 10: { heures: 5, type: TYPES.PRESENTIEL } },
    };
    expect(totalSemaineFusionnee(enSalle, 10, lignes)).toBe(10);
  });
});

describe('poserAvecJumelles — le report sur les groupes fusionnés', () => {
  /* ⚠️ `joursDisponibles` EST INDISPENSABLE : le plafond d'une cellule s'en
     déduit (`plafondSemaine`), et une semaine sans lui plafonne à 0 h — le
     report était refusé, et j'ai d'abord cru le code fautif. */
  const semaines = [
    { numero: 10, disponible: true, joursDisponibles: 6 },
    { numero: 11, disponible: true, joursDisponibles: 6 },
  ];

  it('reporte une séance SYNCHRONE sur l’autre groupe', () => {
    const { planning, reportees } = poserAvecJumelles({
      planning: {},
      modules: lignes,
      module: lignes[0],
      semaine: semaines[0],
      heures: 5,
      type: TYPES.SYNCHRONE,
      semainesParDefaut: semaines,
    });

    expect(reportees).toBe(1);
    expect(planning['SMP201||EGQ202'][10]).toMatchObject({ heures: 5, type: TYPES.SYNCHRONE });
    expect(planning['SMP202||EGQ202'][10]).toMatchObject({ heures: 5, type: TYPES.SYNCHRONE });
  });

  /*
   * ⚠️ LE PRÉSENTIEL NE SE REPORTE JAMAIS : deux groupes en salle, ce sont deux
   * cours distincts, donnés à deux moments.
   */
  it('ne reporte PAS un cours en présentiel', () => {
    const { planning, reportees } = poserAvecJumelles({
      planning: {},
      modules: lignes,
      module: lignes[0],
      semaine: semaines[0],
      heures: 2.5,
      type: TYPES.PRESENTIEL,
      semainesParDefaut: semaines,
    });

    expect(reportees).toBe(0);
    expect(planning['SMP202||EGQ202']).toBeUndefined();
  });

  /*
   * ⚠️⚠️ UN STAGE NE FERME QU'UN GROUPE. Si SMP202 est en entreprise cette
   * semaine-là, il ne reçoit pas la séance : lui inscrire des heures
   * affirmerait un cours qui n'a pas eu lieu pour lui.
   */
  it('ne reporte PAS sur une semaine fermée pour la jumelle', () => {
    const jumelleEnStage = {
      ...lignes[1],
      semaines: [{ numero: 10, disponible: false, motif: 'stage' }, semaines[1]],
    };

    const { planning, reportees } = poserAvecJumelles({
      planning: {},
      modules: [lignes[0], jumelleEnStage],
      module: lignes[0],
      semaine: semaines[0],
      heures: 5,
      type: TYPES.SYNCHRONE,
      semainesParDefaut: semaines,
    });

    expect(reportees).toBe(0);
    expect(planning['SMP201||EGQ202'][10]).toBeDefined();
    expect(planning['SMP202||EGQ202']).toBeUndefined();
  });
});

describe('effacerAvecJumelles', () => {
  const semaine = { numero: 10, disponible: true, joursDisponibles: 6 };

  it('efface la séance mutualisée sur les deux groupes', () => {
    const depart = {
      'SMP201||EGQ202': { 10: { heures: 5, type: TYPES.SYNCHRONE } },
      'SMP202||EGQ202': { 10: { heures: 5, type: TYPES.SYNCHRONE } },
    };

    const { planning, reportees } = effacerAvecJumelles({
      planning: depart,
      modules: lignes,
      module: lignes[0],
      semaine,
    });

    expect(reportees).toBe(1);
    expect(planning['SMP201||EGQ202'][10]?.heures ?? 0).toBe(0);
    expect(planning['SMP202||EGQ202'][10]?.heures ?? 0).toBe(0);
  });

  /*
   * ⚠️ ON NE TOUCHE QUE LES CELLULES RÉELLEMENT SYNCHRONES chez la jumelle :
   * y effacer un cours en salle qui n'a rien à voir serait une perte de saisie.
   */
  it('laisse intact un PRÉSENTIEL posé le même jour chez la jumelle', () => {
    const depart = {
      'SMP201||EGQ202': { 10: { heures: 5, type: TYPES.SYNCHRONE } },
      'SMP202||EGQ202': { 10: { heures: 2.5, type: TYPES.PRESENTIEL } },
    };

    const { planning, reportees } = effacerAvecJumelles({
      planning: depart,
      modules: lignes,
      module: lignes[0],
      semaine,
    });

    expect(reportees).toBe(0);
    expect(planning['SMP202||EGQ202'][10]).toMatchObject({ heures: 2.5 });
  });

  it('effacer un PRÉSENTIEL ne touche personne d’autre', () => {
    const depart = {
      'SMP201||EGQ202': { 10: { heures: 2.5, type: TYPES.PRESENTIEL } },
      'SMP202||EGQ202': { 10: { heures: 5, type: TYPES.SYNCHRONE } },
    };

    const { planning } = effacerAvecJumelles({
      planning: depart,
      modules: lignes,
      module: lignes[0],
      semaine,
    });

    expect(planning['SMP202||EGQ202'][10]).toMatchObject({ heures: 5 });
  });
});
