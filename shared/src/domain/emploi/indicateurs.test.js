import { TYPES_COURS } from '../../constants/index.js';
import { describe, it, expect } from 'vitest';
import {
  HEURES_BADGE_BAS,
  avancementModule,
  avancementParSemaine,
  cleModule,
  fichesModules,
  heuresPosees,
  niveauHeures,
} from './indicateurs.js';

const affectation = (surcharges = {}) => ({
  formateur: '9863',
  groupe: 'GM101',
  module: 'M101',
  s1Heures: 30,
  s2Heures: 0,
  estRegional: false,
  ...surcharges,
});

const seance = (surcharges = {}) => ({
  groupe: 'GM101',
  module: 'M101',
  seance: 'S1',
  statut: 'planifie',
  ...surcharges,
});

describe('fichesModules', () => {
  it('rend le semestre d’après les heures', () => {
    const fiches = fichesModules([
      affectation({ s1Heures: 30, s2Heures: 0 }),
      affectation({ module: 'M102', s1Heures: 0, s2Heures: 20 }),
      affectation({ module: 'M103', s1Heures: 10, s2Heures: 10 }),
    ]);

    expect(fiches.get(cleModule('GM101', 'M101')).semestre).toBe('1');
    expect(fiches.get(cleModule('GM101', 'M102')).semestre).toBe('2');
    // Un module porté sur les deux semestres est ANNUEL, comme les badges de
    // la carte.
    expect(fiches.get(cleModule('GM101', 'M103')).semestre).toBe('A');
  });

  it('⚠️ ADDITIONNE présentiel et synchrone dans la masse prévue', () => {
    /*
     * C'est `(prevu + prevuSynchrone)` de l'existant. N'en compter qu'un ferait
     * afficher un taux au-delà de 100 % sur tout module à distance.
     */
    const fiches = fichesModules([
      affectation({ s1Heures: 30, s2Heures: 0 }),
      affectation({ type: 'synchrone', s1Heures: 10, s2Heures: 0 }),
    ]);

    expect(fiches.get(cleModule('GM101', 'M101')).prevu).toBe(40);
  });

  it('marque l’EFM régional dès qu’une ligne le porte', () => {
    const fiches = fichesModules([
      affectation(),
      affectation({ estRegional: true, s1Heures: 0, s2Heures: 10 }),
    ]);
    expect(fiches.get(cleModule('GM101', 'M101')).estRegional).toBe(true);
  });

  it('une affectation FUSIONNÉE vaut pour chacun de ses groupes', () => {
    // La séance est mutualisée mais chaque groupe reçoit bien ces heures.
    const fiches = fichesModules([affectation({ groupe: 'GM101 GM102' })]);

    expect(fiches.get(cleModule('GM101', 'M101')).prevu).toBe(30);
    expect(fiches.get(cleModule('GM102', 'M101')).prevu).toBe(30);
  });

  it('ne casse pas un nom à SUFFIXE', () => {
    const fiches = fichesModules([affectation({ groupe: 'ACADA101 (FQ)' })]);
    expect(fiches.has(cleModule('ACADA101 (FQ)', 'M101'))).toBe(true);
  });
});

describe('heuresPosees', () => {
  it('compte une séance pour sa durée', () => {
    const posees = heuresPosees([seance(), seance({ seance: 'S2' })]);
    // ⚠️ Deux compteurs, un par TYPE : une séance en salle ne consomme pas la
    // masse à distance, et réciproquement.
    expect(posees.get(cleModule('GM101', 'M101'))).toEqual({ presentiel: 5, synchrone: 0 });
  });

  it('compte le créneau du SOIR à 2 h', () => {
    expect(heuresPosees([seance({ seance: 'S5' })]).get(cleModule('GM101', 'M101'))).toEqual({
      presentiel: 2,
      synchrone: 0,
    });
  });

  it('⚠️ N’INCLUT PAS une séance ABSENTE', () => {
    /*
     * Le cours n'a pas eu lieu : l'inclure ferait croire le module couvert alors
     * qu'il reste à rattraper. C'est aussi ce que fait l'existant, qui écarte
     * `salle === 'ABSENT'`.
     */
    const posees = heuresPosees([seance(), seance({ seance: 'S2', statut: 'absent' })]);
    expect(posees.get(cleModule('GM101', 'M101')).presentiel).toBe(2.5);
  });

  it('une séance FUSIONNÉE compte pour chacun de ses groupes', () => {
    const posees = heuresPosees([seance({ groupe: 'GM101 GM102' })]);
    expect(posees.get(cleModule('GM101', 'M101')).presentiel).toBe(2.5);
    expect(posees.get(cleModule('GM102', 'M101')).presentiel).toBe(2.5);
  });
});

describe('avancementModule', () => {
  const fiches = fichesModules([affectation({ s1Heures: 10, s2Heures: 0 })]);

  it('rend le taux et son niveau', () => {
    const posees = heuresPosees([seance(), seance({ seance: 'S2' })]);
    expect(avancementModule(fiches, posees, 'GM101', 'M101')).toEqual({
      taux: 50,
      prevu: 10,
      pose: 5,
      niveau: 'moyen',
    });
  });

  it('classe les trois niveaux comme l’existant', () => {
    const niveau = (heures) =>
      avancementModule(
        fiches,
        new Map([[cleModule('GM101', 'M101'), { presentiel: heures, synchrone: 0 }]]),
        'GM101',
        'M101'
      ).niveau;

    expect(niveau(2)).toBe('bas');
    expect(niveau(5)).toBe('moyen');
    expect(niveau(10)).toBe('haut');
    // Un dépassement reste « haut » : c'est déjà couvert.
    expect(niveau(12)).toBe('haut');
  });

  it('⚠️ rend NULL quand rien n’est prévu', () => {
    /*
     * Un taux sur zéro heure prévue n'a aucun sens, et afficher « 0 % » ferait
     * croire à un retard là où il n'y a rien à faire.
     */
    expect(avancementModule(fiches, new Map(), 'GM101', 'INCONNU')).toBeNull();
    expect(avancementModule(new Map(), new Map(), 'GM101', 'M101')).toBeNull();
  });
});

describe('niveauHeures', () => {
  it('reprend les seuils des badges de l’existant', () => {
    expect(niveauHeures(35)).toBe('surcharge');
    expect(niveauHeures(25)).toBe('normal');
    expect(niveauHeures(10)).toBe('sous-charge');
    expect(HEURES_BADGE_BAS).toBe(20);
  });

  it('⚠️ une semaine VIDE n’est pas une sous-charge', () => {
    // Le signaler en orange mettrait toute la grille en alerte au début de la
    // saisie, quand rien n'est encore posé.
    expect(niveauHeures(0)).toBe('normal');
  });
});

describe('heuresPosees — séances fusionnées', () => {
  const fusionnee = [
    { groupe: 'GM101 GM102', module: 'M101', seance: 'S1', periode: 'jour', salle: 'TEAMS' },
  ];

  it('⚠️ compte pour CHAQUE membre ET pour le libellé fusionné', () => {
    /*
     * L'existant appariait le POSÉ par inclusion (`groupe.includes(...)`) et le
     * PRÉVU exactement : une affectation SYNCHRONE porte le libellé fusionné en
     * entier, et ne compter que les membres la laissait à zéro — d'où l'absence
     * de taux sur les séances Teams.
     */
    const posees = heuresPosees(fusionnee);

    // La fixture porte `salle: 'TEAMS'` : ces heures sont SYNCHRONES.
    expect(posees.get(cleModule('GM101', 'M101')).synchrone).toBe(2.5);
    expect(posees.get(cleModule('GM102', 'M101')).synchrone).toBe(2.5);
    expect(posees.get(cleModule('GM101 GM102', 'M101')).synchrone).toBe(2.5);
  });

  it('un groupe SEUL ne crée pas de doublon', () => {
    // Sans le garde `membres.length > 1`, « GM101 » serait compté deux fois.
    const posees = heuresPosees([{ groupe: 'GM101', module: 'M101', seance: 'S1' }]);

    expect(posees.get(cleModule('GM101', 'M101')).presentiel).toBe(2.5);
    expect(posees.size).toBe(1);
  });

  it('le taux d’une affectation SYNCHRONE se calcule enfin', () => {
    const fiches = fichesModules([
      { formateur: '9863', groupe: 'GM101 GM102', module: 'M101', s1Heures: 10 },
    ]);
    const avancement = avancementModule(fiches, heuresPosees(fusionnee), 'GM101 GM102', 'M101');

    expect(avancement).toMatchObject({ prevu: 10, pose: 2.5, taux: 25 });
  });
});

describe('avancementParSemaine', () => {
  const seance = (semaine, creneau = 'S1', surcharges = {}) => ({
    semaine,
    seance: creneau,
    groupe: 'GM101',
    module: 'M101',
    ...surcharges,
  });

  it('rend les semaines DANS L’ORDRE DES NUMÉROS, pas alphabétique', () => {
    // « 2026-W10 » précède « 2026-W2 » en tri de chaînes : l'histoire du module
    // se lirait à l'envers.
    const { semaines } = avancementParSemaine(
      [seance('2026-W10'), seance('2026-W2'), seance('2026-W1')],
      'GM101',
      'M101',
      20
    );

    expect(semaines.map((s) => s.numero)).toEqual([1, 2, 10]);
  });

  it('cumule les heures et le taux de semaine en semaine', () => {
    const { semaines, pose, taux } = avancementParSemaine(
      [seance('2026-W1'), seance('2026-W1', 'S2'), seance('2026-W3')],
      'GM101',
      'M101',
      10
    );

    expect(semaines).toEqual([
      { semaine: '2026-W1', numero: 1, heures: 5, cumul: 5, taux: 50 },
      { semaine: '2026-W3', numero: 3, heures: 2.5, cumul: 7.5, taux: 75 },
    ]);
    expect({ pose, taux }).toEqual({ pose: 7.5, taux: 75 });
  });

  it('une séance ABSENTE ne compte pas — le cours n’a pas eu lieu', () => {
    const { pose, semaines } = avancementParSemaine(
      [seance('2026-W1'), seance('2026-W2', 'S1', { statut: 'absent' })],
      'GM101',
      'M101',
      10
    );

    expect(pose).toBe(2.5);
    expect(semaines).toHaveLength(1);
  });

  it('une séance FUSIONNÉE avance le module de CHACUN de ses groupes', () => {
    const fusionnee = [seance('2026-W1', 'S1', { groupe: 'GM101 GM102' })];

    expect(avancementParSemaine(fusionnee, 'GM101', 'M101', 10).pose).toBe(2.5);
    expect(avancementParSemaine(fusionnee, 'GM102', 'M101', 10).pose).toBe(2.5);
    // Et pour le libellé fusionné lui-même, que porte l'affectation synchrone.
    expect(avancementParSemaine(fusionnee, 'GM101 GM102', 'M101', 10).pose).toBe(2.5);
  });

  it('le suffixe d’un groupe ne le découpe PAS en deux', () => {
    // `separerFusion` rattache « (FQ) » à « ACADA101 » : un découpage naïf sur
    // les espaces en ferait deux groupes fantômes.
    const seances = [seance('2026-W1', 'S1', { groupe: 'ACADA101 (FQ)' })];

    expect(avancementParSemaine(seances, 'ACADA101 (FQ)', 'M101', 10).pose).toBe(2.5);
    expect(avancementParSemaine(seances, 'ACADA101', 'M101', 10).pose).toBe(0);
  });

  it('le créneau du SOIR dure 2 h, pas 2,5', () => {
    expect(avancementParSemaine([seance('2026-W1', 'S5')], 'GM101', 'M101', 10).pose).toBe(2);
  });

  it('accepte le zéro de remplissage laissé en base', () => {
    const { semaines } = avancementParSemaine([seance('2026-W039')], 'GM101', 'M101', 10);

    expect(semaines[0]).toMatchObject({ semaine: '2026-W39', numero: 39 });
  });

  it('sans masse prévue, AUCUN taux — jamais « 0 % »', () => {
    const { taux, semaines } = avancementParSemaine([seance('2026-W1')], 'GM101', 'M101', 0);

    expect(taux).toBeNull();
    expect(semaines[0].taux).toBeNull();
  });
});

describe('⚠️ présentiel et synchrone se mesurent SÉPARÉMENT', () => {
  /*
   * Le cas signalé à l'usage : EGTSI106 · GM101 déclare 25 h en salle et 15 h à
   * distance. 42,5 h de cours EN SALLE s'affichaient à 106 % d'un quota de 40 h,
   * alors qu'elles dépassent de 70 % les 25 h qui leur sont destinées — la masse
   * à distance, intacte, absorbait l'écart.
   */
  const affectations = [
    {
      formateur: '9863',
      groupe: 'GM101',
      module: 'EGTSI106',
      type: TYPES_COURS.PRESENTIEL,
      s1Heures: 25,
    },
    {
      formateur: '9863',
      groupe: 'GM101',
      module: 'EGTSI106',
      type: TYPES_COURS.SYNCHRONE,
      s1Heures: 15,
    },
  ];
  const fiches = fichesModules(affectations);
  const cle = cleModule('GM101', 'EGTSI106');

  const enSalle = (n) =>
    Array.from({ length: n }, () => ({
      groupe: 'GM101',
      module: 'EGTSI106',
      seance: 'S1',
      salle: 'Salle 1',
    }));

  it('la fiche porte les DEUX masses, et leur total', () => {
    expect(fiches.get(cle)).toMatchObject({ presentiel: 25, synchrone: 15, prevu: 40 });
  });

  it('17 séances en salle dépassent les 25 h prévues — 170 %, pas 106 %', () => {
    const posees = heuresPosees(enSalle(17)); // 42,5 h
    const avancement = avancementModule(
      fiches,
      posees,
      'GM101',
      'EGTSI106',
      TYPES_COURS.PRESENTIEL
    );

    expect(avancement).toMatchObject({ pose: 42.5, prevu: 25, taux: 170 });
  });

  it('et la masse À DISTANCE reste intacte, à 0 %', () => {
    const avancement = avancementModule(
      fiches,
      heuresPosees(enSalle(17)),
      'GM101',
      'EGTSI106',
      TYPES_COURS.SYNCHRONE
    );

    expect(avancement).toMatchObject({ pose: 0, prevu: 15, taux: 0 });
  });

  it('une séance TEAMS consomme le quota SYNCHRONE, jamais le présentiel', () => {
    const posees = heuresPosees([
      { groupe: 'GM101', module: 'EGTSI106', seance: 'S1', salle: 'TEAMS' },
    ]);

    expect(posees.get(cle)).toEqual({ presentiel: 0, synchrone: 2.5 });
  });

  it('`avancementParSemaine` ne retient que les semaines de SON type', () => {
    const seances = [
      { semaine: '2026-W1', seance: 'S1', groupe: 'GM101', module: 'EGTSI106', salle: 'Salle 1' },
      { semaine: '2026-W2', seance: 'S1', groupe: 'GM101', module: 'EGTSI106', salle: 'TEAMS' },
    ];

    const salle = avancementParSemaine(seances, 'GM101', 'EGTSI106', 25, TYPES_COURS.PRESENTIEL);
    const distance = avancementParSemaine(seances, 'GM101', 'EGTSI106', 15, TYPES_COURS.SYNCHRONE);

    expect(salle.semaines.map((s) => s.semaine)).toEqual(['2026-W1']);
    expect(distance.semaines.map((s) => s.semaine)).toEqual(['2026-W2']);
  });

  it('⚠️ sans `type`, une affectation compte en PRÉSENTIEL', () => {
    // Un import ancien peut ne pas le porter : la ranger en synchrone gonflerait
    // un quota que rien ne consomme et viderait celui qui sert.
    const sansType = fichesModules([{ groupe: 'GM101', module: 'M9', s1Heures: 10 }]);

    expect(sansType.get(cleModule('GM101', 'M9'))).toMatchObject({ presentiel: 10, synchrone: 0 });
  });
});

describe('EFM — une surveillance n’est pas un cours', () => {
  /*
   * ⚠️ LE MODULE N'AVANCE PAS PENDANT SON PROPRE EXAMEN. Compter les
   * heures de surveillance ferait grimper le taux au moment précis où le
   * programme s'arrête — et le surveillant n'enseigne pas.
   */
  const seances = [
    { groupe: 'GM101', module: 'M101', seance: 'S1', salle: 'A12' },
    { groupe: 'GM101', module: 'M101', seance: 'S2', salle: 'A12', estEfm: true },
  ];

  it('⚠️ `heuresPosees` écarte les surveillances', () => {
    expect(heuresPosees(seances).get(cleModule('GM101', 'M101'))).toMatchObject({ presentiel: 2.5 });
  });

  it('⚠️ et `avancementParSemaine` aussi — les deux décomptes doivent concorder', () => {
    const avec = seances.map((s) => ({ ...s, semaine: '2026-W1' }));
    expect(avancementParSemaine(avec, 'GM101', 'M101', 40).pose).toBe(2.5);
  });
});
