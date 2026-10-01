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
  it('compare le réalisé saisi entre deux dépôts aux séances tenues dans la même fenêtre', () => {
    const imports = [
      {
        importeLe: new Date('2026-09-14T09:00:00'),
        lignes: [ligne({ matriculePresentiel: 'M1', formateurPresentiel: 'ALAMI SARA', realisePresentiel: 5 })],
      },
      {
        importeLe: new Date('2026-09-21T09:00:00'),
        lignes: [ligne({ matriculePresentiel: 'M1', formateurPresentiel: 'ALAMI SARA', realisePresentiel: 10 })],
      },
    ];
    const seances = [
      seance('2026-09-08', 'M1'),
      seance('2026-09-09', 'M1'),
      seance('2026-09-15', 'M1'),
      seance('2026-09-16', 'M1'),
      seance('2026-09-17', 'M1', { statut: 'absent' }),
      seance('2026-09-21', 'M1'), // le jour du dépôt : fenêtre suivante, hors tableau
    ];

    const { periodes, formateurs: lignes } = ecartsDeSaisie({
      imports,
      seances,
      formateurs,
      anneeScolaire: 2026,
    });

    expect(periodes).toHaveLength(2);
    expect(periodes[1]).toMatchObject({ debut: '2026-09-14', fin: '2026-09-20' });
    expect(lignes).toHaveLength(1);
    expect(lignes[0].nom).toBe('ALAMI SARA');
    // Deux séances de 2,5 h dans chaque fenêtre ; l'absence ne compte pas.
    expect(lignes[0].cellules[0]).toEqual({ enote: 5, edt: 5, ecart: 0 });
    expect(lignes[0].cellules[1]).toEqual({ enote: 5, edt: 5, ecart: 0 });
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

    expect(lignes[0]).toMatchObject({ nom: 'BENNANI OMAR', cellules: [{ enote: 4, edt: 0, ecart: 4 }] });
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

    expect(periodes.map((periode) => periode.fichier)).toEqual(['b.xlsx']);
  });

  it('détaille une carte par groupe et module, avec les séances de la grille', () => {
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
      seance('2026-09-08', 'M1', { groupe: 'G1', module: 'M101', jour: 'Mardi' }),
      seance('2026-09-09', 'M1', { groupe: 'G1', module: 'M101', jour: 'Mercredi', seance: 'S2' }),
      seance('2026-09-10', 'M1', { groupe: 'G3 G2', module: 'M101', salle: 'TEAMS' }),
      seance('2026-09-10', 'M2', { groupe: 'G1', module: 'M101' }),
    ];

    const detail = detailEcartDeSaisie({ imports, seances, formateurs, anneeScolaire: 2026, cle: 'M1', semaine: 3 });

    expect(detail).toMatchObject({ semaine: 3, debut: '2026-09-07', fin: '2026-09-13' });
    expect(detail.lignes).toHaveLength(2);
    expect(detail.lignes[0]).toMatchObject({ groupe: 'G1', module: 'M101', enote: 2.5, edt: 5, ecart: -2.5 });
    expect(detail.lignes[0].seances.map((s) => s.date)).toEqual(['2026-09-08', '2026-09-09']);
    expect(detail.lignes[1]).toMatchObject({ enote: 2.5, edt: 2.5, ecart: 0 });
    expect(detailEcartDeSaisie({ imports, seances, formateurs, anneeScolaire: 2026, cle: 'M1', semaine: 9 })).toBeNull();
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

    expect(lignes[0].cellules[0].edt).toBe(5);
  });

  it('rend une colonne par semaine, dépôt ou non', () => {
    const { semaines, periodes } = ecartsDeSaisie({
      imports: [
        { importeLe: new Date('2026-09-01T09:00:00'), lignes: [] },
        { importeLe: new Date('2026-09-16T09:00:00'), lignes: [] },
      ],
      formateurs,
      anneeScolaire: 2026,
    });

    expect(semaines.map((s) => [s.numero, s.debut, s.periode])).toEqual([
      [1, '2026-08-31', 0],
      [2, '2026-09-07', null],
      [3, '2026-09-14', 1],
    ]);
    expect(periodes[1]).toMatchObject({ semaine: 3, depuisSemaine: 2 });
  });
});
