import { describe, it, expect } from 'vitest';
import { TYPES_COURS } from '../../constants/index.js';
import {
  modulesRegionaux,
  seancesDeLExamen,
  surveillantsPossibles,
  titulairesDuModule,
} from './efm.js';

/**
 * EFM régional (F13).
 * ← save_efm_regional.php + initEFMLogic()
 */
const affectations = [
  { formateur: '9863', groupe: 'GM101', module: 'M101', estRegional: true, type: TYPES_COURS.PRESENTIEL },
  { formateur: '4211', groupe: 'GM101', module: 'M102', estRegional: false, type: TYPES_COURS.PRESENTIEL },
  { formateur: '7001', groupe: 'GM101', module: 'M103', estRegional: true, type: TYPES_COURS.PRESENTIEL },
  { formateur: '5555', groupe: 'GM102', module: 'M104', estRegional: true, type: TYPES_COURS.PRESENTIEL },
];

describe('modulesRegionaux', () => {
  it('ne rend que les modules ÉVALUÉS AU NIVEAU RÉGIONAL', () => {
    expect(modulesRegionaux(affectations, 'GM101').map((m) => m.module)).toEqual(['M101', 'M103']);
  });

  it('et seulement ceux du groupe visé', () => {
    expect(modulesRegionaux(affectations, 'GM102').map((m) => m.module)).toEqual(['M104']);
  });

  it('rend le TITULAIRE par son matricule, jamais par son nom', () => {
    expect(titulairesDuModule(affectations, 'GM101', 'M101')).toEqual(['9863']);
  });

  /*
   * ⚠️ UN MODULE PEUT AVOIR DEUX TITULAIRES — l'un en présentiel, l'autre en
   * synchrone. Les deux sont exclus de la surveillance de leur propre examen.
   */
  it('⚠️ garde les DEUX titulaires d’un module co-enseigné', () => {
    const partage = [
      ...affectations,
      { formateur: '8888', groupe: 'GM101', module: 'M101', estRegional: true, type: TYPES_COURS.SYNCHRONE },
    ];

    expect(titulairesDuModule(partage, 'GM101', 'M101')).toEqual(['9863', '8888']);
  });

  /*
   * ⚠️ LE SUFFIXE NE DOIT PAS FAIRE RATER L'AFFECTATION : « GE102 (GC) » et
   * « GE102 » sont la même classe — c'est déjà la règle de `groupesCompares`.
   */
  it('⚠️ apparie le groupe malgré son suffixe', () => {
    const avecSuffixe = [
      { formateur: '9863', groupe: 'GE102 (GC)', module: 'M201', estRegional: true },
    ];

    expect(modulesRegionaux(avecSuffixe, 'GE102').map((m) => m.module)).toEqual(['M201']);
  });

  it('⚠️⚠️ mais ne mêle pas deux filières homonymes', () => {
    // Un EFM de GE101 (GE) — Génie électrique — ne porte pas sur les modules de
    // GE101 (GC) — Gestion des Entreprises (2026-09-11).
    const homonymes = [
      { formateur: '9863', groupe: 'GE101 (GC)', module: 'M201', estRegional: true },
      { formateur: '4211', groupe: 'GE101 (GE)', module: 'M301', estRegional: true },
    ];

    expect(modulesRegionaux(homonymes, 'GE101 (GE)').map((m) => m.module)).toEqual(['M301']);
  });

  it('⚠️ une FUSION couvre chacun de ses membres', () => {
    const fusion = [
      { formateur: '9863', groupe: 'GM101 GM102', module: 'M301', estRegional: true },
    ];

    expect(modulesRegionaux(fusion, 'GM102').map((m) => m.module)).toEqual(['M301']);
  });

  it('rend une liste vide plutôt que de lever, sans affectation', () => {
    expect(modulesRegionaux([], 'GM101')).toEqual([]);
    expect(titulairesDuModule([], 'GM101', 'M101')).toEqual([]);
  });
});

describe('surveillantsPossibles', () => {
  const formateurs = [
    { matricule: '9863', nom: 'BRAHIM LOURID' },
    { matricule: '4211', nom: 'AHMED CHERKAOUI' },
    { matricule: '7001', nom: 'ZINEB EL OMARI' },
  ];

  const seance = (surcharges = {}) => ({
    formateurMatricule: '4211',
    groupe: 'GM102',
    module: 'M102',
    jour: 'Lundi',
    seance: 'S1',
    ...surcharges,
  });

  it('déclare libre qui n’a rien sur les créneaux visés', () => {
    const etats = surveillantsPossibles(formateurs, { titulaires: [], creneaux: ['S1'] }, []);
    expect(etats.map((e) => e.statut)).toEqual(['libre', 'libre', 'libre']);
  });

  /*
   * ⚠️ LE TITULAIRE N'EST PAS « OCCUPÉ », il est ÉCARTÉ PAR RÈGLE. Les
   * confondre ferait chercher quel cours l'empêche, alors qu'il n'y en a aucun.
   */
  it('⚠️ le titulaire du module est écarté, et pour un motif DISTINCT', () => {
    const etats = surveillantsPossibles(
      formateurs,
      { titulaires: ['9863'], creneaux: ['S1'] },
      []
    );

    expect(etats[0]).toMatchObject({ statut: 'titulaire', motif: 'Titulaire du module' });
    expect(etats[1].statut).toBe('libre');
  });

  it('déclare occupé qui a cours sur un créneau visé, et NOMME ce cours', () => {
    const etats = surveillantsPossibles(
      formateurs,
      { titulaires: [], creneaux: ['S1', 'S2'] },
      [seance()]
    );

    expect(etats[1]).toMatchObject({ statut: 'occupe', motif: 'M102 avec GM102' });
  });

  /*
   * ⚠️ L'OCCUPATION SE LIT PAR CRÉNEAU, PAS PAR JOURNÉE. Un formateur a quatre
   * séances par jour : le déclarer occupé dès qu'il en a une le rendrait
   * indisponible pour tout examen, à toute heure.
   */
  it('⚠️ un cours sur un AUTRE créneau ne rend pas indisponible', () => {
    const etats = surveillantsPossibles(
      formateurs,
      { titulaires: [], creneaux: ['S3'] },
      [seance({ seance: 'S1' })]
    );

    expect(etats[1].statut).toBe('libre');
  });

  it('le titulaire l’emporte sur l’occupation — un seul motif, le plus fondamental', () => {
    const etats = surveillantsPossibles(
      formateurs,
      { titulaires: ['4211'], creneaux: ['S1'] },
      [seance()]
    );

    expect(etats[1].statut).toBe('titulaire');
  });
});

describe('seancesDeLExamen', () => {
  const examen = {
    groupe: 'GM101',
    module: 'M101',
    salle: 'A12',
    jour: 'Lundi',
    creneaux: ['S1', 'S2'],
    surveillants: ['4211', '7001'],
  };

  it('produit une séance par surveillant ET par créneau', () => {
    expect(seancesDeLExamen(examen)).toHaveLength(4);
  });

  it('toutes portent le même examen — seul le matricule change', () => {
    const seances = seancesDeLExamen(examen);

    expect(new Set(seances.map((s) => s.groupe))).toEqual(new Set(['GM101']));
    expect(new Set(seances.map((s) => s.salle))).toEqual(new Set(['A12']));
    expect(new Set(seances.map((s) => s.formateurMatricule))).toEqual(new Set(['4211', '7001']));
    expect(new Set(seances.map((s) => s.seance))).toEqual(new Set(['S1', 'S2']));
  });

  /*
   * ⚠️ SANS `estEfm`, UNE SURVEILLANCE COMPTERAIT COMME UN COURS DONNÉ : le
   * module paraîtrait avancer pendant son propre examen.
   */
  it('⚠️ toutes portent `estEfm`', () => {
    expect(seancesDeLExamen(examen).every((s) => s.estEfm === true)).toBe(true);
  });

  it('sans surveillant ni créneau, elle ne produit rien', () => {
    expect(seancesDeLExamen({ ...examen, surveillants: [] })).toEqual([]);
    expect(seancesDeLExamen({ ...examen, creneaux: [] })).toEqual([]);
  });
});
