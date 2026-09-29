import { describe, it, expect } from 'vitest';
import {
  casesProtegees,
  cleCase,
  conflitsDeLaGrille,
  dejaImportees,
  echanger,
  importer,
  estModifiee,
  grilleDepuis,
  nombreDeChangements,
  poserCase,
  poseesAvecGrille,
  reservationsDeLaCase,
  versSeances,
} from './grille';

const s = (jour, seance, groupe, extra = {}) => ({ jour, seance, groupe, module: 'M101', salle: 'A12', ...extra });

describe('grille de proposition', () => {
  it('part de l’emploi actuel, sans les séances protégées', () => {
    const actuelles = [s('Lundi', 'S1', 'GM101'), s('Mardi', 'S3', 'GM101', { protegee: true })];
    expect(grilleDepuis(actuelles)).toEqual({ 'Lundi|S1': { groupe: 'GM101', module: 'M101', salle: 'A12' } });
    expect(Object.keys(casesProtegees(actuelles))).toEqual(['Mardi|S3']);
  });

  it('se relit dans l’ordre des jours puis des créneaux', () => {
    const grille = { 'Mardi|S1': { groupe: 'B', module: 'M', salle: '' }, 'Lundi|S4': { groupe: 'A', module: 'M', salle: '' } };
    expect(versSeances(grille).map((x) => cleCase(x.jour, x.seance))).toEqual(['Lundi|S4', 'Mardi|S1']);
  });

  it('échange deux cases, occupées ou non', () => {
    const grille = { 'Lundi|S1': { groupe: 'A' }, 'Lundi|S2': { groupe: 'B' } };
    expect(echanger(grille, 'Lundi|S1', 'Lundi|S2')).toEqual({ 'Lundi|S1': { groupe: 'B' }, 'Lundi|S2': { groupe: 'A' } });
    expect(echanger(grille, 'Lundi|S1', 'Mardi|S1')).toEqual({ 'Mardi|S1': { groupe: 'A' }, 'Lundi|S2': { groupe: 'B' } });
    expect(echanger(grille, 'Lundi|S1', 'Lundi|S1')).toBe(grille);
  });

  it('pose et vide une case sans toucher à l’original', () => {
    const grille = {};
    const posee = poserCase(grille, 'Lundi|S1', { groupe: 'A' });
    expect(posee).toEqual({ 'Lundi|S1': { groupe: 'A' } });
    expect(grille).toEqual({});
    expect(poserCase(posee, 'Lundi|S1', null)).toEqual({});
  });

  it('compte les cases modifiées par rapport à l’emploi actuel', () => {
    const depart = grilleDepuis([s('Lundi', 'S1', 'GM101')]);
    const grille = echanger(depart, 'Lundi|S1', 'Lundi|S2');
    expect(estModifiee(grille, depart, 'Lundi|S1')).toBe(true);
    expect(estModifiee(grille, depart, 'Mardi|S1')).toBe(false);
    expect(nombreDeChangements(grille, depart)).toBe(2);
    expect(nombreDeChangements(depart, depart)).toBe(0);
  });

  it('importe le chronogramme dans les premières cases libres, sans doubler', () => {
    const item = { groupe: 'GM101', module: 'M101', nombre: 2, salle: 'A12' };
    const protegees = { 'Lundi|S1': s('Lundi', 'S1', 'X', { protegee: true }) };
    const reservees = [{ auteur: 'AHMED', seances: [s('Lundi', 'S2', 'GM101')] }];

    const premier = importer({}, [item], { protegees, reservees });
    // S1 verrouillée, S2 réservée par un collègue pour le même groupe : S3 et S4.
    expect(Object.keys(premier.grille)).toEqual(['Lundi|S3', 'Lundi|S4']);
    expect(premier).toMatchObject({ placees: 2, manquantes: 0 });
    expect(dejaImportees(premier.grille, item)).toBe(2);

    const second = importer(premier.grille, [item], { protegees, reservees });
    expect(second.placees).toBe(0);
    expect(Object.keys(second.grille)).toHaveLength(2);
  });

  it('évite les indisponibilités tant qu’il reste de la place, sans les interdire', () => {
    const item = { groupe: 'GM101', module: 'M101', nombre: 1 };
    const indisponibilites = [{ jour: 'Lundi', seance: 'S1' }];
    expect(Object.keys(importer({}, [item], { indisponibilites }).grille)).toEqual(['Lundi|S2']);

    // Tout le reste est pris : l'indisponibilité sert plutôt que de perdre la séance.
    const pleine = {};
    for (const jour of ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']) {
      for (const c of ['S1', 'S2', 'S3', 'S4']) pleine[cleCase(jour, c)] = { groupe: 'Z', module: 'Z', salle: '' };
    }
    delete pleine['Lundi|S1'];
    const r = importer(pleine, [item], { indisponibilites });
    expect(r).toMatchObject({ placees: 1, manquantes: 0 });
    expect(r.grille['Lundi|S1'].groupe).toBe('GM101');
  });

  it('compte ce qui ne trouve pas de place', () => {
    const pleine = {};
    for (const jour of ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']) {
      for (const c of ['S1', 'S2', 'S3', 'S4']) pleine[cleCase(jour, c)] = { groupe: 'Z', module: 'Z', salle: '' };
    }
    expect(importer(pleine, [{ groupe: 'GM101', module: 'M101', nombre: 1 }]).manquantes).toBe(1);
  });

  it('le posé de l’année suit la grille : l’actuel retiré, la grille ajoutée', () => {
    const serveur = { 'GM101||M101': { presentiel: 10, synchrone: 0 } };
    const actuelles = [
      s('Lundi', 'S1', 'GM101'),
      // Un EFM reste en place à l'application : il n'est pas retiré (et ne compte pas).
      s('Mardi', 'S1', 'GM101', { protegee: true, estEfm: true }),
    ];
    const grille = {
      'Lundi|S1': { groupe: 'GM101', module: 'M101', salle: 'A12' },
      'Lundi|S2': { groupe: 'GM101', module: 'M101', salle: 'A12' },
      'Jeudi|S1': { groupe: 'GM101', module: 'M101', salle: 'TEAMS' },
    };

    const posees = poseesAvecGrille(serveur, actuelles, grille);
    // 10 − 2,5 (Lundi S1 actuel) + 2 × 2,5 en salle ; 2,5 à distance.
    expect(posees.get('GM101||M101')).toEqual({ presentiel: 12.5, synchrone: 2.5 });
    // Rien dans la grille : le posé retombe sans l'actuel.
    expect(poseesAvecGrille(serveur, actuelles, {}).get('GM101||M101')).toEqual({ presentiel: 7.5, synchrone: 0 });
  });

  it('signale les cases réservées par un collègue', () => {
    const reservees = [{ auteur: 'AHMED', seances: [s('Lundi', 'S1', 'GM101', { salle: 'B02' })] }];
    const grille = { 'Lundi|S1': { groupe: 'GM101', module: 'M1', salle: 'A12' }, 'Lundi|S2': { groupe: 'GM101', module: 'M1', salle: 'A12' } };
    const conflits = conflitsDeLaGrille(grille, reservees);
    expect(Object.keys(conflits)).toEqual(['Lundi|S1']);
    expect(conflits['Lundi|S1'].auteur).toBe('AHMED');
    expect(reservationsDeLaCase(reservees, 'Lundi', 'S1')).toEqual([{ auteur: 'AHMED', ...s('Lundi', 'S1', 'GM101', { salle: 'B02' }) }]);
    expect(reservationsDeLaCase(reservees, 'Lundi', 'S2')).toEqual([]);
  });
});
