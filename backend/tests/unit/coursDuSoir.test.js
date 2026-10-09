import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { PERIODES, TYPES_COURS } from 'shared/constants';

import { construireProbleme } from '../../src/modules/generation/probleme.js';
import { resoudre } from '../../src/modules/generation/solveur.client.js';
import { periodeDe, tachesDeLaSemaine } from '../../src/modules/generation/taches.js';

/**
 * Le cours du soir (CDS) à la génération (2026-10-09, demande du porteur) :
 *  · 2 h, 4 h… au soir, le samedi soir en dernier recours ;
 *  · 2,5 h, 5 h… au jour, de préférence le samedi ;
 *  · 10 h : selon les autres cellules du groupe cette semaine-là.
 */
const CDS = 'TSBECM301 (CDS)';
const SEMAINE = 3;
const P = TYPES_COURS.PRESENTIEL;

const affectation = (module, formateur = '100') => ({
  formateur,
  groupe: CDS,
  module,
  type: P,
  s1Heures: 60,
  s2Heures: 0,
});

const chronoCds = (cellules) => ({
  groupe: CDS,
  planning: Object.fromEntries(
    Object.entries(cellules).map(([module, heures]) => [module, { [SEMAINE]: { heures, type: 'P' } }])
  ),
});

function semaineOuverte() {
  const jours = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'].map((jour, i) => ({
    jour,
    date: `2026-09-${String(14 + i).padStart(2, '0')}`,
    ferie: null,
    vacances: false,
    rentreesGelees: [],
    stages: [],
    formations: [],
  }));
  return { semaine: '2026-W3', anneeScolaire: 2026, jours, seances: [] };
}

const problemeDe = (taches, extra = {}) =>
  construireProbleme({
    semaine: semaineOuverte(),
    taches,
    salles: ['Salle 1', 'Salle 2'],
    formateurs: [],
    graine: 1,
    ...extra,
  });

describe('periodeDe — le volume décide', () => {
  it.each([2, 4, 6, 8, 12])('%s h → soir', (heures) => {
    expect(periodeDe(CDS, P, heures)).toBe(PERIODES.SOIR);
  });

  it.each([2.5, 5, 7.5])('%s h → jour', (heures) => {
    expect(periodeDe(CDS, P, heures)).toBe(PERIODES.JOUR);
  });

  it('10 h suit le reste de la semaine du groupe, sinon le jour', () => {
    expect(periodeDe(CDS, P, 10, { soir: true })).toBe(PERIODES.SOIR);
    expect(periodeDe(CDS, P, 10, { jour: true })).toBe(PERIODES.JOUR);
    expect(periodeDe(CDS, P, 10, {})).toBe(PERIODES.JOUR);
    expect(periodeDe(CDS, P, 10, { soir: true, jour: true })).toBe(PERIODES.JOUR);
  });

  it('ne touche ni un groupe de jour ni le synchrone', () => {
    expect(periodeDe('GM101', P, 4)).toBe(PERIODES.JOUR);
    expect(periodeDe(CDS, TYPES_COURS.SYNCHRONE, 4)).toBe(PERIODES.JOUR);
  });
});

describe('tachesDeLaSemaine — groupe CDS', () => {
  it('compte 2 h par séance au soir, 2,5 h au jour', () => {
    const { taches } = tachesDeLaSemaine({
      chronogrammes: [chronoCds({ M1: 4, M2: 5 })],
      affectations: [affectation('M1'), affectation('M2', '200')],
      numero: SEMAINE,
    });
    const parModule = Object.fromEntries(taches.map((t) => [t.module, t]));
    expect(parModule.M1).toMatchObject({ periode: PERIODES.SOIR, seancesRequises: 2, cds: true });
    expect(parModule.M2).toMatchObject({ periode: PERIODES.JOUR, seancesRequises: 2, cds: true });
  });

  it('une cellule de 10 h suit les autres cellules du groupe', () => {
    const auSoir = tachesDeLaSemaine({
      chronogrammes: [chronoCds({ M1: 10, M2: 4 })],
      affectations: [affectation('M1'), affectation('M2', '200')],
      numero: SEMAINE,
    }).taches.find((t) => t.module === 'M1');
    expect(auSoir).toMatchObject({ periode: PERIODES.SOIR, seancesRequises: 5 });

    const auJour = tachesDeLaSemaine({
      chronogrammes: [chronoCds({ M1: 10, M2: 5 })],
      affectations: [affectation('M1'), affectation('M2', '200')],
      numero: SEMAINE,
    }).taches.find((t) => t.module === 'M1');
    expect(auJour).toMatchObject({ periode: PERIODES.JOUR, seancesRequises: 4 });
  });
});

describe('construireProbleme — créneaux du soir et de secours', () => {
  const tacheCds = (periode, extra = {}) => ({
    id: `T-${periode}`,
    formateurMatricule: '100',
    groupeLibelle: CDS,
    groupes: [CDS],
    module: 'M1',
    type: P,
    seancesRequises: 2,
    priorite: 3,
    periode,
    cds: true,
    ...extra,
  });

  it('sans tâche du soir, aucun créneau du soir : le problème d’avant', () => {
    const { probleme } = problemeDe([tacheCds(PERIODES.JOUR, { cds: false })]);
    expect(probleme.creneaux.some((c) => c.periode === PERIODES.SOIR)).toBe(false);
    expect(probleme.taches[0].creneauxSecours).toEqual([]);
  });

  it('une tâche du soir n’a que les soirées, le samedi soir en secours', () => {
    const { probleme, creneauVersCase } = problemeDe([tacheCds(PERIODES.SOIR)]);
    const soirs = probleme.creneaux.filter((c) => c.periode === PERIODES.SOIR);
    expect(soirs).toHaveLength(6);
    expect(soirs.every((c) => c.duree === 2)).toBe(true);

    const [tache] = probleme.taches;
    const libres = probleme.creneaux.filter((c) => !tache.creneauxInterdits.includes(c.id));
    expect(libres.map((c) => c.id).sort()).toEqual(soirs.map((c) => c.id).sort());

    const samediSoir = soirs.find((c) => c.jour === 'Samedi');
    expect(tache.creneauxSecours).toEqual([samediSoir.id]);
    expect(creneauVersCase.get(samediSoir.id)).toEqual({
      jour: 'Samedi',
      seance: 'S5',
      periode: PERIODES.SOIR,
    });
  });

  it('un cours de jour CDS préfère le samedi : la semaine est en secours', () => {
    const { probleme } = problemeDe([tacheCds(PERIODES.JOUR), tacheCds(PERIODES.SOIR)]);
    const jour = probleme.taches.find((t) => t.periode === PERIODES.JOUR);
    const parId = new Map(probleme.creneaux.map((c) => [c.id, c]));

    expect(jour.creneauxSecours.every((id) => parId.get(id).jour !== 'Samedi')).toBe(true);
    expect(jour.creneauxSecours).toHaveLength(20); // 5 jours × 4 créneaux
    // Le soir lui est fermé.
    for (const c of probleme.creneaux.filter((c) => c.periode === PERIODES.SOIR)) {
      expect(jour.creneauxInterdits).toContain(c.id);
    }
  });

  it('une séance du soir conservée occupe son soir', () => {
    const { probleme } = problemeDe([tacheCds(PERIODES.SOIR)], {
      aPreserver: [
        {
          jour: 'Mardi',
          seance: 'S5',
          periode: PERIODES.SOIR,
          formateurMatricule: '300',
          groupe: 'AUTRE (CDS)',
          salle: 'Salle 1',
        },
      ],
    });
    const mardiSoir = probleme.creneaux.find(
      (c) => c.jour === 'Mardi' && c.periode === PERIODES.SOIR
    );
    expect(probleme.occupation).toContainEqual(
      expect.objectContaining({ creneauId: mardiSoir.id, formateur: '300' })
    );
  });
});

const pythonDisponible = (() => {
  try {
    return spawnSync(process.env.PYTHON_BIN ?? 'python', ['--version']).status === 0;
  } catch {
    return false;
  }
})();

const avecPython = pythonDisponible ? describe : describe.skip;

avecPython('le solveur réel — cours du soir', () => {
  it('soir en semaine avant le samedi, jour CDS le samedi', async () => {
    const { taches } = tachesDeLaSemaine({
      chronogrammes: [chronoCds({ M1: 4, M2: 5 })],
      affectations: [affectation('M1'), affectation('M2', '200')],
      numero: SEMAINE,
    });
    const { probleme, index, creneauVersCase } = problemeDe(taches);
    const solution = await resoudre(probleme);

    expect(solution.nonPlacees).toEqual([]);
    const cases = solution.placements.map((p) => ({
      module: index.get(p.tacheId).module,
      ...creneauVersCase.get(p.creneauId),
      deconseille: p.deconseille,
    }));

    const soir = cases.filter((c) => c.module === 'M1');
    expect(soir).toHaveLength(2);
    expect(soir.every((c) => c.periode === PERIODES.SOIR && c.jour !== 'Samedi')).toBe(true);

    const jour = cases.filter((c) => c.module === 'M2');
    expect(jour).toHaveLength(2);
    expect(jour.every((c) => c.periode === PERIODES.JOUR && c.jour === 'Samedi')).toBe(true);

    // Un secours n'est pas une indisponibilité.
    expect(cases.some((c) => c.deconseille)).toBe(false);
  });
});
