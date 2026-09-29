/**
 * Quels groupes un enregistrement de carte fait disparaître.
 *
 * ⚠️ C'EST CETTE FONCTION QUI DÉCIDE CE QUI SERA DÉTRUIT — chronogrammes,
 *    séances, rattachements de stagiaires. Un faux positif efface une
 *    planification entière ; un faux négatif laisse les orphelins que la
 *    Phase 6 a passé la journée à diagnostiquer. Elle est pure exprès : la
 *    juger demande deux tableaux, pas une base de données.
 */

import { describe, expect, it } from 'vitest';

import { groupesRetires, nomsDeLaCarte, pese } from '../../src/modules/base/cascadeGroupes.js';

const carte = (groupes, affectations = []) => ({
  groupes,
  affectations: affectations.map((groupe) => ({ groupe })),
});

describe('nomsDeLaCarte', () => {
  it('réunit `groupes` ET les groupes cités par une affectation', () => {
    /*
     * ⚠️ LES DEUX SOURCES, PAS UNE SEULE. Le défaut corrigé le même jour dans
     *    `taches.js` : un groupe déclaré dont aucun module n'est encore
     *    attribué n'apparaît dans AUCUNE affectation. Ne lire que les
     *    affectations le ferait passer pour retiré — avec sa planification.
     */
    expect(nomsDeLaCarte(carte(['GM101'], ['GM102']))).toEqual(new Set(['GM101', 'GM102']));
  });

  it('éclate les FUSIONS en noms propres', () => {
    // La carte écrit « OPCM101 OPCM102 » en un libellé ; ce sont deux groupes.
    expect(nomsDeLaCarte(carte([], ['OPCM101 OPCM102']))).toEqual(
      new Set(['OPCM101', 'OPCM102'])
    );
  });

  it('garde le suffixe, qui fait partie du nom', () => {
    // ⚠️ Découper sur les espaces fabriquerait « ACADA101 » et « (FQ) ».
    expect(nomsDeLaCarte(carte(['ACADA101 (FQ)']))).toEqual(new Set(['ACADA101 (FQ)']));
  });
});

describe('groupesRetires', () => {
  it('ne rend RIEN quand la carte ne perd aucun groupe', () => {
    // Le cas ordinaire : on enregistre après avoir corrigé une masse horaire.
    expect(groupesRetires(carte(['GM101', 'GM102']), carte(['GM101', 'GM102']))).toEqual([]);
  });

  it('nomme le groupe disparu', () => {
    expect(groupesRetires(carte(['GM101', 'GM102']), carte(['GM101']))).toEqual(['GM102']);
  });

  it('NE LE RETIENT PAS s’il survit à travers une affectation seule', () => {
    /*
     * ⚠️ LE FAUX POSITIF LE PLUS COÛTEUX : le directeur retire un groupe de la
     *    liste déclarée mais ses affectations restent. Le compter retiré
     *    supprimerait la planification d'un groupe encore enseigné.
     */
    expect(groupesRetires(carte(['GM101', 'GM102']), carte(['GM101'], ['GM102']))).toEqual([]);
  });

  it('NE LE RETIENT PAS s’il survit à l’intérieur d’une FUSION', () => {
    expect(
      groupesRetires(carte(['SMP201', 'SMP202']), carte([], ['SMP201 SMP202']))
    ).toEqual([]);
  });

  it('repère un groupe qui n’existait que par une affectation', () => {
    // Symétrique du précédent : il disparaît aussi quand l'affectation part.
    expect(groupesRetires(carte([], ['GM102']), carte(['GM101']))).toEqual(['GM102']);
  });

  it('ignore la casse et les espaces parasites', () => {
    expect(groupesRetires(carte(['  gm101 ']), carte(['GM101']))).toEqual([]);
  });

  it('ne rend chaque groupe QU’UNE fois', () => {
    // Il figure à la fois dans `groupes` et dans deux affectations.
    expect(groupesRetires(carte(['GM102'], ['GM102', 'GM102']), carte(['GM101']))).toEqual([
      'GM102',
    ]);
  });

  it('supporte une carte précédente absente (premier enregistrement)', () => {
    expect(groupesRetires(null, carte(['GM101']))).toEqual([]);
  });
});

describe('pese — ce qui compte comme une destruction', () => {
  const vide = {
    chronogramme: 0,
    seances: 0,
    nonPlacees: 0,
    stagiairesADetacher: 0,
    stages: 0,
    liensFq: 0,
    absencesConservees: 0,
  };

  it('ne pèse RIEN quand le groupe n’est référencé nulle part', () => {
    // Retirer un groupe vide doit rester un geste sans friction.
    expect(pese(vide)).toBe(0);
  });

  it('NE COMPTE PAS les absences, qui sont conservées', () => {
    /*
     * ═══ ⚠️ UN STAGIAIRE EST UNE PERSONNE ═══ Son historique disciplinaire est
     * un document opposable, et `AbsenceStagiaire` dénormalise `nomComplet`
     * précisément « pour que la note reste lisible si le stagiaire quitte le
     * groupe ». Les compter ici ferait demander une confirmation pour une
     * destruction qui n'a pas lieu — et, pire, laisserait croire qu'elle a lieu.
     */
    expect(pese({ ...vide, absencesConservees: 40 })).toBe(0);
  });

  it('pèse dès qu’une seule référence serait détruite', () => {
    expect(pese({ ...vide, chronogramme: 1 })).toBe(1);
    expect(pese({ ...vide, stagiairesADetacher: 9 })).toBe(9);
  });
});
