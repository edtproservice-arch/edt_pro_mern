import { describe, expect, it } from 'vitest';

import { heuresPoseesParSemaine, reporterVersChronogramme } from './report.js';

/** Une séance de la grille. `salle: 'TEAMS'` la rend synchrone. */
const seance = (extra = {}) => ({
  semaine: '2026-W9',
  groupe: 'GM101',
  module: 'M101',
  seance: 'S1',
  salle: 'A12',
  statut: 'planifie',
  ...extra,
});

/** Un chronogramme existant. */
const chrono = (groupe, cellules = {}) => ({
  groupe,
  planning: new Map(Object.entries(cellules)),
});

/** La cellule d'un module, pour une semaine donnée, dans le résultat. */
const cellule = (resultat, groupe, module, semaine) =>
  resultat.aEcrire
    .find((p) => p.groupe === groupe)
    ?.planning.get(module)
    ?.find((c) => c.semaine === semaine);

describe('heuresPoseesParSemaine', () => {
  it('compte 2,5 h en journée et 2 h le soir', () => {
    const { parSemaine } = heuresPoseesParSemaine([
      seance(),
      seance({ seance: 'S5', periode: 'soir' }),
    ]);
    expect(parSemaine.get(9).get('GM101').get('M101')).toEqual({ P: 4.5, S: 0 });
  });

  it('⚠️ une séance ABSENTE est COMPTÉE — elle est planifiée, pas donnée', () => {
    // La retirer creuserait un trou dans le chronogramme, alors que son
    // rattrapage se traite ailleurs.
    const { parSemaine } = heuresPoseesParSemaine([seance({ statut: 'absent' })]);
    expect(parSemaine.get(9).get('GM101').get('M101').P).toBe(2.5);
  });

  it('⚠️ une FUSION compte pour chacun de ses groupes', () => {
    const { parSemaine } = heuresPoseesParSemaine([seance({ groupe: 'GM101 GM102' })]);
    expect(parSemaine.get(9).get('GM101').get('M101').P).toBe(2.5);
    expect(parSemaine.get(9).get('GM102').get('M101').P).toBe(2.5);
  });

  it('sépare le présentiel du distanciel', () => {
    const { parSemaine } = heuresPoseesParSemaine([seance(), seance({ salle: 'TEAMS' })]);
    expect(parSemaine.get(9).get('GM101').get('M101')).toEqual({ P: 2.5, S: 2.5 });
  });

  it('⚠️ tolère « 2026-W009 » — la production en contient', () => {
    const { parSemaine } = heuresPoseesParSemaine([seance({ semaine: '2026-W009' })]);
    expect(parSemaine.has(9)).toBe(true);
  });
});

describe('reporterVersChronogramme', () => {
  it('écrit la cellule que la grille porte', () => {
    const r = reporterVersChronogramme({
      seances: [seance(), seance({ seance: 'S2' })],
      chronogrammes: [chrono('GM101')],
    });

    expect(cellule(r, 'GM101', 'M101', 'S9')).toEqual({ semaine: 'S9', heures: 5, type: 'P' });
    expect(r.bilan.cellulesEcrites).toBe(1);
    expect(r.bilan.heures).toBe(5);
  });

  it('⚠️ N’EFFACE RIEN — les semaines et les modules que la grille ne porte pas restent', () => {
    /*
     * Un chronogramme planifié sur 45 semaines dont l'emploi ne couvre que 4 ne
     * doit pas perdre les 41 autres, et un module prévu mais pas encore posé
     * garde sa prévision. C'est le rapport de complétude qui montre l'écart.
     */
    const r = reporterVersChronogramme({
      seances: [seance()],
      chronogrammes: [
        chrono('GM101', {
          M101: [
            { semaine: 'S9', heures: 10, type: 'P' },
            { semaine: 'S10', heures: 7.5, type: 'P' },
          ],
          M102: [{ semaine: 'S9', heures: 5, type: 'P' }],
        }),
      ],
    });

    expect(cellule(r, 'GM101', 'M101', 'S9').heures).toBe(2.5);
    expect(cellule(r, 'GM101', 'M101', 'S10').heures).toBe(7.5);
    expect(cellule(r, 'GM101', 'M102', 'S9').heures).toBe(5);
  });

  it('⚠️ EST REJOUABLE : relancé sur son propre résultat, il ne change plus rien', () => {
    /*
     * REMPLACER plutôt qu'AJOUTER. Additionner doublerait les heures au second
     * passage, sans que rien ne le signale.
     */
    const seances = [seance(), seance({ seance: 'S2' })];
    const premier = reporterVersChronogramme({ seances, chronogrammes: [chrono('GM101')] });

    const second = reporterVersChronogramme({
      seances,
      chronogrammes: premier.aEcrire.map((p) => ({ groupe: p.groupe, planning: p.planning })),
    });

    expect(second.bilan.cellulesEcrites).toBe(0);
    expect(second.bilan.cellulesInchangees).toBe(1);
    expect(second.aEcrire).toEqual([]);
  });

  it('⚠️ CRÉE un chronogramme au groupe qui n’en a pas, et le NOMME', () => {
    // L'ignorer ferait disparaître ses séances du report sans un mot — alors
    // que ce sont justement celles qu'on vient chercher.
    const r = reporterVersChronogramme({ seances: [seance()], chronogrammes: [] });

    expect(r.bilan.groupesCrees).toEqual(['GM101']);
    expect(cellule(r, 'GM101', 'M101', 'S9').heures).toBe(2.5);
  });

  it('⚠️ PRÉSENTIEL ET DISTANCIEL LA MÊME SEMAINE : une entrée PAR TYPE (2026-10-01)', () => {
    /*
     * Le « type dominant » d'avant faisait passer 2,5 h de distanciel pour du
     * présentiel. La case mixte les garde chacun sous son type.
     */
    const r = reporterVersChronogramme({
      seances: [seance(), seance({ seance: 'S2' }), seance({ seance: 'S3', salle: 'TEAMS' })],
      chronogrammes: [],
    });

    const entrees = r.aEcrire[0].planning.get('M101').filter((c) => c.semaine === 'S9');
    expect(entrees).toEqual([
      { semaine: 'S9', heures: 5, type: 'P' },
      { semaine: 'S9', heures: 2.5, type: 'S' },
    ]);
    expect(r.bilan.mixtes).toEqual([]);
  });

  it('une semaine déjà mixte et identique n’est pas réécrite', () => {
    const r = reporterVersChronogramme({
      seances: [seance(), seance({ seance: 'S3', salle: 'TEAMS' })],
      chronogrammes: [
        chrono('GM101', {
          M101: [
            { semaine: 'S9', heures: 2.5, type: 'S' },
            { semaine: 'S9', heures: 2.5, type: 'P' },
          ],
        }),
      ],
    });

    expect(r.aEcrire).toEqual([]);
    expect(r.bilan.cellulesInchangees).toBe(1);
  });

  it('⚠️ NE REND QUE LES GROUPES TOUCHÉS', () => {
    /*
     * Réécrire les autres à l'identique remuerait leur horodatage et, ici,
     * avancerait leur `version` — ce qui ferait échouer l'enregistrement d'un
     * collègue dont l'écran tenait la précédente.
     */
    const r = reporterVersChronogramme({
      seances: [seance()],
      chronogrammes: [chrono('GM101'), chrono('GM102', { M200: [{ semaine: 'S1', heures: 5, type: 'P' }] })],
    });

    expect(r.aEcrire.map((p) => p.groupe)).toEqual(['GM101']);
  });

  it('⚠️ NE MODIFIE PAS ses entrées', () => {
    const depart = chrono('GM101', { M101: [{ semaine: 'S9', heures: 10, type: 'P' }] });
    reporterVersChronogramme({ seances: [seance()], chronogrammes: [depart] });

    expect(depart.planning.get('M101')[0].heures).toBe(10);
  });

  it('rend un bilan lisible même sans aucune séance', () => {
    const r = reporterVersChronogramme({ seances: [], chronogrammes: [chrono('GM101')] });

    expect(r.aEcrire).toEqual([]);
    expect(r.bilan).toMatchObject({
      semainesLues: 0,
      seancesLues: 0,
      cellulesEcrites: 0,
      heures: 0,
      groupes: [],
      mixtes: [],
    });
  });

  it('⚠️ rend le MÊME bilan à chaque exécution — l’ordre est fixé', () => {
    // Deux exécutions doivent rendre la même liste, pas seulement le même
    // ensemble : sinon le chiffre annoncé en simulation ne serait pas celui
    // qu'on confirme.
    const entrees = {
      seances: [seance({ groupe: 'GM102' }), seance(), seance({ module: 'M102' })],
      chronogrammes: [],
    };
    expect(reporterVersChronogramme(entrees).bilan).toEqual(
      reporterVersChronogramme(entrees).bilan
    );
  });
});

describe('reporterVersChronogramme — la masse horaire (2026-09-27)', () => {
  /** `fichesModules` : `GROUPE||MODULE` → heures par type. */
  const masses = (presentiel, synchrone = 0) =>
    new Map([['GM101||M101', { presentiel, synchrone }]]);

  it('reporte tant que la masse n’est pas dépassée', () => {
    const r = reporterVersChronogramme({
      seances: [seance()],
      chronogrammes: [chrono('GM101', { M101: [{ semaine: 'S8', heures: 5, type: 'P' }] })],
      masses: masses(7.5),
    });
    expect(cellule(r, 'GM101', 'M101', 'S9')).toEqual({ semaine: 'S9', heures: 2.5, type: 'P' });
    expect(r.bilan.depassements).toEqual([]);
  });

  it('⚠️ ne reporte PAS la cellule qui dépasserait, et la nomme', () => {
    const r = reporterVersChronogramme({
      seances: [seance(), seance({ seance: 'S2' })],
      chronogrammes: [chrono('GM101', { M101: [{ semaine: 'S8', heures: 5, type: 'P' }] })],
      masses: masses(7.5),
    });
    expect(r.aEcrire).toEqual([]);
    expect(r.bilan.cellulesEcrites).toBe(0);
    expect(r.bilan.depassements).toEqual([
      { groupe: 'GM101', module: 'M101', semaine: 'S9', type: 'P', heures: 5, dejaPlanifie: 5, masse: 7.5 },
    ]);
  });

  it('garde la cellule déjà planifiée quand la nouvelle dépasserait', () => {
    const r = reporterVersChronogramme({
      seances: [seance(), seance({ seance: 'S2' }), seance({ seance: 'S3' })],
      chronogrammes: [
        chrono('GM101', {
          M101: [
            { semaine: 'S8', heures: 5, type: 'P' },
            { semaine: 'S9', heures: 2.5, type: 'P' },
          ],
        }),
      ],
      masses: masses(10),
    });
    // 5 (S8) + 7,5 (S9 reportée) = 12,5 > 10 : la S9 reste à 2,5 h.
    expect(r.aEcrire).toEqual([]);
    expect(r.bilan.depassements).toHaveLength(1);
  });

  it('remplace la cellule de la semaine sans la compter deux fois', () => {
    const r = reporterVersChronogramme({
      seances: [seance(), seance({ seance: 'S2' })],
      chronogrammes: [chrono('GM101', { M101: [{ semaine: 'S9', heures: 2.5, type: 'P' }] })],
      masses: masses(5),
    });
    expect(cellule(r, 'GM101', 'M101', 'S9')).toEqual({ semaine: 'S9', heures: 5, type: 'P' });
  });

  it('les semaines dans l’ordre : les premières passent, la dernière est retenue', () => {
    const r = reporterVersChronogramme({
      seances: [seance({ semaine: '2026-W3' }), seance({ semaine: '2026-W4' })],
      chronogrammes: [],
      masses: masses(2.5),
    });
    expect(cellule(r, 'GM101', 'M101', 'S3')).toBeDefined();
    expect(r.bilan.depassements.map((d) => d.semaine)).toEqual(['S4']);
  });

  it('par TYPE : le distanciel ne consomme pas la masse présentielle', () => {
    const r = reporterVersChronogramme({
      seances: [seance({ salle: 'TEAMS' })],
      chronogrammes: [chrono('GM101', { M101: [{ semaine: 'S8', heures: 5, type: 'P' }] })],
      masses: masses(5, 2.5),
    });
    expect(cellule(r, 'GM101', 'M101', 'S9')).toEqual({ semaine: 'S9', heures: 2.5, type: 'S' });
  });

  it('sans masse connue, rien n’est contrôlé — comme à la saisie', () => {
    const r = reporterVersChronogramme({
      seances: [seance(), seance({ seance: 'S2' })],
      chronogrammes: [],
      masses: new Map(),
    });
    expect(cellule(r, 'GM101', 'M101', 'S9')?.heures).toBe(5);
  });

  it('un groupe dont tout dépasse n’est pas annoncé comme créé', () => {
    const r = reporterVersChronogramme({
      seances: [seance(), seance({ seance: 'S2' })],
      chronogrammes: [],
      masses: masses(2.5),
    });
    expect(r.bilan.groupesCrees).toEqual([]);
  });
});
