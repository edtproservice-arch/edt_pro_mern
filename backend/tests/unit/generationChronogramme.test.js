/**
 * Génération du chronogramme : ce que Node envoie au solveur, et ce qu'il fait
 * de sa réponse (2026-10-04).
 *
 * Les règles elles-mêmes (priorité, cibles, −5 h par jour) sont testées dans
 * `shared` ; ici on vérifie qu'elles sont APPLIQUÉES aux bonnes données : la
 * bonne semaine, le bon formateur, le bon groupe.
 */

import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { semainesChronogramme } from 'shared/domain';
import { TYPES_COURS } from 'shared/constants';

import {
  assemblerSolution,
  construireProblemeChronogramme,
} from '../../src/modules/chronogramme/generation.service.js';
import { resoudreChronogramme } from '../../src/modules/generation/solveur.client.js';

const ANNEE = 2026;
const P = TYPES_COURS.PRESENTIEL;
const S = TYPES_COURS.SYNCHRONE;

const pythonDisponible = (() => {
  try {
    return spawnSync(process.env.PYTHON_BIN ?? 'python', ['--version']).status === 0;
  } catch {
    return false;
  }
})();

/** Le numéro de la semaine qui contient cette date. */
const semaineDu = (date) =>
  semainesChronogramme(ANNEE, {}).find((s) => s.debut <= date && date <= s.fin).numero;

const affectation = (formateur, groupe, module, type, s1, s2 = 0, estRegional = false) => ({
  formateur,
  groupe,
  module,
  type,
  s1Heures: s1,
  s2Heures: s2,
  estRegional,
});

function base(affectations, groupes = ['GM101', 'GM102']) {
  return {
    groupes,
    formateurs: [
      { matricule: '100', nomComplet: 'AMINA PLEIN', masseHoraire: 1000 },
      { matricule: '200', nomComplet: 'KARIM VACATAIRE', masseHoraire: 300 },
    ],
    affectations,
  };
}

const construire = (affectations, donnees = {}, options = {}) =>
  construireProblemeChronogramme(ANNEE, { base: base(affectations), ...donnees }, options);

const tacheDe = (probleme, debut) => probleme.taches.find((t) => t.id.startsWith(debut));

describe('les tâches', () => {
  it('présentiel fusionné : une tâche PAR groupe — le cours est donné à chacun', () => {
    const { probleme } = construire([affectation('100', 'GM101 GM102', 'M101', P, 60)]);
    expect(probleme.taches.map((t) => t.groupes)).toEqual([['GM101'], ['GM102']]);
  });

  it('synchrone fusionné : UNE tâche pour l’ensemble — donnée une seule fois', () => {
    const { probleme, cibles } = construire([affectation('100', 'GM101 GM102', 'M101', S, 60)]);
    expect(probleme.taches).toHaveLength(1);
    expect(probleme.taches[0].groupes).toEqual(['GM101', 'GM102']);
    expect(probleme.taches[0].cellules).toEqual(['GM101||M101', 'GM102||M101']);
    expect(cibles.get('100').masseAffectee).toBe(60);
  });

  it('ignore un groupe absent de la base', () => {
    const { probleme } = construire([affectation('100', 'FANTOME', 'M101', P, 60)]);
    expect(probleme.taches).toEqual([]);
  });
});

describe('le synchrone, encadré par le présentiel du module', () => {
  it('la tâche synchrone nomme les présentiels du même module dans ses groupes', () => {
    const { probleme } = construire([
      affectation('100', 'GM101', 'M101', P, 60),
      affectation('100', 'GM102', 'M101', P, 60),
      affectation('200', 'GM101 GM102', 'M101', S, 20),
      affectation('100', 'GM101', 'M102', P, 60),
    ]);
    const synchrone = probleme.taches.find((t) => t.id.endsWith('|S'));
    expect(synchrone.encadreePar).toEqual(['100|GM101|M101|P', '100|GM102|M101|P']);
    expect(probleme.taches.filter((t) => t.encadreePar)).toHaveLength(1);
  });

  it('un module tout à distance n’a pas d’encadrante', () => {
    const { probleme } = construire([affectation('200', 'GM101', 'M101', S, 20)]);
    expect(probleme.taches[0].encadreePar).toBeUndefined();
  });
});

describe('règle A — la priorité', () => {
  it('régional S1 = 1, normal S2 = 6', () => {
    const { probleme } = construire([
      affectation('100', 'GM101', 'M101', P, 60, 0, true),
      affectation('100', 'GM101', 'M102', P, 0, 60),
    ]);
    expect(tacheDe(probleme, '100|GM101|M101').priorite).toBe(1);
    expect(tacheDe(probleme, '100|GM101|M102').priorite).toBe(6);
  });

  it('le semestre se lit sur le MODULE, tous types confondus', () => {
    // Présentiel au S1, synchrone au S2 : le module est annuel pour les deux.
    const { probleme } = construire([
      affectation('100', 'GM101', 'M101', P, 30),
      affectation('200', 'GM101', 'M101', S, 0, 30),
    ]);
    expect(probleme.taches.map((t) => t.priorite)).toEqual([5, 5]);
  });
});

describe('la réserve des modules régionaux', () => {
  it('laisse 2,5 h non planifiées sur le présentiel, au S2 d’un module annuel', () => {
    const { probleme, reserveRegionale } = construire([
      affectation('100', 'GM101', 'M101', P, 40, 40, true),
      affectation('200', 'GM101', 'M101', S, 10, 10),
    ]);
    const presentiel = tacheDe(probleme, '100|GM101|M101|P');
    const synchrone = tacheDe(probleme, '200|GM101|M101|S');
    expect(presentiel.lots.map((l) => l.heures)).toEqual([40, 37.5]);
    expect(synchrone.lots.map((l) => l.heures)).toEqual([10, 10]);
    expect(reserveRegionale).toBe(2.5);
  });

  it('une fois par groupe, et rien pour un module normal', () => {
    const { probleme, reserveRegionale } = construire([
      affectation('100', 'GM101 GM102', 'M101', P, 60, 0, true),
      affectation('100', 'GM101', 'M102', P, 60),
    ]);
    expect(tacheDe(probleme, '100|GM101|M101').lots[0].heures).toBe(57.5);
    expect(tacheDe(probleme, '100|GM102|M101').lots[0].heures).toBe(57.5);
    expect(tacheDe(probleme, '100|GM101|M102').lots[0].heures).toBe(60);
    expect(reserveRegionale).toBe(5);
  });

  it('sur le synchrone quand le module n’a pas de présentiel', () => {
    const { probleme } = construire([affectation('200', 'GM101', 'M101', S, 20, 0, true)]);
    expect(probleme.taches[0].lots[0].heures).toBe(17.5);
  });
});

describe('le module « Métier et formation »', () => {
  const intitules = new Map([['GM101||M101', 'Métier et formation']]);

  it('ne s’ouvre que les deux premières semaines, servi avant tout le reste', () => {
    const { probleme } = construire([affectation('100', 'GM101', 'M101', P, 30)], { intitules });
    const [tache] = probleme.taches;
    expect(tache.priorite).toBe(0);
    expect(tache.lots).toHaveLength(1);
    expect(Object.keys(tache.lots[0].plafonds).map(Number)).toEqual([1, 2]);
    // 30 h en deux semaines : la règle « une journée » ne peut pas tenir.
    expect(tache.lots[0].plafonds[2]).toBe(15);
  });

  it('suit la rentrée du groupe plutôt que S1 dans l’absolu', () => {
    const { probleme } = construire([affectation('100', 'GM101', 'M101', P, 15)], {
      intitules,
      stages: [{ groupe: 'GM101', debut: '2026-08-31', fin: '2026-09-05' }],
    });
    expect(Object.keys(probleme.taches[0].lots[0].plafonds).map(Number)).toEqual([2, 3]);
  });

  it('un autre module reste à la règle commune', () => {
    const { probleme } = construire([affectation('100', 'GM101', 'M102', P, 30)], { intitules });
    expect(probleme.taches[0].priorite).toBe(4);
  });
});

describe('les lots et leurs fenêtres', () => {
  it('un module annuel donne deux lots : le S1 vise la S17 mais peut déborder, le S2 ne remonte pas', () => {
    const { probleme } = construire([affectation('100', 'GM101', 'M101', P, 40, 60)]);
    const [s1, s2] = probleme.taches[0].lots;
    expect(s1).toMatchObject({ heures: 40, echeance: 17 });
    expect(Math.max(...Object.keys(s1.plafonds).map(Number))).toBeGreaterThan(17);
    expect(s2.heures).toBe(60);
    expect(s2.echeance).toBeUndefined();
    expect(Math.min(...Object.keys(s2.plafonds).map(Number))).toBeGreaterThanOrEqual(18);
  });

  it('un module ne prend pas plus d’une journée (10 h) par semaine', () => {
    const { probleme } = construire([affectation('100', 'GM101', 'M101', P, 140)]);
    expect(Math.max(...Object.values(probleme.taches[0].lots[0].plafonds))).toBe(10);
  });

  it('sauf si sa masse l’exige pour tenir dans son semestre', () => {
    const { probleme } = construire([affectation('100', 'GM101', 'M101', P, 200)]);
    expect(Math.max(...Object.values(probleme.taches[0].lots[0].plafonds))).toBeGreaterThan(10);
  });

  it('une semaine de stage complète ferme la ligne du groupe', () => {
    const stage = { groupe: 'GM101', debut: '2026-11-16', fin: '2026-11-21' };
    const { probleme } = construire([affectation('100', 'GM101', 'M101', P, 60)], { stages: [stage] });
    expect(probleme.taches[0].lots[0].plafonds[semaineDu('2026-11-18')]).toBeUndefined();
  });
});

describe('fin de formation (2026-10-04)', () => {
  const derniere = (probleme) =>
    Math.max(...probleme.taches.flatMap((t) => t.lots.flatMap((l) => Object.keys(l.plafonds).map(Number))));

  it('rien après la S42 en 1ʳᵉ année, la S41 en 2ᵉ', () => {
    const premiere = construireProblemeChronogramme(ANNEE, {
      base: base([affectation('100', 'GM101', 'M101', P, 30, 30)]),
    }).probleme;
    const deuxieme = construireProblemeChronogramme(ANNEE, {
      base: base([affectation('100', 'GM201', 'M101', P, 30, 30)], ['GM201']),
    }).probleme;
    expect(derniere(premiere)).toBe(42);
    expect(derniere(deuxieme)).toBe(41);
  });

  it('rien après la S18 en 3ᵉ année cours du jour — mais pas de borne en cours du soir', () => {
    const cdj = construireProblemeChronogramme(ANNEE, {
      base: base([affectation('100', 'GM301', 'M101', P, 60)], ['GM301']),
    });
    expect(derniere(cdj.probleme)).toBe(18);
    // Au-delà, le groupe ne compte plus dans la cible du formateur.
    expect(cdj.cibles.get('100').parSemaine[19]).toBeUndefined();

    const cds = construireProblemeChronogramme(ANNEE, {
      base: base([affectation('100', 'GM301 (CDS)', 'M101', P, 60)], ['GM301 (CDS)']),
    });
    expect(derniere(cds.probleme)).toBe(45);
  });
});

describe('règles B, C et D — la cible de chaque semaine', () => {
  it('B : 600 h affectées → 25 h, pas 17 h', () => {
    const { cibles } = construire([affectation('100', 'GM101', 'M101', P, 300, 300)]);
    expect(cibles.get('100').cibleHebdomadaire).toBe(25);
  });

  it('C : 300 h affectées → 300 / 35, sans plancher', () => {
    const { cibles } = construire([affectation('200', 'GM101', 'M101', P, 150, 150)]);
    expect(cibles.get('200').cibleHebdomadaire).toBeCloseTo(8.57, 2);
  });

  it('au-delà de 900 h, 25 h minimum même avec deux fériés', () => {
    const { cibles } = construire([affectation('100', 'GM101', 'M101', P, 500, 553)], {
      joursFeries: [{ date: '2026-11-05' }, { date: '2026-11-06' }],
    });
    expect(cibles.get('100').parSemaine[semaineDu('2026-11-06')]).toBe(25);
  });

  it('entre 360 h et 900 h, 10 h minimum même avec trois jours de formation et un férié', () => {
    const { cibles } = construire([affectation('100', 'GM101', 'M101', P, 300, 300)], {
      joursFeries: [{ date: '2026-11-13' }],
      formations: [{ matriculeFormateur: '100', debut: '2026-11-09', fin: '2026-11-11' }],
    });
    // 25 h − 4 jours × 5 h = 5 h : remonté à 10 h.
    expect(cibles.get('100').parSemaine[semaineDu('2026-11-10')]).toBe(10);
  });

  it('D : −5 h par jour férié', () => {
    const { cibles } = construire([affectation('100', 'GM101', 'M101', P, 300, 300)], {
      joursFeries: [{ date: '2026-11-06' }],
    });
    expect(cibles.get('100').parSemaine[semaineDu('2026-11-06')]).toBe(20);
    expect(cibles.get('100').parSemaine[semaineDu('2026-11-13')]).toBe(25);
  });

  it('D : −5 h par jour de formation du formateur', () => {
    const { cibles } = construire([affectation('100', 'GM101', 'M101', P, 300, 300)], {
      formations: [{ matriculeFormateur: '100', debut: '2026-11-09', fin: '2026-11-11' }],
    });
    expect(cibles.get('100').parSemaine[semaineDu('2026-11-10')]).toBe(10);
  });

  it('D : −5 h par jour de stage PARTIEL d’un de ses groupes', () => {
    const { cibles } = construire(
      [affectation('100', 'GM101', 'M101', P, 150, 150), affectation('100', 'GM102', 'M101', P, 150, 150)],
      { stages: [{ groupe: 'GM101', debut: '2026-11-16', fin: '2026-11-17' }] }
    );
    expect(cibles.get('100').parSemaine[semaineDu('2026-11-16')]).toBe(15);
  });

  it('D : un groupe ENTIÈREMENT en stage ne réduit pas la cible — ses autres groupes sont là', () => {
    const { cibles } = construire(
      [affectation('100', 'GM101', 'M101', P, 150, 150), affectation('100', 'GM102', 'M101', P, 150, 150)],
      { stages: [{ groupe: 'GM101', debut: '2026-11-16', fin: '2026-11-21' }] }
    );
    expect(cibles.get('100').parSemaine[semaineDu('2026-11-16')]).toBe(25);
  });

  it('D : −5 h par jour avant la rentrée des premières années', () => {
    const { cibles } = construire([affectation('100', 'GM101', 'M101', P, 300, 300)], {
      rentrees: [
        { anneeFormation: 1, date: '2026-09-11' },
        { anneeFormation: 2, date: '2026-09-07' },
      ],
    });
    // GM101 est une 1ʳᵉ année : rentrée le vendredi, quatre jours perdus —
    // 25 h − 20 h = 5 h, remontées au minimum de 10 h (600 h affectées).
    const semaine = semainesChronogramme(ANNEE, {
      rentrees: [
        { anneeFormation: 1, date: '2026-09-11' },
        { anneeFormation: 2, date: '2026-09-07' },
      ],
    }).find((s) => s.debut <= '2026-09-11' && '2026-09-11' <= s.fin).numero;
    expect(cibles.get('100').parSemaine[semaine]).toBe(10);
  });

  it('aucune cible en vacances', () => {
    const { cibles } = construire([affectation('100', 'GM101', 'M101', P, 300, 300)], {
      vacances: [{ debut: '2026-11-02', fin: '2026-11-08' }],
    });
    expect(cibles.get('100').parSemaine[semaineDu('2026-11-04')]).toBeUndefined();
  });
});

describe('les modes', () => {
  const plannings = {
    GM101: {
      M101: { 3: { heures: 10, type: 'P' } },
      // Module sans affectation : jamais touché.
      M999: { 3: { heures: 5, type: 'P' } },
    },
  };

  it('remplacer : refait les modules affectés, garde les autres', () => {
    const construit = construire([affectation('100', 'GM101', 'M101', P, 60)], { plannings });
    expect(construit.partsRemplacees).toBe(1);
    expect(construit.conserves.GM101).toEqual({ M999: { 3: { P: 5, S: 0 } } });
    expect(construit.probleme.taches[0].lots[0].heures).toBe(60);
    expect(construit.probleme.groupes[0].charges).toEqual({ 3: 5 });
  });

  it('compléter : ne répartit que ce qui manque, autour de l’existant', () => {
    const construit = construire([affectation('100', 'GM101', 'M101', P, 60)], { plannings }, { mode: 'completer' });
    expect(construit.partsRemplacees).toBe(0);
    const [lot] = construit.probleme.taches[0].lots;
    expect(lot.heures).toBe(50);
    // Le module a déjà sa journée (10 h) en S3 : la semaine est pleine pour lui.
    expect(lot.plafonds[3]).toBeUndefined();
    expect(lot.plafonds[4]).toBe(10);
    expect(construit.probleme.formateurs[0].charges).toEqual({ 3: 10 });
  });
});

describe('le contrôle de la réponse', () => {
  const construit = () => construire([affectation('100', 'GM101', 'M101', P, 60)]);

  it('assemble les poses dans le planning du groupe', () => {
    const plannings = assemblerSolution(construit(), {
      poses: [{ tacheId: '100|GM101|M101|P', lot: 0, semaine: 3, heures: 10 }],
    });
    expect(plannings.GM101.M101[3]).toEqual({ heures: 10, type: 'P' });
  });

  it('refuse une pose hors pas', () => {
    expect(() =>
      assemblerSolution(construit(), { poses: [{ tacheId: '100|GM101|M101|P', lot: 0, semaine: 3, heures: 3 }] })
    ).toThrow(/incohérente/);
  });

  it('refuse une pose au-delà du plafond', () => {
    expect(() =>
      assemblerSolution(construit(), { poses: [{ tacheId: '100|GM101|M101|P', lot: 0, semaine: 3, heures: 25 }] })
    ).toThrow(/incohérente/);
  });

  it('refuse plus d’heures que la masse', () => {
    const poses = [3, 4, 5, 6, 7, 8, 9].map((semaine) => ({ tacheId: '100|GM101|M101|P', lot: 0, semaine, heures: 10 }));
    expect(() => assemblerSolution(construit(), { poses })).toThrow(/incohérente/);
  });

  it('refuse une tâche inconnue', () => {
    expect(() =>
      assemblerSolution(construit(), { poses: [{ tacheId: 'X', lot: 0, semaine: 3, heures: 5 }] })
    ).toThrow(/incohérente/);
  });
});

(pythonDisponible ? describe : describe.skip)('aller-retour avec le vrai solveur', () => {
  it('pose toute la masse, régional d’abord, sans franchir un plafond', async () => {
    const construit = construire([
      affectation('100', 'GM101', 'M101', P, 120, 0, true),
      affectation('100', 'GM101', 'M102', P, 120),
      affectation('100', 'GM102', 'M201', P, 200, 200),
      affectation('100', 'GM101 GM102', 'M301', S, 50, 50),
    ]);
    const solution = await resoudreChronogramme(construit.probleme);
    const plannings = assemblerSolution(construit, solution);

    expect(solution.nonPoses).toEqual([]);
    const total = (groupe, module) =>
      Object.values(plannings[groupe][module]).reduce((s, c) => s + c.heures, 0);
    // M101 est régional : 2,5 h laissées en réserve.
    expect(total('GM101', 'M101')).toBe(117.5);
    expect(total('GM101', 'M301')).toBe(100);
    expect(total('GM102', 'M301')).toBe(100);

    // Le régional ne finit jamais APRÈS le module normal du même semestre.
    const fin = (groupe, module) => Math.max(...Object.keys(plannings[groupe][module]).map(Number));
    expect(fin('GM101', 'M101')).toBeLessThanOrEqual(fin('GM101', 'M102'));

    // ⚠️ Aucun module condensé : une journée (10 h) par semaine au plus.
    for (const module of ['M101', 'M102']) {
      for (const cellule of Object.values(plannings.GM101[module])) {
        expect(cellule.heures).toBeLessThanOrEqual(10);
      }
    }
  });

  it('« Métier et formation » posé en S1–S2, même chez un formateur chargé', async () => {
    const construit = construire(
      [
        affectation('100', 'GM101', 'M101', P, 20),
        affectation('100', 'GM101', 'M102', P, 300, 0, true),
        affectation('100', 'GM102', 'M201', P, 300),
      ],
      { intitules: new Map([['GM101||M101', 'Métier et formation']]) }
    );
    const solution = await resoudreChronogramme(construit.probleme);
    const plannings = assemblerSolution(construit, solution);
    const semaines = Object.keys(plannings.GM101.M101).map(Number);
    expect(Math.max(...semaines)).toBeLessThanOrEqual(2);
    expect(Object.values(plannings.GM101.M101).reduce((s, c) => s + c.heures, 0)).toBe(20);
  });

  it('⚠️ le synchrone ne tombe ni à la première ni à la dernière semaine du présentiel', async () => {
    const construit = construire([
      affectation('100', 'GM101', 'M101', P, 60),
      affectation('100', 'GM101', 'M101', S, 20),
      affectation('100', 'GM101', 'M102', P, 120),
    ]);
    const solution = await resoudreChronogramme(construit.probleme);
    const plannings = assemblerSolution(construit, solution);
    expect(solution.nonPoses).toEqual([]);

    const semaines = (type) =>
      Object.entries(plannings.GM101.M101)
        .filter(([, cellule]) => cellule.type === type || cellule.type === 'PS')
        .map(([numero]) => Number(numero));
    const presentiel = semaines('P');
    for (const semaine of semaines('S')) {
      expect(semaine).toBeGreaterThan(Math.min(...presentiel));
      expect(semaine).toBeLessThan(Math.max(...presentiel));
    }
  });

  it('⚠️ ne surcharge JAMAIS un formateur pour tenir la fin du S1 — le surplus passe au S2', async () => {
    // Retour du porteur (2026-10-04) : 600 h au S1 pour 25 h par semaine ne
    // tiennent pas dans ~16 semaines. La première version posait 50 h par
    // semaine ; on veut 25 h (± un créneau) et un report signalé.
    const construit = construire([
      affectation('100', 'GM101', 'M101', P, 300),
      affectation('100', 'GM102', 'M201', P, 300),
    ]);
    const solution = await resoudreChronogramme(construit.probleme);
    const cible = construit.cibles.get('100');

    const parSemaine = {};
    for (const pose of solution.poses) parSemaine[pose.semaine] = (parSemaine[pose.semaine] ?? 0) + pose.heures;
    for (const [semaine, heures] of Object.entries(parSemaine)) {
      expect(heures, `S${semaine}`).toBeLessThanOrEqual((cible.parSemaine[semaine] ?? 0) + 2.5);
    }
    expect(solution.rapport.heuresApresEcheance).toBeGreaterThan(0);
    expect(solution.nonPoses).toEqual([]);
  });
});
