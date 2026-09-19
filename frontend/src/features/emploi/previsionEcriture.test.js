import { describe, it, expect } from 'vitest';
import { fichesModules } from 'shared/domain';
import { ajusterPosees, appliquerOperations, confirmer } from './previsionEcriture.js';

const ID_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ID_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const seance = (surcharges = {}) => ({
  id: ID_A,
  jour: 'Lundi',
  seance: 'S1',
  periode: 'jour',
  formateurMatricule: '15688',
  groupe: 'GM101',
  module: 'M101',
  salle: 'A12',
  statut: 'planifie',
  ...surcharges,
});

const creneau = (jour, s, formateurMatricule = '15688') => ({
  jour,
  seance: s,
  periode: 'jour',
  formateurMatricule,
});

const pose = (surcharges = {}) => ({
  jour: 'Mardi',
  seance: 'S3',
  periode: 'jour',
  formateurMatricule: '15688',
  groupe: 'GM101',
  module: 'M101',
  salle: 'A12',
  statut: 'planifie',
  ...surcharges,
});

const affectations = [
  { formateur: '15688', groupe: 'GM101', module: 'M101', type: 'presentiel', s1Heures: 30 },
  { formateur: '15688', groupe: 'GM102', module: 'M102', type: 'presentiel', s1Heures: 30 },
];

/** Les règles que la page fournit — un module à 20 h sur 30 h prévues. */
const regles = (surcharges = {}) => ({
  groupesFq: [],
  fiches: fichesModules(affectations),
  posees: new Map([['GM101||M101', { presentiel: 20, synchrone: 0 }]]),
  affectations,
  gelDuJour: () => [],
  ...surcharges,
});

describe('appliquerOperations — sans règles (la confirmation, où le serveur a jugé)', () => {
  it('⚠️ ne modifie pas la semaine reçue', () => {
    const semaine = [seance()];
    const copie = JSON.parse(JSON.stringify(semaine));

    appliquerOperations(semaine, [{ type: 'vider', creneau: creneau('Lundi', 'S1') }]);

    expect(semaine).toEqual(copie);
  });

  it('vide une case', () => {
    const resultat = appliquerOperations([seance()], [{ type: 'vider', creneau: creneau('Lundi', 'S1') }]);

    expect(resultat).toEqual([]);
  });

  it('⚠️ un DÉPLACEMENT avec id change la séance de créneau, sans doublon', () => {
    const resultat = appliquerOperations(
      [seance()],
      [{ type: 'deplacer', seance: pose({ id: ID_A }), source: creneau('Lundi', 'S1') }]
    );

    expect(resultat).toHaveLength(1);
    expect(resultat[0]).toMatchObject({ id: ID_A, jour: 'Mardi', seance: 'S3', module: 'M101' });
  });

  it('⚠️ sans id, une case déjà prise n’est PAS écrasée — le serveur la refuserait', () => {
    const resultat = appliquerOperations(
      [seance()],
      [{ type: 'poser', seance: pose({ jour: 'Lundi', seance: 'S1', groupe: 'GM102', module: 'M102' }) }]
    );

    expect(resultat).toHaveLength(1);
    expect(resultat[0].groupe).toBe('GM101');
  });

  it('⚠️ un identifiant PROVISOIRE vaut « pas d’identifiant » — comme pour le serveur', () => {
    // `ecrireLot` retire ces identifiants avant l'envoi : le serveur les voit
    // donc comme une création, et la simulation doit faire de même.
    const resultat = appliquerOperations(
      [seance({ id: 'provisoire-Lundi-S1-jour-15688' })],
      [{ type: 'poser', seance: pose({ id: 'provisoire-Lundi-S1-jour-15688', jour: 'Lundi', seance: 'S1' }) }]
    );

    expect(resultat).toHaveLength(1);
  });

  it('une COPIE ajoute une séance et garde l’origine, avec un identifiant provisoire', () => {
    const resultat = appliquerOperations([seance()], [{ type: 'poser', seance: pose() }]);

    expect(resultat).toHaveLength(2);
    expect(resultat[1].id).toMatch(/^provisoire-/);
    expect(resultat[0].id).toBe(ID_A);
  });

  it('rejoue les opérations DANS L’ORDRE : couper puis coller', () => {
    const resultat = appliquerOperations(
      [seance()],
      [
        { type: 'vider', creneau: creneau('Lundi', 'S1') },
        { type: 'poser', seance: pose({ jour: 'Lundi', seance: 'S1', groupe: 'GM102', module: 'M102' }) },
      ]
    );

    expect(resultat).toHaveLength(1);
    expect(resultat[0].groupe).toBe('GM102');
  });
});

describe('appliquerOperations — JUGÉ : jamais un faux à l’écran', () => {
  /*
   * ⚠️ C'EST LE RETOUR DU PORTEUR : « il donne parfois des chevauchements qui ne
   * sont pas justes, puis il rattrape et masque ». Ce que le serveur refuserait
   * ne doit pas apparaître, ne serait-ce qu'un instant.
   */
  it('⚠️ ne montre PAS une pose qui chevauche le groupe d’une autre séance du créneau', () => {
    const semaine = [seance({ id: ID_A, formateurMatricule: '18494', jour: 'Mardi', seance: 'S3' })];

    // 15688 pose GM101 le mardi S3 : GM101 y est DÉJÀ avec 18494.
    const resultat = appliquerOperations(semaine, [{ type: 'poser', seance: pose() }], regles());

    expect(resultat).toEqual(semaine);
  });

  it('⚠️ ne montre PAS une pose qui chevauche le formateur', () => {
    const semaine = [seance({ id: ID_A, groupe: 'GM102', module: 'M102', jour: 'Mardi', seance: 'S3' })];

    const resultat = appliquerOperations(semaine, [{ type: 'poser', seance: pose() }], regles());

    expect(resultat).toEqual(semaine);
  });

  it('⚠️ ne montre PAS une pose que le formateur n’est pas affecté à donner', () => {
    const resultat = appliquerOperations(
      [],
      [{ type: 'poser', seance: pose({ groupe: 'GM102', module: 'M101' }) }],
      regles()
    );

    expect(resultat).toEqual([]);
  });

  it('⚠️ ne montre PAS une pose qui ferait dépasser le quota du module', () => {
    // 20 h posées sur 30 h prévues : une séance de 2,5 h passe, onze ne passent pas.
    const pleine = regles({ posees: new Map([['GM101||M101', { presentiel: 30, synchrone: 0 }]]) });

    const resultat = appliquerOperations([], [{ type: 'poser', seance: pose() }], pleine);

    expect(resultat).toEqual([]);
  });

  it('⚠️ mais DÉPLACER une séance dont le module est à 100 % est montré — aucune heure de plus', () => {
    const pleine = regles({ posees: new Map([['GM101||M101', { presentiel: 30, synchrone: 0 }]]) });

    const resultat = appliquerOperations(
      [seance()],
      [{ type: 'deplacer', seance: pose({ id: ID_A }), source: creneau('Lundi', 'S1') }],
      pleine
    );

    expect(resultat).toHaveLength(1);
    expect(resultat[0]).toMatchObject({ jour: 'Mardi', seance: 'S3' });
  });

  it('⚠️ tient le décompte AU FIL du lot : la troisième pose bute sur le quota', () => {
    // 25 h posées sur 30 h : deux séances de 2,5 h passent, la troisième non.
    const presque = regles({ posees: new Map([['GM101||M101', { presentiel: 25, synchrone: 0 }]]) });

    const resultat = appliquerOperations(
      [],
      [
        { type: 'poser', seance: pose({ seance: 'S1' }) },
        { type: 'poser', seance: pose({ seance: 'S2' }) },
        { type: 'poser', seance: pose({ seance: 'S3' }) },
      ],
      presque
    );

    expect(resultat).toHaveLength(2);
  });

  it('ne montre PAS une pose avant la rentrée du groupe', () => {
    const gelee = regles({ gelDuJour: () => [{ anneeFormation: 1, date: '2026-09-18' }] });

    const resultat = appliquerOperations([], [{ type: 'poser', seance: pose({ groupe: 'GM101' }) }], gelee);

    expect(resultat).toEqual([]);
  });

  it('ne fabrique pas de rattrapage par la saisie ordinaire', () => {
    const resultat = appliquerOperations([], [{ type: 'poser', seance: pose({ statut: 'rattrape' }) }], regles());

    expect(resultat).toEqual([]);
  });

  it('⚠️ un déplacement bloqué par la SEULE salle est montré SANS salle', () => {
    const semaine = [
      seance({ id: ID_A, salle: 'B02' }),
      seance({ id: ID_B, formateurMatricule: '18494', groupe: 'GM102', module: 'M102', jour: 'Mardi', seance: 'S3', salle: 'B02' }),
    ];

    const resultat = appliquerOperations(
      semaine,
      [{ type: 'deplacer', seance: pose({ id: ID_A, salle: 'B02' }), source: creneau('Lundi', 'S1') }],
      regles({
        affectations: [...affectations, { formateur: '18494', groupe: 'GM102', module: 'M102', type: 'presentiel', s1Heures: 30 }],
      })
    );

    const deplacee = resultat.find((s) => s.id === ID_A);
    expect(deplacee).toMatchObject({ jour: 'Mardi', seance: 'S3', salle: '' });
  });

  it('⚠️ mais si la salle n’est pas seule en cause, le déplacement n’est pas montré', () => {
    const semaine = [
      seance({ id: ID_A, salle: 'B02' }),
      // Le MÊME groupe, au même créneau, ailleurs : les personnes sont prises.
      seance({ id: ID_B, formateurMatricule: '18494', jour: 'Mardi', seance: 'S3', salle: 'B02' }),
    ];

    const resultat = appliquerOperations(
      semaine,
      [{ type: 'deplacer', seance: pose({ id: ID_A, salle: 'B02' }), source: creneau('Lundi', 'S1') }],
      regles()
    );

    expect(resultat.find((s) => s.id === ID_A)).toMatchObject({ jour: 'Lundi', seance: 'S1' });
  });

  it('ne touche pas la Map des heures du cache', () => {
    const posees = new Map([['GM101||M101', { presentiel: 20, synchrone: 0 }]]);

    appliquerOperations([], [{ type: 'poser', seance: pose() }], regles({ posees }));

    expect(posees.get('GM101||M101')).toEqual({ presentiel: 20, synchrone: 0 });
  });
});

describe('confirmer', () => {
  it('remplace la séance simulée par celle du serveur — le vrai identifiant', () => {
    const simulee = [seance({ id: 'provisoire-Mardi-S3-jour-15688', jour: 'Mardi', seance: 'S3' })];
    const serveur = seance({ id: ID_B, jour: 'Mardi', seance: 'S3', date: '2026-09-15T00:00:00.000Z' });

    const resultat = confirmer(simulee, serveur);

    expect(resultat).toEqual([serveur]);
  });

  it('range la séance du serveur quand la prévision n’avait rien montré', () => {
    const resultat = confirmer([seance()], seance({ id: ID_B, jour: 'Mardi', seance: 'S3' }));

    expect(resultat).toHaveLength(2);
  });

  it('remplace par identifiant : un déplacement change le créneau, pas le nombre de séances', () => {
    const resultat = confirmer([seance()], seance({ id: ID_A, jour: 'Jeudi', seance: 'S2' }));

    expect(resultat).toHaveLength(1);
    expect(resultat[0]).toMatchObject({ jour: 'Jeudi', seance: 'S2' });
  });

  it('ne fait rien sans séance', () => {
    const semaine = [seance()];
    expect(confirmer(semaine, undefined)).toBe(semaine);
  });
});

describe('ajusterPosees', () => {
  it('ajoute ce que la semaine a gagné, et retranche ce qu’elle a perdu', () => {
    const avant = [seance()];
    const apres = [seance(), pose({ id: ID_B })];

    const resultat = ajusterPosees({ 'GM101||M101': { presentiel: 20, synchrone: 0 } }, avant, apres);

    expect(resultat['GM101||M101']).toEqual({ presentiel: 22.5, synchrone: 0 });
    expect(ajusterPosees(resultat, apres, avant)['GM101||M101']).toEqual({ presentiel: 20, synchrone: 0 });
  });

  it('⚠️ un déplacement ne change aucune heure', () => {
    const resultat = ajusterPosees(
      { 'GM101||M101': { presentiel: 30, synchrone: 0 } },
      [seance()],
      [seance({ jour: 'Jeudi', seance: 'S2' })]
    );

    expect(resultat['GM101||M101']).toEqual({ presentiel: 30, synchrone: 0 });
  });

  it('ne modifie pas l’objet reçu', () => {
    const posees = { 'GM101||M101': { presentiel: 20, synchrone: 0 } };

    ajusterPosees(posees, [], [seance()]);

    expect(posees['GM101||M101']).toEqual({ presentiel: 20, synchrone: 0 });
  });
});
