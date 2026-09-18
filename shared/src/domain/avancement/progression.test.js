import { describe, it, expect } from 'vitest';
import { progressionEtablissement } from './progression.js';
import { SEMAINES_ANNEE_REGIONALE } from './regional.js';

/** Une séance de jour vaut 2,5 h. */
const seance = (surcharges = {}) => ({
  semaine: '2026-W1',
  seance: 'S1',
  statut: 'planifie',
  estEfm: false,
  ...surcharges,
});

const rythme = (numero) => numero * 2;

describe('progressionEtablissement', () => {
  it('rend un point par semaine de l’année régionale', () => {
    const points = progressionEtablissement([], 100, rythme);

    expect(points).toHaveLength(SEMAINES_ANNEE_REGIONALE);
    expect(points[0]).toMatchObject({ numero: 1, libelle: 'S1' });
    expect(points.at(-1).numero).toBe(SEMAINES_ANNEE_REGIONALE);
  });

  /*
   * ⚠️ LE CUMUL, PAS LA SEMAINE : un taux d'avancement est ce qui a été fait
   * DEPUIS LA RENTRÉE. Des heures de la S1 comptent encore en S39.
   */
  it('cumule les heures d’une semaine à l’autre', () => {
    const points = progressionEtablissement(
      [seance({ semaine: '2026-W1' }), seance({ semaine: '2026-W3' })],
      100,
      rythme
    );

    expect(points[0].avancement).toBe(2.5);
    expect(points[1].avancement).toBe(2.5);
    expect(points[2].avancement).toBe(5);
    expect(points.at(-1).avancement).toBe(5);
  });

  /*
   * ⚠️ LES MÊMES EXCLUSIONS QUE `heuresPosees` : une séance ABSENTE n'a pas eu
   * lieu, une surveillance d'EFM n'est pas un cours. Deux règles de décompte sur
   * le même écran feraient diverger la courbe du chiffre affiché à côté.
   */
  it('écarte une séance absente et une surveillance d’EFM', () => {
    const points = progressionEtablissement(
      [seance({ statut: 'absent' }), seance({ estEfm: true })],
      100,
      rythme
    );
    expect(points[0].avancement).toBe(0);
  });

  it('porte le rythme régional attendu à chaque semaine', () => {
    const points = progressionEtablissement([], 100, rythme);
    expect(points[4].regional).toBe(10);
  });

  /*
   * ⚠️ LE ZÉRO DE REMPLISSAGE EXISTE EN PRODUCTION : « 2026-W039 » côtoie
   * « 2026-W39 ». Un découpage à la main ferait disparaître ces semaines.
   */
  it('lit une semaine écrite avec un zéro de remplissage', () => {
    const points = progressionEtablissement([seance({ semaine: '2026-W03' })], 100, rythme);
    expect(points[2].avancement).toBe(2.5);
  });

  /*
   * ⚠️ `null` ET NON `0` SANS MASSE PRÉVUE : une courbe à zéro se lirait comme
   * un établissement à l'arrêt, alors qu'il n'y a rien à mesurer.
   */
  it('rend null quand rien n’est prévu', () => {
    const points = progressionEtablissement([seance()], 0, rythme);
    expect(points[0].avancement).toBeNull();
  });

  it('ignore une semaine illisible plutôt que de lever', () => {
    const points = progressionEtablissement([seance({ semaine: 'n’importe quoi' })], 100, rythme);
    expect(points[0].avancement).toBe(0);
  });
});

describe('progressionEtablissement — les semaines de vacances', () => {
  /*
   * ⚠️ LE DRAPEAU NE CHANGE RIEN AU CALCUL, il MARQUE : la courbe reste plate en
   * vacances — le cumul ne recule pas — et une rupture se lirait comme une
   * donnée manquante. C'est le graphe qui en fait une bande.
   */
  it('marque les semaines chômées sans toucher au cumul', () => {
    const points = progressionEtablissement([], 100, () => null, [3, 4]);

    expect(points.filter((point) => point.vacances).map((point) => point.numero)).toEqual([3, 4]);
    expect(points.every((point) => point.avancement === 0)).toBe(true);
  });

  it('ne marque rien quand aucune semaine n’est chômée', () => {
    expect(progressionEtablissement([], 100).some((point) => point.vacances)).toBe(false);
  });
});
