import { describe, it, expect } from 'vitest';
import {
  agregerAvancement,
  complementParDefaut,
  dimensionComplement,
  taux,
  totalAvancement,
} from './agregation.js';

/**
 * Une ligne d'avancement, telle que `lireAvancementEnote` la rend.
 * Le cas de référence : ZINEB EL OMARI, EGQ202, sur SMP201 + SMP202 fusionnés.
 */
const ligne = (surcharges = {}) => ({
  groupe: 'SMP201',
  fusionGroupe: '',
  module: 'EGQ202',
  formateurPresentiel: 'ZINEB EL OMARI',
  formateurSynchrone: 'ZINEB EL OMARI',
  matriculePresentiel: '18448',
  matriculeSynchrone: '18448',
  prevuPresentiel: 75,
  prevuSynchrone: 20,
  realisePresentiel: 30,
  realiseSynchrone: 10,
  estRegional: false,
  ...surcharges,
});

/** Les deux lignes que produit une affectation synchrone FUSIONNÉE. */
const fusion = () => [
  ligne({ groupe: 'SMP201', fusionGroupe: 'SMP201 SMP202' }),
  ligne({ groupe: 'SMP202', fusionGroupe: 'SMP201 SMP202' }),
];

describe('agregerAvancement — axe MODULE', () => {
  it('réunit les groupes d’un même module', () => {
    const [module] = agregerAvancement(
      [ligne({ groupe: 'SMP201' }), ligne({ groupe: 'SMP202' })],
      'module'
    );

    expect(module.sujet).toBe('EGQ202');
    expect(module.prevuPresentiel).toBe(150);
    expect(module.realisePresentiel).toBe(60);
  });

  /*
   * ⚠️ LE CŒUR DE LA RÈGLE : une séance mutualisée est UNE séance. La compter
   * par groupe doublerait le prévu comme le réalisé, et le taux resterait juste
   * par accident — c'est ce qui rend le défaut si difficile à voir.
   */
  it('ne compte le synchrone fusionné QU’UNE FOIS', () => {
    const [module] = agregerAvancement(fusion(), 'module');

    expect(module.prevuSynchrone).toBe(20);
    expect(module.realiseSynchrone).toBe(10);
    // Le présentiel, lui, s'additionne : deux groupes en salle, deux cours.
    expect(module.prevuPresentiel).toBe(150);
  });
});

describe('agregerAvancement — axe GROUPE', () => {
  /*
   * ═══ ⚠️ ON N'ÉCLATE PAS LA FUSION ═══
   * Vérifié sur le fichier RÉEL : l'export e-note porte UNE LIGNE PAR GROUPE —
   * « GM101 » et « GM102 » y figurent chacune, toutes deux avec « GM101 GM102 »
   * en colonne FusionGroupe. Éclater donnerait à l'un les heures présentielles
   * de l'autre, et compterait la séance synchrone quatre fois pour deux groupes.
   * Ma première version le faisait ; le test l'a mise à terre.
   */
  it('chaque groupe ne reçoit QUE sa propre ligne', () => {
    const parGroupe = agregerAvancement(fusion(), 'groupe');

    expect(parGroupe.map((g) => g.sujet)).toEqual(['SMP201', 'SMP202']);
    for (const groupe of parGroupe) {
      // Sa séance mutualisée, une fois — et SES heures présentielles, pas celles du voisin.
      expect(groupe.prevuSynchrone).toBe(20);
      expect(groupe.prevuPresentiel).toBe(75);
      expect(groupe.realiseSynchrone).toBe(10);
    }
  });

  it('sans fusion, le groupe de la ligne suffit', () => {
    const parGroupe = agregerAvancement([ligne({ groupe: 'GM101', fusionGroupe: '' })], 'groupe');
    expect(parGroupe.map((g) => g.sujet)).toEqual(['GM101']);
  });
});

describe('agregerAvancement — axe FORMATEUR', () => {
  it('ne compte le synchrone mutualisé qu’une fois', () => {
    const [formateur] = agregerAvancement(fusion(), 'formateur');

    expect(formateur.sujet).toBe('ZINEB EL OMARI');
    expect(formateur.prevuSynchrone).toBe(20);
    expect(formateur.realiseSynchrone).toBe(10);
    expect(formateur.prevuPresentiel).toBe(150);
  });

  /*
   * ⚠️ DEUX FORMATEURS PAR LIGNE, ET PAS LES MÊMES HEURES. Le présentiel et le
   * synchrone d'un même module peuvent être assurés par deux personnes :
   * attribuer les deux au premier venu lui prêterait les heures de l'autre.
   */
  it('sépare le présentiel et le synchrone entre deux personnes', () => {
    const parFormateur = agregerAvancement(
      [ligne({ formateurPresentiel: 'A', formateurSynchrone: 'B' })],
      'formateur'
    );

    const a = parFormateur.find((f) => f.sujet === 'A');
    const b = parFormateur.find((f) => f.sujet === 'B');

    expect(a).toMatchObject({ prevuPresentiel: 75, prevuSynchrone: 0, realiseSynchrone: 0 });
    expect(b).toMatchObject({ prevuSynchrone: 20, prevuPresentiel: 0, realisePresentiel: 0 });
  });

  it('ignore une ligne sans formateur plutôt que d’inventer un sujet vide', () => {
    const parFormateur = agregerAvancement(
      [ligne({ formateurPresentiel: '', formateurSynchrone: '' })],
      'formateur'
    );
    expect(parFormateur).toEqual([]);
  });

  /*
   * ⚠️ DEUX MODULES DU MÊME ENSEMBLE NE SE CONFONDENT PAS : l'empreinte porte
   * le module en plus de la fusion. Sans lui, la seconde séance disparaîtrait.
   */
  it('compte deux modules distincts d’un même ensemble fusionné', () => {
    const lignes = [
      ...fusion(),
      ...fusion().map((l) => ({ ...l, module: 'EGQ205' })),
    ];
    const [formateur] = agregerAvancement(lignes, 'formateur');

    expect(formateur.prevuSynchrone).toBe(40);
  });
});

describe('totalAvancement', () => {
  it('additionne les modules, sans doubler le synchrone', () => {
    const total = totalAvancement(fusion());

    expect(total.prevu).toBe(170);
    expect(total.realise).toBe(70);
    expect(total.modules).toBe(1);
  });

  /*
   * ⚠️ LE TOTAL SE CALCULE SUR L'AXE MODULE, jamais sur les groupes : par
   * groupe, la séance mutualisée est comptée pour chacun, et le total
   * dépasserait ce que l'établissement doit réellement.
   */
  it('le total ne suit PAS la somme de l’axe groupe', () => {
    const parGroupe = agregerAvancement(fusion(), 'groupe');
    const sommeGroupes = parGroupe.reduce((s, g) => s + g.prevu, 0);

    expect(sommeGroupes).toBe(190);
    expect(totalAvancement(fusion()).prevu).toBe(170);
  });
});

describe('taux', () => {
  it('rend un pourcentage au dixième', () => {
    expect(taux(30, 75)).toBe(40);
    expect(taux(1, 3)).toBe(33.3);
  });

  /*
   * ⚠️ `null` ET NON `0` QUAND RIEN N'EST PRÉVU : « 0 % » se lit comme un
   * retard, alors qu'il n'y a rien à faire — c'est la carte d'affectations
   * qu'il faut corriger. Même règle qu'`avancementModule`.
   */
  it('rend null quand rien n’est prévu', () => {
    expect(taux(0, 0)).toBeNull();
    expect(taux(10, 0)).toBeNull();
  });

  it('peut dépasser 100 %', () => {
    // Un dépassement est une information, pas une erreur à masquer.
    expect(taux(90, 75)).toBe(120);
  });
});

describe('agregerAvancement — ce que l’axe ne dit pas de lui-même', () => {
  /*
   * ⚠️ UN BÂTON « M101 » NE DIT PAS QUI L'ENSEIGNE, et c'est la question
   * suivante — surtout filtré sur un groupe, où le module a exactement un
   * formateur. (Demande du porteur, 2026-09-01.)
   */
  it('nomme les FORMATEURS sur l’axe module', () => {
    const lignes = [
      ligne({ module: 'M101', groupe: 'GM101', formateurPresentiel: 'ZINEB EL OMARI' }),
      ligne({ module: 'M101', groupe: 'GM102', formateurPresentiel: 'AHMED TAIA' }),
    ];

    expect(agregerAvancement(lignes, 'module')[0].complements).toEqual([
      'AHMED TAIA',
      'ZINEB EL OMARI',
    ]);
  });

  it('nomme les GROUPES sur l’axe formateur', () => {
    const lignes = [
      ligne({ module: 'M101', groupe: 'GM102', formateurPresentiel: 'ZINEB EL OMARI' }),
      ligne({ module: 'M102', groupe: 'GM101', formateurPresentiel: 'ZINEB EL OMARI' }),
    ];

    expect(agregerAvancement(lignes, 'formateur')[0].complements).toEqual(['GM101', 'GM102']);
  });

  /*
   * ⚠️ LES DEUX RÔLES, pas seulement le présentiel : un module dont les séances
   * à distance sont assurées par quelqu'un d'autre a bien DEUX enseignants.
   */
  it('nomme aussi le formateur du synchrone', () => {
    const lignes = [
      ligne({
        module: 'M101',
        groupe: 'GM101',
        formateurPresentiel: 'ZINEB EL OMARI',
        formateurSynchrone: 'AHMED TAIA',
        prevuSynchrone: 10,
      }),
    ];

    expect(agregerAvancement(lignes, 'module')[0].complements).toEqual([
      'AHMED TAIA',
      'ZINEB EL OMARI',
    ]);
  });

  /*
   * ⚠️ L'AXE GROUPE N'EN A PAS : son complément serait la liste de ses
   * formateurs ou de ses modules — une énumération que la ligne ne peut pas
   * porter, et qui n'apprendrait rien.
   */
  it('ne nomme rien sur l’axe groupe', () => {
    const lignes = [ligne({ module: 'M101', groupe: 'GM101', formateurPresentiel: 'ZINEB EL OMARI' })];

    expect(agregerAvancement(lignes, 'groupe')[0].complements).toEqual([]);
  });

  it('ne répète pas un nom présent sur plusieurs lignes', () => {
    const lignes = [
      ligne({ module: 'M101', groupe: 'GM101', formateurPresentiel: 'ZINEB EL OMARI' }),
      ligne({ module: 'M101', groupe: 'GM102', formateurPresentiel: 'ZINEB EL OMARI' }),
    ];

    expect(agregerAvancement(lignes, 'module')[0].complements).toEqual(['ZINEB EL OMARI']);
  });
});

/*
 * ═══ UNE DIMENSION DÉJÀ FIGÉE PAR LE FILTRE N'APPREND PLUS RIEN ═══
 * Filtré sur un formateur, l'axe module écrivait son nom sur les cinquante
 * bâtons. La réponse utile devient alors le groupe.
 */
describe('dimensionComplement', () => {
  it('rend la dimension naturelle de l’axe quand rien n’est filtré', () => {
    expect(dimensionComplement('module', {})).toBe('formateurs');
    expect(dimensionComplement('formateur', {})).toBe('groupes');
    expect(complementParDefaut('module')).toBe('formateurs');
  });

  it('descend au GROUPE quand l’axe module est filtré sur un formateur', () => {
    expect(dimensionComplement('module', { formateur: ['ZINEB EL OMARI'] })).toBe('groupes');
  });

  it('descend au MODULE quand l’axe formateur est filtré sur un groupe', () => {
    expect(dimensionComplement('formateur', { groupe: ['GM101'] })).toBe('modules');
  });

  /* Les deux figées : il ne reste plus rien à nommer. */
  it('ne rend rien quand les deux dimensions sont figées', () => {
    expect(dimensionComplement('module', { formateur: ['ZINEB EL OMARI'], groupe: ['GM101'] })).toBeNull();
  });

  /* Une facette VIDE ne fige rien — la grammaire du panneau de filtres. */
  it('ne tient pas compte d’une facette vide', () => {
    expect(dimensionComplement('module', { formateur: [], groupe: [] })).toBe('formateurs');
  });

  it('ne rend rien sur l’axe groupe, filtré ou non', () => {
    expect(dimensionComplement('groupe', {})).toBeNull();
    expect(dimensionComplement('groupe', { formateur: ['ZINEB EL OMARI'] })).toBeNull();
  });

  /*
   * ═══ UN MODULE DONNÉ À DEUX GROUPES, CE SONT DEUX BÂTONS ═══
   * (demande du porteur, 2026-09-02.) C'est l'unité de `completionModules` : un
   * module n'est pas achevé dans l'absolu, il l'est POUR UN GROUPE.
   */
  it('ÉCLATE le module par groupe, au lieu de les réunir', () => {
    const lignes = [
      ligne({ module: 'M101', groupe: 'GM102', formateurPresentiel: 'ZINEB EL OMARI' }),
      ligne({ module: 'M101', groupe: 'GM101', formateurPresentiel: 'ZINEB EL OMARI' }),
    ];

    const rendu = agregerAvancement(lignes, 'module', 'groupes');

    expect(rendu).toHaveLength(2);
    expect(rendu.map((r) => r.cle)).toEqual(['M101||GM101', 'M101||GM102']);
    /* Le sujet AFFICHÉ reste le module : c'est `cle` qui porte l'identité. */
    expect(rendu.map((r) => r.sujet)).toEqual(['M101', 'M101']);
    expect(rendu.map((r) => r.complements)).toEqual([['GM101'], ['GM102']]);
  });

  /*
   * ⚠️ UNE PERSONNE EST UNE SEULE PERSONNE : éclater un formateur par groupe
   * étalerait sa charge sur des bâtons dont aucun ne dirait ce qu'il assure.
   */
  it('n’éclate PAS l’axe formateur, même quand il nomme les groupes', () => {
    const lignes = [
      ligne({ module: 'M101', groupe: 'GM101', formateurPresentiel: 'ZINEB EL OMARI' }),
      ligne({ module: 'M102', groupe: 'GM102', formateurPresentiel: 'ZINEB EL OMARI' }),
    ];

    const rendu = agregerAvancement(lignes, 'formateur', 'groupes');

    expect(rendu).toHaveLength(1);
    expect(rendu[0].cle).toBe('ZINEB EL OMARI');
    expect(rendu[0].ventilation).toBeNull();
  });

  /* Sans ventilation, `cle` vaut le sujet : rien ne change pour les appelants. */
  it('garde `cle` égale au sujet quand rien n’éclate', () => {
    const lignes = [ligne({ module: 'M101', groupe: 'GM101' })];

    expect(agregerAvancement(lignes, 'module')[0]).toMatchObject({
      cle: 'M101',
      sujet: 'M101',
      ventilation: null,
    });
  });

  it('nomme les MODULES sur l’axe formateur quand on le lui demande', () => {
    const lignes = [
      ligne({ module: 'M102', groupe: 'GM101', formateurPresentiel: 'ZINEB EL OMARI' }),
      ligne({ module: 'M101', groupe: 'GM101', formateurPresentiel: 'ZINEB EL OMARI' }),
    ];

    expect(agregerAvancement(lignes, 'formateur', 'modules')[0].complements).toEqual([
      'M101',
      'M102',
    ]);
  });

  it('ne collecte rien quand la dimension est nulle', () => {
    const lignes = [ligne({ module: 'M101', groupe: 'GM101' })];

    expect(agregerAvancement(lignes, 'module', null)[0].complements).toEqual([]);
  });
});
