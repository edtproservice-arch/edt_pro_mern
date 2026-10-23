import { describe, expect, it } from 'vitest';
import { detailEcartDeSaisie, ecartsDeSaisie } from './ecartsSaisie.js';

const formateurs = [
  { matricule: 'M1', nomComplet: 'ALAMI SARA', nomUnique: 'ALAMI' },
  { matricule: 'M2', nomComplet: 'BENNANI OMAR', nomUnique: 'BENNANI' },
];

const ligne = (champs) => ({
  groupe: 'G1',
  fusionGroupe: '',
  module: 'M101',
  matriculePresentiel: '',
  formateurPresentiel: '',
  matriculeSynchrone: '',
  formateurSynchrone: '',
  realisePresentiel: 0,
  realiseSynchrone: 0,
  ...champs,
});

const seance = (date, formateurMatricule, champs = {}) => ({
  date: new Date(`${date}T00:00:00`),
  formateurMatricule,
  seance: 'S1',
  statut: 'normal',
  estEfm: false,
  ...champs,
});

describe('ecartsDeSaisie', () => {
  // S1 = 31/08 ; S2 = 07–12/09 ; S3 = 14–19/09 ; S4 = 21–26/09.
  it('rend une colonne par semaine de S1 à S : avancement e-note du dernier dépôt − EDT réalisé depuis S1', () => {
    const imports = [
      {
        importeLe: new Date('2026-09-14T09:00:00'),
        lignes: [ligne({ matriculePresentiel: 'M1', formateurPresentiel: 'ALAMI SARA', realisePresentiel: 5 })],
      },
      {
        importeLe: new Date('2026-09-23T09:00:00'),
        lignes: [ligne({ matriculePresentiel: 'M1', formateurPresentiel: 'ALAMI SARA', realisePresentiel: 12.5 })],
      },
    ];
    const seances = [
      seance('2026-09-08', 'M1'),
      seance('2026-09-09', 'M1'),
      seance('2026-09-15', 'M1'),
      seance('2026-09-16', 'M1'),
      seance('2026-09-17', 'M1', { statut: 'absent' }),
      seance('2026-09-21', 'M1'),
      seance('2026-09-22', 'M1'),
      seance('2026-09-28', 'M1'), // S5 : hors des deux colonnes
    ];

    const { semaines, periodes, formateurs: lignes } = ecartsDeSaisie({
      imports,
      seances,
      formateurs,
      anneeScolaire: 2026,
    });

    expect(semaines.map((s) => [s.numero, s.debut, s.periode])).toEqual([
      [1, '2026-08-31', 0],
      [2, '2026-09-07', 1],
      [3, '2026-09-14', 2],
      [4, '2026-09-21', 3],
    ]);
    expect(periodes[3]).toMatchObject({ semaine: 4, debut: '2026-08-31', fin: '2026-09-26' });
    expect(lignes).toHaveLength(1);
    expect(lignes[0].nom).toBe('ALAMI SARA');
    // S2 : 2 séances depuis S1 ; S3 : 4 (l'absence ne compte pas) ; S4 : 6.
    expect(lignes[0].cellules).toEqual([
      { enote: 12.5, edt: 0, ecart: 12.5 },
      { enote: 12.5, edt: 5, ecart: 7.5 },
      { enote: 12.5, edt: 10, ecart: 2.5 },
      { enote: 12.5, edt: 15, ecart: -2.5 },
    ]);
  });

  it('lit le jour d’export dans le nom du fichier', () => {
    const { periodes } = ecartsDeSaisie({
      imports: [
        {
          importeLe: new Date('2026-09-19T09:00:00'),
          nomFichier: 'AvancementProgramme2026_EOS0_15_09_2026_13_58_48.xlsx',
          lignes: [],
        },
      ],
      formateurs,
      anneeScolaire: 2026,
    });

    expect(periodes.at(-1)).toMatchObject({ exporteLe: '2026-09-15', importeLe: '2026-09-19' });
  });

  it('ne compte qu’une séance par formateur et par créneau', () => {
    const { formateurs: lignes } = ecartsDeSaisie({
      imports: [{ importeLe: new Date('2026-09-14T09:00:00'), lignes: [] }],
      seances: [
        seance('2026-09-08', 'M1', { groupe: 'G1' }),
        seance('2026-09-08', 'M1', { groupe: 'G2' }),
        seance('2026-09-08', 'M1', { groupe: 'G1', seance: 'S2' }),
      ],
      formateurs,
      anneeScolaire: 2026,
    });

    expect(lignes[0].cellules.at(-1).edt).toBe(5);
  });

  it('ne compte qu’une fois le synchrone d’un ensemble fusionné', () => {
    const synchrone = { matriculeSynchrone: 'M2', formateurSynchrone: 'BENNANI OMAR', realiseSynchrone: 4 };
    const { formateurs: lignes } = ecartsDeSaisie({
      imports: [
        {
          importeLe: new Date('2026-09-14T09:00:00'),
          lignes: [
            ligne({ groupe: 'G1', fusionGroupe: 'G1 G2', ...synchrone }),
            ligne({ groupe: 'G2', fusionGroupe: 'G1 G2', ...synchrone }),
          ],
        },
      ],
      seances: [],
      formateurs,
      anneeScolaire: 2026,
    });

    expect(lignes[0]).toMatchObject({ nom: 'BENNANI OMAR', cellules: [{ enote: 4, ecart: 4 }, { enote: 4, ecart: 4 }, { enote: 4, ecart: 4 }] });
  });

  it('retient le dernier dépôt d’une même semaine', () => {
    const { periodes } = ecartsDeSaisie({
      imports: [
        { importeLe: new Date('2026-09-14T09:00:00'), nomFichier: 'a.xlsx', lignes: [] },
        { importeLe: new Date('2026-09-16T15:00:00'), nomFichier: 'b.xlsx', lignes: [] },
      ],
      formateurs,
      anneeScolaire: 2026,
    });

    expect(periodes.map((periode) => periode.fichier)).toEqual(['b.xlsx', 'b.xlsx', 'b.xlsx']); // S1 à S3
  });

  it('n’a qu’une colonne au dépôt de S1, et rien sans dépôt', () => {
    const { semaines } = ecartsDeSaisie({
      imports: [{ importeLe: new Date('2026-09-01T09:00:00'), lignes: [] }],
      formateurs,
      anneeScolaire: 2026,
    });
    expect(semaines.map((s) => s.numero)).toEqual([1]);
    expect(ecartsDeSaisie({ imports: [], formateurs, anneeScolaire: 2026 })).toEqual({
      semaines: [],
      periodes: [],
      formateurs: [],
    });
  });

  it('détaille une carte par groupe et module, en cumul depuis S1', () => {
    const imports = [
      { importeLe: new Date('2026-09-07T09:00:00'), lignes: [] },
      {
        importeLe: new Date('2026-09-14T09:00:00'),
        lignes: [
          ligne({ groupe: 'G1', matriculePresentiel: 'M1', formateurPresentiel: 'ALAMI SARA', realisePresentiel: 2.5 }),
          ligne({ groupe: 'G2', fusionGroupe: 'G2 G3', matriculeSynchrone: 'M1', realiseSynchrone: 2.5 }),
          ligne({ groupe: 'G3', fusionGroupe: 'G2 G3', matriculeSynchrone: 'M1', realiseSynchrone: 2.5 }),
        ],
      },
    ];
    const seances = [
      seance('2026-09-08', 'M1', { groupe: 'G1', module: 'M101' }),
      seance('2026-09-15', 'M1', { groupe: 'G1', module: 'M101', jour: 'Mardi' }),
      seance('2026-09-16', 'M1', { groupe: 'G1', module: 'M101', jour: 'Mercredi', seance: 'S2' }),
      seance('2026-09-17', 'M1', { groupe: 'G3 G2', module: 'M101', salle: 'TEAMS' }),
      seance('2026-09-17', 'M2', { groupe: 'G1', module: 'M101' }),
    ];

    const detail = detailEcartDeSaisie({ imports, seances, formateurs, anneeScolaire: 2026, cle: 'M1', semaine: 3 });

    expect(detail).toMatchObject({ semaine: 3, debut: '2026-08-31', fin: '2026-09-19' });
    expect(detail.lignes).toHaveLength(2);
    expect(detail.lignes[0]).toMatchObject({ groupe: 'G1', module: 'M101', enote: 2.5, edt: 7.5, ecart: -5 });
    expect(detail.lignes[0].seances.map((s) => s.date)).toEqual(['2026-09-08', '2026-09-15', '2026-09-16']);
    expect(detail.lignes[1]).toMatchObject({ enote: 2.5, edt: 2.5, ecart: 0 });

    // S−1 : seule la séance de S2 est réalisée.
    const precedente = detailEcartDeSaisie({ imports, seances, formateurs, anneeScolaire: 2026, cle: 'M1', semaine: 2 });
    expect(precedente.lignes.map((l) => l.ecart)).toEqual([0, 2.5]);
    expect(detailEcartDeSaisie({ imports, seances, formateurs, anneeScolaire: 2026, cle: 'M1', semaine: 4 })).toBeNull(); // après le dernier dépôt
  });

  it('ne compte que les séances réalisées — terminées, non absentes, hors EFM', () => {
    const { formateurs: lignes } = ecartsDeSaisie({
      imports: [{ importeLe: new Date('2026-09-14T09:00:00'), lignes: [] }],
      seances: [
        seance('2026-09-08', 'M1', { jour: 'Mardi' }),
        seance('2026-09-08', 'M1', { jour: 'Mardi', seance: 'S2', estEfm: true }),
        seance('2026-09-09', 'M1', { jour: 'Mercredi', statut: 'absent' }),
        seance('2026-09-10', 'M1', { jour: 'Jeudi', statut: 'rattrape' }),
        seance('2026-09-11', 'M1', { jour: 'Vendredi' }), // pas encore terminée
      ],
      formateurs,
      anneeScolaire: 2026,
      maintenant: { date: '2026-09-11', heure: '07:00' },
    });

    expect(lignes[0].cellules[1].edt).toBe(5); // S2, entre S−2 = S1 et S = S3
  });
});
