import { describe, it, expect } from 'vitest';
import { LONGUEUR_MAXIMALE, propositionsNomAbrege } from './nomAbrege.js';

describe('propositionsNomAbrege', () => {
  it("réduit les mots administratifs à leur initiale et garde les noms propres", () => {
    // L'exemple donné par le porteur du projet.
    const propositions = propositionsNomAbrege(
      'CENTRE DE FORMATION PROFESSIONNELLE HASSANIA DANS LES METIERS DE GESTION ' +
        'ET DU DIGITAL CASABLANCA'
    );

    expect(propositions[0]).toBe('CFP MGD HASSANIA');
    // La ville reste proposée : elle distingue deux établissements homonymes.
    expect(propositions).toContain('CFP MGD HASSANIA CASABLANCA');
  });

  it('ferme le sigle sur un nom propre au lieu de tout agglomérer', () => {
    // « CFP » puis « HASSANIA » puis « MGD » — et non « CFPHMGD ».
    const propositions = propositionsNomAbrege('Centre de Formation Professionnelle Hassania Gestion');
    expect(propositions[0]).toBe('CFP G HASSANIA');
  });

  it("ne coupe pas un nom propre en plusieurs mots", () => {
    // Le défaut de ma première version : elle ne gardait que le premier mot et
    // rendait « ISTA HAY ».
    const propositions = propositionsNomAbrege(
      'Institut Spécialisé de Technologie Appliquée Hay Mohammadi Casablanca Anfa'
    );
    expect(propositions[0]).toBe('ISTA HAY MOHAMMADI ANFA');
  });

  it("laisse intact un nom déjà abrégé", () => {
    expect(propositionsNomAbrege('ISTA NTIC')).toEqual(['ISTA NTIC']);
  });

  it('ignore les mots de liaison, sans même prendre leur initiale', () => {
    // « de », « dans », « les », « et », « du » ne portent rien.
    expect(propositionsNomAbrege('Centre de Formation')[0]).toBe('CF');
  });

  it('respecte la limite de longueur', () => {
    const propositions = propositionsNomAbrege(
      'Institut Spécialisé de Technologie Appliquée Sidi Bernoussi Zenata Ain Sebaa Hay Mohammadi'
    );
    for (const proposition of propositions) {
      expect(proposition.length).toBeLessThanOrEqual(LONGUEUR_MAXIMALE);
    }
  });

  it('rend une liste vide plutôt que de fabriquer un nom', () => {
    expect(propositionsNomAbrege('')).toEqual([]);
    expect(propositionsNomAbrege('   de   les   ')).toEqual([]);
    expect(propositionsNomAbrege(null)).toEqual([]);
  });

  it('ne propose jamais deux fois la même forme', () => {
    const propositions = propositionsNomAbrege('Institut Hassania');
    expect(new Set(propositions).size).toBe(propositions.length);
  });

  it("s'arrête à quatre propositions", () => {
    const propositions = propositionsNomAbrege(
      'Centre de Formation Professionnelle Hassania Gestion Casablanca'
    );
    expect(propositions.length).toBeLessThanOrEqual(4);
  });
});
