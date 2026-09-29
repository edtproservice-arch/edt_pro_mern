import { describe, it, expect } from 'vitest';
import {
  cellulesNouvellementFermees,
  joursDesPeriodes,
  motifDeSuppression,
  nonPlaceesDesSeances,
  nouvellesFermetures,
  resumeVide,
  resumerSuppressions,
  semainesFermees,
} from './fermetures.js';

describe('joursDesPeriodes', () => {
  it('énumère chaque jour, bornes comprises', () => {
    expect([...joursDesPeriodes([{ debut: '2026-09-28', fin: '2026-10-02' }])]).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
  });

  it('traverse le changement d’heure sans sauter ni doubler de jour', () => {
    const jours = joursDesPeriodes([{ debut: '2026-10-24', fin: '2026-10-27' }]);
    expect([...jours]).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
  });

  it('accepte une période à l’envers et les anciens noms de champs', () => {
    expect(joursDesPeriodes([{ date_debut: '2026-10-02', date_fin: '2026-10-01' }]).size).toBe(2);
  });

  it('ignore une période incomplète', () => {
    expect(joursDesPeriodes([{ debut: '2026-10-01' }, null]).size).toBe(0);
  });
});

describe('nouvellesFermetures', () => {
  it('ne retient que les jours NOUVEAUX d’un stage élargi', () => {
    const fermetures = nouvellesFermetures(
      { stages: [{ groupe: 'GM101', debut: '2026-09-28', fin: '2026-09-29' }] },
      { stages: [{ groupe: 'gm101 ', debut: '2026-09-28', fin: '2026-09-30' }] }
    );

    expect([...fermetures.stages.get('GM101')]).toEqual(['2026-09-30']);
    expect(fermetures.jours).toEqual(['2026-09-30']);
    expect(fermetures.vide).toBe(false);
  });

  it('⚠️ un stage raccourci ou retiré ne ferme rien', () => {
    const fermetures = nouvellesFermetures(
      { stages: [{ groupe: 'GM101', debut: '2026-09-28', fin: '2026-10-02' }] },
      { stages: [{ groupe: 'GM101', debut: '2026-09-28', fin: '2026-09-29' }] }
    );
    expect(fermetures.vide).toBe(true);
  });

  it('distingue les groupes : déplacer un stage vers un autre groupe ferme l’autre', () => {
    const periode = { debut: '2026-09-28', fin: '2026-09-28' };
    const fermetures = nouvellesFermetures(
      { stages: [{ groupe: 'GM101', ...periode }] },
      { stages: [{ groupe: 'GM102', ...periode }] }
    );
    expect(fermetures.stages.has('GM101')).toBe(false);
    expect(fermetures.stages.get('GM102').has('2026-09-28')).toBe(true);
  });

  it('apparie les formations par MATRICULE, jamais par un matricule vide', () => {
    const fermetures = nouvellesFermetures(
      {},
      {
        formations: [
          { matriculeFormateur: '9863', debut: '2026-10-05', fin: '2026-10-05' },
          { matriculeFormateur: '', nomFormateur: 'X', debut: '2026-10-06', fin: '2026-10-06' },
        ],
      }
    );
    expect([...fermetures.formations.keys()]).toEqual(['9863']);
  });

  it('compare les vacances effectives avant / après', () => {
    const fermetures = nouvellesFermetures(
      { vacances: [] },
      { vacances: [{ nom: 'Pont', debut: '2026-11-06', fin: '2026-11-07' }] }
    );
    expect([...fermetures.vacances]).toEqual(['2026-11-06', '2026-11-07']);
  });
});

describe('motifDeSuppression', () => {
  const fermetures = nouvellesFermetures(
    {},
    {
      vacances: [{ debut: '2026-11-06', fin: '2026-11-06' }],
      stages: [{ groupe: 'GM102', debut: '2026-10-05', fin: '2026-10-05' }],
      formations: [{ matriculeFormateur: '9863', debut: '2026-10-06', fin: '2026-10-06' }],
    }
  );

  it('vacances d’abord, pour tout le monde', () => {
    expect(motifDeSuppression({ groupe: 'X', formateurMatricule: 'Y' }, '2026-11-06', fermetures)).toBe(
      'vacances'
    );
  });

  it('⚠️ une fusion part dès qu’un de ses membres est en stage', () => {
    expect(motifDeSuppression({ groupe: 'GM101 GM102' }, '2026-10-05', fermetures)).toBe('stage');
    expect(motifDeSuppression({ groupe: 'GM101' }, '2026-10-05', fermetures)).toBeNull();
  });

  it('la formation ne vise que son formateur', () => {
    expect(
      motifDeSuppression({ groupe: 'GM101', formateurMatricule: '9863' }, '2026-10-06', fermetures)
    ).toBe('formation');
    expect(
      motifDeSuppression({ groupe: 'GM101', formateurMatricule: '1111' }, '2026-10-06', fermetures)
    ).toBeNull();
  });

  it('rien sans jour ni fermetures', () => {
    expect(motifDeSuppression({ groupe: 'GM102' }, null, fermetures)).toBeNull();
    expect(motifDeSuppression({ groupe: 'GM102' }, '2026-10-05', null)).toBeNull();
  });
});

describe('semainesFermees / cellulesNouvellementFermees', () => {
  it('lit les semaines non disponibles', () => {
    expect([
      ...semainesFermees([
        { numero: 1, disponible: true },
        { numero: 2, disponible: false },
      ]),
    ]).toEqual([2]);
  });

  it('⚠️ ne retire que les semaines fermées PAR le changement', () => {
    const planning = {
      M101: [
        { semaine: 'S2', heures: 5, type: 'P' },
        { semaine: 'S3', heures: 5, type: 'P' },
        { semaine: 'S4', heures: 0, type: 'P' },
        { semaine: 'X', heures: 5, type: 'P' },
      ],
      M102: [{ semaine: 'S3', heures: 2.5, type: 'S' }],
    };
    const avant = () => new Set([2]);
    const apres = (module) => (module === 'M101' ? new Set([2, 3, 4]) : new Set([2]));

    expect(cellulesNouvellementFermees(planning, avant, apres)).toEqual([
      { module: 'M101', semaine: 'S3', numero: 3, heures: 5 },
    ]);
  });
});

describe('nonPlaceesDesSeances / resumerSuppressions', () => {
  const seances = [
    { anneeScolaire: 2026, semaine: '2026-W3', groupe: 'GM101', module: 'M101', formateurMatricule: '9863', motif: 'stage' },
    { anneeScolaire: 2026, semaine: '2026-W3', groupe: 'GM101', module: 'M101', formateurMatricule: '9863', motif: 'stage', statut: 'absent' },
    { anneeScolaire: 2026, semaine: '2026-W3', groupe: 'GM101', module: 'M101', motif: 'stage', rattrapageDe: 'abs1' },
    { anneeScolaire: 2026, semaine: '2026-W3', groupe: 'GM101 GM102', module: 'EFM', motif: 'vacances', estEfm: true },
  ];

  it('regroupe les cours, sans EFM ni rattrapage', () => {
    expect(nonPlaceesDesSeances(seances)).toEqual([
      {
        anneeScolaire: 2026,
        semaine: '2026-W3',
        groupe: 'GM101',
        module: 'M101',
        formateurMatricule: '9863',
        nombre: 2,
      },
    ]);
  });

  it('chiffre ce qui partirait', () => {
    const resume = resumerSuppressions(seances, [{ groupe: 'GM103', heures: 7.5 }]);
    expect(resume).toEqual({
      seances: 4,
      parMotif: { vacances: 1, stage: 3, formation: 0 },
      rattrapages: 1,
      efm: 1,
      absences: 1,
      nonPlacees: 2,
      cellules: 1,
      heures: 7.5,
      groupes: ['GM101', 'GM102', 'GM103'],
    });
    expect(resumeVide(resume)).toBe(false);
    expect(resumeVide(resumerSuppressions())).toBe(true);
  });
});
