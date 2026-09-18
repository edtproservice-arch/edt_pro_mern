import { describe, it, expect } from 'vitest';
import {
  avantRentree,
  dateRentree,
  fusionnerVacances,
  joursAvantRentree,
  premiereRentree,
} from './rentree.js';
import { disponibilite } from './calendrier.js';

/** Le réglage réel donné par le porteur pour 2026-2027. */
const RENTREES = [
  { anneeFormation: 1, date: '2026-09-11' },
  { anneeFormation: 2, date: '2026-09-07' },
  { anneeFormation: 3, date: '2026-09-07' },
];

describe('dateRentree', () => {
  it('rend la date de l’année demandée', () => {
    expect(dateRentree(1, RENTREES)).toBe('2026-09-11');
    expect(dateRentree(2, RENTREES)).toBe('2026-09-07');
  });

  /*
   * ⚠️ `null` PLUTÔT QU'UNE DATE PAR DÉFAUT : sans réglage, RIEN ne doit être
   * gelé. Inventer « le 1er septembre » figerait des journées que personne n'a
   * déclarées fermées — et l'établissement ne comprendrait pas pourquoi.
   */
  it('rend null pour une année non paramétrée, ou sans réglage', () => {
    expect(dateRentree(4, RENTREES)).toBeNull();
    expect(dateRentree(1, [])).toBeNull();
    expect(dateRentree(null, RENTREES)).toBeNull();
  });
});

describe('avantRentree', () => {
  /* L'exemple du porteur : les 2ᵉ années rentrent le 7, les 1ʳᵉ le 11. */
  it('gèle les jours qui précèdent la rentrée de CETTE année de formation', () => {
    /* Le 8 septembre : la 2ᵉ année a repris, la 1ʳᵉ non. */
    expect(avantRentree('2026-09-08', 2, RENTREES)).toBeNull();
    expect(avantRentree('2026-09-08', 1, RENTREES)).toEqual({
      date: '2026-09-11',
      anneeFormation: 1,
    });
  });

  it('laisse passer le jour de la rentrée lui-même', () => {
    expect(avantRentree('2026-09-07', 2, RENTREES)).toBeNull();
    expect(avantRentree('2026-09-11', 1, RENTREES)).toBeNull();
  });

  it('gèle le 1er septembre pour tout le monde', () => {
    expect(avantRentree('2026-09-01', 1, RENTREES)).toBeTruthy();
    expect(avantRentree('2026-09-01', 2, RENTREES)).toBeTruthy();
    expect(avantRentree('2026-09-01', 3, RENTREES)).toBeTruthy();
  });

  it('ne gèle rien sans réglage', () => {
    expect(avantRentree('2026-09-01', 1, [])).toBeNull();
  });

  it('rend null sur une date illisible plutôt que de lever', () => {
    expect(avantRentree('01/09/2026', 1, RENTREES)).toBeNull();
    expect(avantRentree(null, 1, RENTREES)).toBeNull();
  });
});

describe('premiereRentree', () => {
  /*
   * ⚠️ SERT AU TAUX RÉGIONAL (2026-09-03) : dès qu'UN SEUL niveau a sa
   * rentrée, l'établissement n'est plus totalement à l'arrêt. L'exemple du
   * porteur — 2ᵉ et 3ᵉ années le 7, 1ʳᵉ le 11 — rend donc le 7, pas le 11.
   */
  it('rend la plus PRÉCOCE des rentrées déclarées', () => {
    expect(premiereRentree(RENTREES)).toBe('2026-09-07');
  });

  it('rend null sans aucune rentrée déclarée', () => {
    expect(premiereRentree([])).toBeNull();
    expect(premiereRentree()).toBeNull();
  });

  it('ignore une entrée dont la date est illisible', () => {
    expect(
      premiereRentree([
        { anneeFormation: 1, date: 'pas une date' },
        { anneeFormation: 2, date: '2026-09-07' },
      ])
    ).toBe('2026-09-07');
  });

  it('ne se soucie pas de l’ordre du tableau', () => {
    expect(
      premiereRentree([
        { anneeFormation: 3, date: '2026-09-07' },
        { anneeFormation: 1, date: '2026-09-11' },
        { anneeFormation: 2, date: '2026-09-07' },
      ])
    ).toBe('2026-09-07');
  });
});

describe('joursAvantRentree', () => {
  /*
   * Une semaine à cheval sur la rentrée n'est pas fermée, elle est RÉDUITE —
   * exactement comme une semaine amputée par un stage de trois jours.
   */
  it('compte les jours perdus d’une semaine à cheval', () => {
    const semaine = [
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
    ];

    /* 1ʳᵉ année : quatre jours avant le 11. */
    expect(joursAvantRentree(semaine, 1, RENTREES)).toBe(4);
    /* 2ᵉ année : elle a déjà repris le lundi. */
    expect(joursAvantRentree(semaine, 2, RENTREES)).toBe(0);
  });

  it('ne perd aucun jour sans réglage', () => {
    expect(joursAvantRentree(['2026-09-01'], 1, [])).toBe(0);
  });
});

describe('fusionnerVacances', () => {
  const NATIONALES = [
    { nom: 'Vacances d’automne', debut: '2026-10-25', fin: '2026-11-02' },
    { nom: 'Vacances d’hiver', debut: '2026-12-20', fin: '2027-01-04' },
  ];

  it('rend les périodes nationales, marquées comme telles', () => {
    const fusion = fusionnerVacances(NATIONALES, []);

    expect(fusion).toHaveLength(2);
    expect(fusion.every((p) => p.origine === 'nationale')).toBe(true);
  });

  /*
   * ═══ ⚠️ « PAR DÉFAUT » NE VEUT PAS DIRE « IMPOSÉ » ═══
   * Un établissement qui ferme un jour de plus doit pouvoir le dire, et un autre
   * que la période nationale ne concerne pas doit pouvoir l'écarter — sinon il y
   * posera des séances, ou en perdra.
   */
  it('ajoute les périodes de l’établissement, et écarte celles qu’il refuse', () => {
    const fusion = fusionnerVacances(
      NATIONALES,
      [{ nom: 'Fermeture travaux', debut: '2026-11-10', fin: '2026-11-12' }],
      ['Vacances d’automne']
    );

    expect(fusion.map((p) => p.nom)).toEqual(['Fermeture travaux', 'Vacances d’hiver']);
    expect(fusion[0].origine).toBe('etablissement');
  });

  /* L'appariement se fait sur le nom, sans se soucier de la casse ni des
     espaces — comme celui des jours fériés. */
  it('écarte sans se soucier de la casse', () => {
    const fusion = fusionnerVacances(NATIONALES, [], ['  vacances d’HIVER ']);
    expect(fusion.map((p) => p.nom)).toEqual(['Vacances d’automne']);
  });

  it('trie par date de début, toutes origines confondues', () => {
    const fusion = fusionnerVacances(NATIONALES, [
      { nom: 'Pont local', debut: '2026-09-15', fin: '2026-09-16' },
    ]);

    expect(fusion.map((p) => p.nom)[0]).toBe('Pont local');
  });

  it('écarte une période dont une borne est illisible', () => {
    const fusion = fusionnerVacances([{ nom: 'Bancale', debut: 'hier', fin: '2026-10-02' }], []);
    expect(fusion).toHaveLength(0);
  });
});

describe('disponibilite — le cinquième motif', () => {
  /*
   * ═══ ⚠️ L'ORDRE DES MOTIFS EST CELUI DES PORTÉES ═══
   * Du plus général au plus particulier : férié (tout le monde), vacances
   * (l'établissement), rentrée (une année de formation), stage (un groupe),
   * formation (une personne). La première cause trouvée est celle qu'on annonce.
   */
  it('annonce « rentree » quand le jour précède la reprise du groupe', () => {
    const resultat = disponibilite({
      date: '2026-09-08',
      groupe: 'DEVOWFS101',
      anneeFormation: 1,
      rentrees: RENTREES,
    });

    expect(resultat).toEqual({
      disponible: false,
      motif: 'rentree',
      detail: { date: '2026-09-11', anneeFormation: 1 },
    });
  });

  it('laisse la 2ᵉ année travailler le même jour', () => {
    const resultat = disponibilite({
      date: '2026-09-08',
      groupe: 'DEVOWFS201',
      anneeFormation: 2,
      rentrees: RENTREES,
    });

    expect(resultat.disponible).toBe(true);
  });

  /*
   * ⚠️ SANS `anneeFormation`, LE MOTIF NE S'APPLIQUE PAS : en vue par formateur,
   * la ligne n'a pas d'année de formation — le même enseignant a ses 2ᵉ années
   * le 8 septembre. Geler sa ligne entière lui interdirait un cours qui a lieu.
   */
  it('ne gèle rien quand l’année de formation est inconnue', () => {
    const resultat = disponibilite({
      date: '2026-09-08',
      formateur: '15688',
      rentrees: RENTREES,
    });

    expect(resultat.disponible).toBe(true);
  });

  /* Un férié prime : il vaut pour tout le monde, rentrée ou pas. */
  it('annonce le férié plutôt que la rentrée quand les deux tombent', () => {
    const resultat = disponibilite({
      date: '2026-09-08',
      anneeFormation: 1,
      rentrees: RENTREES,
      joursFeries: [{ date: '2026-09-08', libelle: 'Fête' }],
    });

    expect(resultat.motif).toBe('ferie');
  });

  /* Et la rentrée prime sur le stage : elle porte sur toute une année. */
  it('annonce la rentrée plutôt que le stage', () => {
    const resultat = disponibilite({
      date: '2026-09-08',
      groupe: 'DEVOWFS101',
      anneeFormation: 1,
      rentrees: RENTREES,
      stages: [{ groupe: 'DEVOWFS101', debut: '2026-09-01', fin: '2026-09-30' }],
    });

    expect(resultat.motif).toBe('rentree');
  });
});
