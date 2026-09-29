import { describe, expect, it } from 'vitest';
import {
  ETAPES_CONFIGURATION,
  etapeDeReprise,
  etapesConfigurationFaites,
  etapesConfigurationManquantes,
} from './configuration.js';

const complet = {
  nomAbrege: 'ISTA NTIC',
  espaces: ['TEAMS', 'Salle 1'],
  baseExiste: true,
  formateurs: 12,
  groupes: 8,
};

describe('etapesConfigurationFaites', () => {
  it('un établissement vierge n’a rien fait', () => {
    const faites = etapesConfigurationFaites({});
    expect(Object.values(faites).every((fait) => fait === false)).toBe(true);
    expect(etapesConfigurationManquantes(faites)).toEqual(ETAPES_CONFIGURATION);
  });

  it('un établissement complet a tout fait', () => {
    expect(etapesConfigurationManquantes(etapesConfigurationFaites(complet))).toEqual([]);
  });

  it('⚠️ « TEAMS » seul ne suffit pas : il est créé d’office', () => {
    expect(etapesConfigurationFaites({ ...complet, espaces: ['TEAMS'] }).espaces).toBe(false);
    expect(etapesConfigurationFaites({ ...complet, espaces: ['teams', ' Teams '] }).espaces).toBe(false);
    expect(etapesConfigurationFaites({ ...complet, espaces: ['TEAMS', 'Atelier'] }).espaces).toBe(true);
  });

  it('un nom abrégé trop court ou blanc ne compte pas', () => {
    expect(etapesConfigurationFaites({ ...complet, nomAbrege: 'A' }).identite).toBe(false);
    expect(etapesConfigurationFaites({ ...complet, nomAbrege: '   ' }).identite).toBe(false);
    expect(etapesConfigurationFaites({ ...complet, nomAbrege: null }).identite).toBe(false);
    expect(etapesConfigurationFaites({ ...complet, nomAbrege: 'AB' }).identite).toBe(true);
  });

  it('formateurs et groupes se comptent séparément de la base', () => {
    const faites = etapesConfigurationFaites({ ...complet, formateurs: 0, groupes: 3 });
    expect(etapesConfigurationManquantes(faites)).toEqual(['formateurs']);
  });
});

describe('etapeDeReprise', () => {
  it('reprend à la PREMIÈRE étape non faite, même si une suivante l’est', () => {
    // Nom et espaces faits, pas de base : on reprend au point de départ (3).
    expect(etapeDeReprise(etapesConfigurationFaites({ nomAbrege: 'ISTA', espaces: ['Salle 1'] }))).toBe(3);
    // Les formateurs manquent alors que la carte existe : on revient les compléter (4).
    expect(etapeDeReprise(etapesConfigurationFaites({ ...complet, formateurs: 0 }))).toBe(4);
  });

  it('un établissement vierge reprend à l’étape 1', () => {
    expect(etapeDeReprise(etapesConfigurationFaites({}))).toBe(1);
  });

  it('tout est fait : on reprend à la dernière étape, les affectations', () => {
    expect(etapeDeReprise(etapesConfigurationFaites(complet))).toBe(6);
  });
});
