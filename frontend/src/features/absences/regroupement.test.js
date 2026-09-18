import { describe, it, expect } from 'vitest';
import { grouperAbsences, grouperParFormateur } from './regroupement';

const absence = (surcharges = {}) => ({
  id: Math.random().toString(36).slice(2),
  formateurNom: 'AAJLIYE',
  formateurMatricule: '18688',
  dateAbsence: '2026-08-31',
  semaine: '2026-W1',
  jour: 'Lundi',
  seance: 'S3',
  groupe: 'GM101',
  module: 'M101',
  observation: '',
  dateRattrapage: null,
  ...surcharges,
});

describe('grouperAbsences', () => {
  /* Le cas signalé : deux cartes identiques à un « S3 / S4 » près. */
  it('réunit deux créneaux du même jour en une seule carte', () => {
    const groupes = grouperAbsences([absence({ seance: 'S3' }), absence({ seance: 'S4' })]);

    expect(groupes).toHaveLength(1);
    expect(groupes[0].entrees.map((e) => e.seance)).toEqual(['S3', 'S4']);
  });

  it('sépare deux formateurs, et deux jours', () => {
    const groupes = grouperAbsences([
      absence({ formateurNom: 'AAJLIYE' }),
      absence({ formateurNom: 'LAASAL' }),
      absence({ dateAbsence: '2026-09-01' }),
    ]);

    expect(groupes).toHaveLength(3);
  });

  /*
   * ⚠️ LA CLÉ N'INCLUT PAS LE MODULE : la même personne peut manquer deux cours
   * différents le même jour, et cela reste une seule absence à traiter.
   */
  it('groupe même quand les modules diffèrent', () => {
    const groupes = grouperAbsences([
      absence({ seance: 'S1', module: 'M101' }),
      absence({ seance: 'S3', module: 'M107' }),
    ]);

    expect(groupes).toHaveLength(1);
    // …mais le sujet n'est alors PAS remonté en tête : il n'est pas commun.
    expect(groupes[0].sujetCommun).toBeNull();
  });

  it('remonte le groupe et le module quand ils sont partagés', () => {
    const groupes = grouperAbsences([absence({ seance: 'S3' }), absence({ seance: 'S4' })]);
    expect(groupes[0].sujetCommun).toEqual({ groupe: 'GM101', module: 'M101' });
  });

  /*
   * ⚠️ LA CARTE RESTE MARQUÉE TANT QU'UN SEUL CRÉNEAU EST À RATTRAPER : c'est le
   * repère de ce qu'il reste à faire, l'éteindre trop tôt le ferait disparaître
   * de la vue d'ensemble.
   */
  it('signale la carte dès qu’un créneau n’est pas rattrapé', () => {
    const groupes = grouperAbsences([
      absence({ seance: 'S3', dateRattrapage: '2026-09-03' }),
      absence({ seance: 'S4', dateRattrapage: null }),
    ]);

    expect(groupes[0].sansRattrapage).toBe(true);
  });

  it('ne signale rien quand tout est rattrapé', () => {
    const groupes = grouperAbsences([
      absence({ seance: 'S3', dateRattrapage: '2026-09-03' }),
      absence({ seance: 'S4', dateRattrapage: '2026-09-04' }),
    ]);

    expect(groupes[0].sansRattrapage).toBe(false);
  });

  it('rend une liste vide sans absence', () => {
    expect(grouperAbsences([])).toEqual([]);
    expect(grouperAbsences()).toEqual([]);
  });

  /* L'ordre du serveur est conservé : il trie par date décroissante. */
  it('garde l’ordre d’arrivée', () => {
    const groupes = grouperAbsences([
      absence({ dateAbsence: '2026-09-02' }),
      absence({ dateAbsence: '2026-08-31' }),
    ]);

    expect(groupes.map((g) => g.dateAbsence)).toEqual(['2026-09-02', '2026-08-31']);
  });
});

describe('grouperParFormateur', () => {
  it('réunit les jours d’une même personne en une seule fiche', () => {
    const fiches = grouperParFormateur([
      absence({ dateAbsence: '2026-08-31', seance: 'S3' }),
      absence({ dateAbsence: '2026-09-01', seance: 'S1' }),
    ]);

    expect(fiches).toHaveLength(1);
    expect(fiches[0].jours).toHaveLength(2);
  });

  it('sépare deux formateurs', () => {
    const fiches = grouperParFormateur([
      absence({ formateurNom: 'AAJLIYE' }),
      absence({ formateurNom: 'LAASAL' }),
    ]);

    expect(fiches).toHaveLength(2);
  });

  /*
   * ⚠️ ON COMPTE DES CRÉNEAUX, PAS DES JOURS : deux créneaux le même jour font
   * bien DEUX absences — c'est ce que la carte annonce sous le nom.
   */
  it('compte les créneaux, pas les jours groupés', () => {
    const fiches = grouperParFormateur([
      absence({ dateAbsence: '2026-08-31', seance: 'S3' }),
      absence({ dateAbsence: '2026-08-31', seance: 'S4' }),
      absence({ dateAbsence: '2026-09-01', seance: 'S1' }),
    ]);

    expect(fiches[0].jours).toHaveLength(2); // deux jours groupés…
    expect(fiches[0].total).toBe(3); // …mais trois créneaux.
  });

  it('compte les créneaux sans rattrapage, tous jours confondus', () => {
    const fiches = grouperParFormateur([
      absence({ dateAbsence: '2026-08-31', seance: 'S3', dateRattrapage: '2026-09-03' }),
      absence({ dateAbsence: '2026-08-31', seance: 'S4', dateRattrapage: null }),
      absence({ dateAbsence: '2026-09-01', seance: 'S1', dateRattrapage: null }),
    ]);

    expect(fiches[0].sansRattrapage).toBe(2);
  });

  it('rend une liste vide sans absence', () => {
    expect(grouperParFormateur([])).toEqual([]);
    expect(grouperParFormateur()).toEqual([]);
  });

  /*
   * ⚠️ SERT AU RATTRAPAGE EN CHRONOGRAMME/EMPLOI (2026-09-03) : ces deux
   * grilles s'interrogent par MATRICULE, jamais par nom.
   */
  it('porte le matricule du formateur', () => {
    const fiches = grouperParFormateur([absence({ formateurMatricule: '15688' })]);
    expect(fiches[0].formateurMatricule).toBe('15688');
  });
});
