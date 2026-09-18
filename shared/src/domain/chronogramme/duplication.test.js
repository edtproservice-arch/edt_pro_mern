import { describe, it, expect } from 'vitest';
import { comparerMaquettes, filiereDuNomGroupe, signatureMaquette } from './duplication.js';

const module = (code, presentiel, synchrone = 0, semestre = 'S1') => ({
  code,
  masses: { presentiel, synchrone },
  semestre,
});

const groupe = (nom, modules) => ({ groupe: nom, modules });

describe('signatureMaquette', () => {
  it('ne dépend PAS de l’ordre des modules', () => {
    /*
     * L'ordre dans la base n'a aucune signification — il suit l'ordre des lignes
     * du fichier e-note. Sans le tri, deux groupes jumeaux se seraient déclarés
     * incompatibles selon l'ordre d'import.
     */
    const a = signatureMaquette([module('M101', 30), module('M102', 20)]);
    const b = signatureMaquette([module('M102', 20), module('M101', 30)]);
    expect(a).toBe(b);
  });

  it('distingue deux masses différentes', () => {
    expect(signatureMaquette([module('M101', 30)])).not.toBe(
      signatureMaquette([module('M101', 40)])
    );
  });

  it('distingue le présentiel du synchrone à total égal', () => {
    // 30 h de présentiel et 30 h de synchrone ne se planifient pas pareil :
    // comparer les totaux aurait laissé passer l'un pour l'autre.
    expect(signatureMaquette([module('M101', 30, 0)])).not.toBe(
      signatureMaquette([module('M101', 0, 30)])
    );
  });

  it('distingue le semestre', () => {
    expect(signatureMaquette([module('M101', 30, 0, 'S1')])).not.toBe(
      signatureMaquette([module('M101', 30, 0, 'S2')])
    );
  });

  it('accepte la forme S1/S2 en plus du libellé', () => {
    // La route du chronogramme rend « S1 » / « annuel » ; la carte rend le
    // détail S1/S2. Exiger une seule forme aurait obligé l'une à fabriquer
    // l'autre — donc à réécrire la règle du semestre une seconde fois.
    expect(signatureMaquette([{ code: 'M101', masses: { presentiel: 30, s1: 30, s2: 0 } }])).toBe(
      signatureMaquette([module('M101', 30, 0, 'S1')])
    );
  });
});

describe('filiereDuNomGroupe', () => {
  it('retire le numéro d’année et de rang', () => {
    expect(filiereDuNomGroupe('DEVOWFS201')).toBe('DEVOWFS');
    expect(filiereDuNomGroupe('GM101')).toBe('GM');
  });

  it('GARDE le suffixe : il fait partie de l’identité', () => {
    /*
     * « ACADA101 » et « ACADA101 (FQ) » sont deux formations distinctes — l'une
     * diplômante, l'autre qualifiante — qui peuvent partager des modules sans
     * partager leur rythme. Les confondre recopierait le chronogramme de l'une
     * sur l'autre.
     */
    expect(filiereDuNomGroupe('ACADA101 (FQ)')).not.toBe(filiereDuNomGroupe('ACADA101'));
    expect(filiereDuNomGroupe('ACADA101 (FQ)')).toBe(filiereDuNomGroupe('ACADA102 (FQ)'));
  });

  it('ne dépend pas de l’ordre de deux suffixes', () => {
    expect(filiereDuNomGroupe('GE101 (CDS) (GE)')).toBe(filiereDuNomGroupe('GE102 (GE) (CDS)'));
  });
});

describe('comparerMaquettes', () => {
  const maquette = [module('M101', 30), module('M102', 20, 10, 'annuel')];

  it('accepte deux groupes JUMEAUX', () => {
    const resultat = comparerMaquettes(
      groupe('DEVOWFS201', maquette),
      groupe('DEVOWFS202', maquette)
    );
    expect(resultat).toEqual({ compatible: true, raisons: [] });
  });

  it('refuse une ANNÉE différente', () => {
    const resultat = comparerMaquettes(
      groupe('DEVOWFS201', maquette),
      groupe('DEVOWFS101', maquette)
    );
    expect(resultat.compatible).toBe(false);
    expect(resultat.raisons[0]).toContain('année différente');
  });

  it('refuse une FILIÈRE différente, même à maquette identique', () => {
    /*
     * L'existant ne contrôlait que la maquette, en tenant pour acquis que deux
     * maquettes identiques appartiennent à la même filière. Deux filières
     * voisines peuvent pourtant partager leur liste de modules et leurs masses.
     */
    const resultat = comparerMaquettes(groupe('GM201', maquette), groupe('PM201', maquette));
    expect(resultat.compatible).toBe(false);
    expect(resultat.raisons[0]).toContain('filière différente');
  });

  it('NOMME les modules absents plutôt que de dire « incompatible »', () => {
    // « Incompatible » seul envoie chercher un défaut dans le chronogramme ;
    // « module EGTS105 absent » envoie corriger la carte, là où il est.
    const resultat = comparerMaquettes(
      groupe('DEVOWFS201', [...maquette, module('EGTS105', 15)]),
      groupe('DEVOWFS202', maquette)
    );
    expect(resultat.compatible).toBe(false);
    expect(resultat.raisons.join(' ')).toContain('EGTS105');
    expect(resultat.raisons.join(' ')).toContain('absent');
  });

  it('signale les modules EN PLUS chez la cible', () => {
    const resultat = comparerMaquettes(
      groupe('DEVOWFS201', maquette),
      groupe('DEVOWFS202', [...maquette, module('EGTS105', 15)])
    );
    expect(resultat.raisons.join(' ')).toContain('en plus');
  });

  it('CHIFFRE l’écart de masse horaire', () => {
    const resultat = comparerMaquettes(
      groupe('DEVOWFS201', [module('M101', 30)]),
      groupe('DEVOWFS202', [module('M101', 40)])
    );
    expect(resultat.raisons.join(' ')).toContain('30 h ≠ 40 h');
  });

  it('signale un SEMESTRE différent à masse égale', () => {
    const resultat = comparerMaquettes(
      groupe('DEVOWFS201', [module('M101', 30, 0, 'S1')]),
      groupe('DEVOWFS202', [module('M101', 30, 0, 'S2')])
    );
    expect(resultat.raisons.join(' ')).toContain('semestre différent');
  });

  it('ne noie PAS la cause première sous les écarts de masse', () => {
    /*
     * Quand des modules manquent, énumérer en plus les écarts de masse des
     * modules communs ferait dix lignes de raisons pour un seul problème.
     */
    const resultat = comparerMaquettes(
      groupe('DEVOWFS201', [module('M101', 30), module('M999', 10)]),
      groupe('DEVOWFS202', [module('M101', 40)])
    );
    expect(resultat.raisons).toHaveLength(1);
    expect(resultat.raisons[0]).toContain('absent');
  });

  it('refuse une cible SANS AUCUN module', () => {
    const resultat = comparerMaquettes(groupe('DEVOWFS201', maquette), groupe('DEVOWFS202', []));
    expect(resultat).toEqual({ compatible: false, raisons: ['aucun module affecté'] });
  });
});
