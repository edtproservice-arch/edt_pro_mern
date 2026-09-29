import { describe, expect, it } from 'vitest';

import {
  NIVEAUX_PLACEMENT,
  RAISONS_NON_PLACEE,
  placerManquantes,
  seancesManquantes,
} from './placementManquantes.js';

/** Deux jours de quatre créneaux : Lundi 0-3, Mardi 4-7. */
const CRENEAUX = ['Lundi', 'Mardi'].flatMap((jour, j) =>
  [0, 1, 2, 3].map((rang) => ({ id: j * 4 + rang, jour, rang }))
);

const tache = (extra = {}) => ({
  id: 't1',
  formateur: 'F1',
  groupes: ['GM101'],
  priorite: 3,
  difficulte: 1,
  creneauxInterdits: [],
  creneauxAEviter: [],
  sallesPossibles: ['A1'],
  sallesPreferees: [],
  ...extra,
});

const probleme = (taches, occupation = [], extra = {}) => ({
  creneaux: CRENEAUX,
  taches,
  occupation,
  incompatibilites: {},
  ...extra,
});

/** Occupe tous les créneaux sauf ceux listés. */
const toutSauf = (libres, occ) =>
  CRENEAUX.filter((c) => !libres.includes(c.id)).map((c) => ({ creneauId: c.id, ...occ }));

describe('seancesManquantes', () => {
  it('compte les séances manquantes par tâche, arrondi au-dessus', () => {
    const { aPlacer, sansAffectation } = seancesManquantes({
      taches: [{ id: 't1', groupes: ['GM101'], module: 'M101', type: 'presentiel' }],
      ecarts: [
        { groupe: 'GM101', module: 'M101', type: 'presentiel', prevu: 5, pose: 0, nature: 'manquante' },
      ],
    });
    expect(aPlacer.get('t1')).toBe(2);
    expect(sansAffectation).toEqual([]);
  });

  it('une fusion reçoit le PLUS GRAND manque de ses membres, jamais la somme', () => {
    const { aPlacer } = seancesManquantes({
      taches: [{ id: 't1', groupes: ['GM101', 'GM102'], module: 'M101', type: 'synchrone' }],
      ecarts: [
        { groupe: 'GM101', module: 'M101', type: 'synchrone', prevu: 2.5, pose: 0, nature: 'manquante' },
        { groupe: 'GM102', module: 'M101', type: 'synchrone', prevu: 5, pose: 0, nature: 'manquante' },
      ],
    });
    expect(aPlacer.get('t1')).toBe(2);
  });

  it('ignore les séances en trop et hors chronogramme', () => {
    const { aPlacer } = seancesManquantes({
      taches: [{ id: 't1', groupes: ['GM101'], module: 'M101', type: 'presentiel' }],
      ecarts: [
        { groupe: 'GM101', module: 'M101', type: 'presentiel', prevu: 2.5, pose: 5, nature: 'en_trop' },
      ],
    });
    expect(aPlacer.size).toBe(0);
  });

  it('le type fait partie de la clé : un manque à distance ne se comble pas en salle', () => {
    const { aPlacer, sansAffectation } = seancesManquantes({
      taches: [{ id: 't1', groupes: ['GM101'], module: 'M101', type: 'presentiel' }],
      ecarts: [
        { groupe: 'GM101', module: 'M101', type: 'synchrone', prevu: 2.5, pose: 0, nature: 'manquante' },
      ],
    });
    expect(aPlacer.size).toBe(0);
    expect(sansAffectation).toHaveLength(1);
  });

  it('rend le manque sans affectation, avec sa raison', () => {
    const { sansAffectation } = seancesManquantes({
      taches: [],
      ecarts: [
        { groupe: 'GM101', module: 'M109', type: 'presentiel', prevu: 2.5, pose: 0, nature: 'manquante' },
      ],
    });
    expect(sansAffectation).toEqual([
      {
        groupe: 'GM101',
        module: 'M109',
        type: 'presentiel',
        heures: 2.5,
        raison: RAISONS_NON_PLACEE.SANS_AFFECTATION,
      },
    ]);
  });

  it('refuse une entrée qui n’est pas une liste', () => {
    expect(() => seancesManquantes({ taches: null })).toThrow(TypeError);
  });
});

describe('placerManquantes', () => {
  it('niveau 1 : un créneau libre avec une salle libre', () => {
    const { placements, nonPlacees } = placerManquantes(probleme([tache()]), new Map([['t1', 1]]));
    expect(nonPlacees).toEqual([]);
    expect(placements).toEqual([
      { tacheId: 't1', creneauId: 0, salle: 'A1', niveau: NIVEAUX_PLACEMENT.LIBRE, deconseille: false },
    ]);
  });

  it('étale les séances sur la semaine à classe égale', () => {
    const { placements } = placerManquantes(probleme([tache()]), new Map([['t1', 2]]));
    expect(placements.map((p) => p.creneauId)).toEqual([0, 4]);
  });

  it('préfère la salle du module quand elle est libre', () => {
    const { placements } = placerManquantes(
      probleme([tache({ sallesPossibles: ['A1', 'ATELIER'], sallesPreferees: ['ATELIER'] })]),
      new Map([['t1', 1]])
    );
    expect(placements[0].salle).toBe('ATELIER');
  });

  it('n’emploie un créneau « à éviter » qu’en dernier recours', () => {
    const aEviter = [0, 1, 2, 3, 4, 5, 6];
    const libre = placerManquantes(
      probleme([tache({ creneauxAEviter: aEviter })]),
      new Map([['t1', 1]])
    );
    expect(libre.placements[0]).toMatchObject({ creneauId: 7, niveau: NIVEAUX_PLACEMENT.LIBRE });

    const force = placerManquantes(
      probleme([tache({ creneauxAEviter: aEviter })], toutSauf([0], { formateur: 'AUTRE', groupes: ['GM101'] })),
      new Map([['t1', 1]])
    );
    // Le seul créneau restant (0) est « à éviter » : il est pris quand même.
    expect(force.placements[0]).toMatchObject({
      creneauId: 0,
      niveau: NIVEAUX_PLACEMENT.A_EVITER,
      deconseille: true,
    });
  });

  it('préfère un créneau « à éviter » avec salle à un créneau libre sans salle', () => {
    // Créneau 0 : à éviter, salle libre. Tous les autres : salle A1 prise.
    const occupation = toutSauf([0], { formateur: 'AUTRE', groupes: ['XX'], salle: 'A1' });
    const { placements } = placerManquantes(
      probleme([tache({ creneauxAEviter: [0] })], occupation),
      new Map([['t1', 1]])
    );
    expect(placements[0]).toMatchObject({ creneauId: 0, niveau: NIVEAUX_PLACEMENT.A_EVITER });
  });

  it('niveau 2 : sans salle quand toutes les salles sont prises', () => {
    const occupation = CRENEAUX.map((c) => ({ creneauId: c.id, formateur: 'AUTRE', groupes: ['XX'], salle: 'A1' }));
    const { placements } = placerManquantes(probleme([tache()], occupation), new Map([['t1', 1]]));
    expect(placements[0]).toMatchObject({ salle: '', niveau: NIVEAUX_PLACEMENT.SANS_SALLE });
  });

  it('une séance à distance n’est jamais « sans salle » : TEAMS n’est pas un local', () => {
    const occupation = CRENEAUX.map((c) => ({ creneauId: c.id, formateur: 'AUTRE', groupes: ['XX'], salle: 'TEAMS' }));
    const { placements } = placerManquantes(
      probleme([tache({ sallesPossibles: ['TEAMS'] })], occupation),
      new Map([['t1', 1]])
    );
    expect(placements[0]).toMatchObject({ salle: 'TEAMS', niveau: NIVEAUX_PLACEMENT.LIBRE });
  });

  it('le formateur doit être libre, même sans salle', () => {
    const occupation = CRENEAUX.map((c) => ({ creneauId: c.id, formateur: 'F1', groupes: ['AUTRE'] }));
    const { placements, nonPlacees } = placerManquantes(probleme([tache()], occupation), new Map([['t1', 1]]));
    expect(placements).toEqual([]);
    expect(nonPlacees).toEqual([{ tacheId: 't1', nombre: 1, raison: RAISONS_NON_PLACEE.FORMATEUR_OCCUPE }]);
  });

  it('le groupe pris : raison groupe_occupe', () => {
    const occupation = CRENEAUX.map((c) => ({ creneauId: c.id, formateur: 'AUTRE', groupes: ['gm101'] }));
    const { nonPlacees } = placerManquantes(probleme([tache()], occupation), new Map([['t1', 2]]));
    expect(nonPlacees).toEqual([{ tacheId: 't1', nombre: 2, raison: RAISONS_NON_PLACEE.GROUPE_OCCUPE }]);
  });

  it('formateur et groupe libres, mais jamais au même moment', () => {
    const occupation = [
      ...CRENEAUX.filter((c) => c.id < 4).map((c) => ({ creneauId: c.id, formateur: 'F1' })),
      ...CRENEAUX.filter((c) => c.id >= 4).map((c) => ({ creneauId: c.id, groupes: ['GM101'] })),
    ];
    const { nonPlacees } = placerManquantes(probleme([tache()], occupation), new Map([['t1', 1]]));
    expect(nonPlacees[0].raison).toBe(RAISONS_NON_PLACEE.AUCUN_CRENEAU_COMMUN);
  });

  it('les créneaux interdits le restent à tous les niveaux', () => {
    const { nonPlacees } = placerManquantes(
      probleme([tache({ creneauxInterdits: CRENEAUX.map((c) => c.id) })]),
      new Map([['t1', 1]])
    );
    expect(nonPlacees[0].raison).toBe(RAISONS_NON_PLACEE.CRENEAUX_FERMES);
  });

  it('respecte les incompatibilités dans les deux sens (groupes FQ, fusions)', () => {
    const occupation = CRENEAUX.filter((c) => c.id !== 5).map((c) => ({
      creneauId: c.id,
      formateur: 'AUTRE',
      groupes: ['ACADA101 (FQ)'],
    }));
    const { placements } = placerManquantes(
      probleme([tache()], occupation, { incompatibilites: { 'ACADA101 (FQ)': ['GM101'] } }),
      new Map([['t1', 1]])
    );
    expect(placements[0].creneauId).toBe(5);
  });

  it('les placements s’occupent les uns les autres', () => {
    const { placements } = placerManquantes(
      probleme([tache(), tache({ id: 't2', formateur: 'F2', groupes: ['GM101'] })]),
      new Map([
        ['t1', 1],
        ['t2', 1],
      ])
    );
    expect(new Set(placements.map((p) => p.creneauId)).size).toBe(2);
  });

  it('traite la priorité la plus forte d’abord', () => {
    // Un seul créneau libre : il revient à la tâche prioritaire.
    const occupation = toutSauf([3], { formateur: 'AUTRE', groupes: ['GM101'] });
    const { placements, nonPlacees } = placerManquantes(
      probleme([tache({ priorite: 6 }), tache({ id: 't2', formateur: 'F2', priorite: 1 })], occupation),
      new Map([
        ['t1', 1],
        ['t2', 1],
      ])
    );
    expect(placements.map((p) => p.tacheId)).toEqual(['t2']);
    expect(nonPlacees.map((n) => n.tacheId)).toEqual(['t1']);
  });

  it('ignore une tâche sans séance à placer', () => {
    const { placements } = placerManquantes(probleme([tache()]), new Map());
    expect(placements).toEqual([]);
  });

  it('est déterministe : deux appels, le même résultat', () => {
    const p = probleme([tache(), tache({ id: 't2', formateur: 'F2', groupes: ['GM102'] })]);
    const n = new Map([
      ['t1', 2],
      ['t2', 2],
    ]);
    expect(placerManquantes(p, n)).toEqual(placerManquantes(p, n));
  });

  it('refuse un problème malformé', () => {
    expect(() => placerManquantes({}, new Map())).toThrow(TypeError);
    expect(() => placerManquantes(probleme([]), {})).toThrow(TypeError);
  });
});
