import { describe, it, expect } from 'vitest';
import {
  copierAffectationsPresentiel,
  lignesSynchrone,
  definirLignesSynchrone,
  projeterSynchrones,
  defautSynchrone,
  formateurPresentielDominant,
  synchronesEffectifs,
  activerModule,
  definirMasseHoraire,
  masseModifiable,
  libererFormateursInconnus,
  renommerGroupes,
} from './affectations.js';
import { cleEnsemble } from './bilanCharge.js';

function groupe(nom, modules, surcharges = {}) {
  return {
    nom,
    codeFiliere: 'DEVOWFS_S',
    anneeFormation: 1,
    modules,
    ...surcharges,
  };
}

function module(code, surcharges = {}) {
  return {
    code,
    nom: code,
    mhpS1: 30,
    mhpS2: 30,
    formateurPresentiel: '',
    formateurSynchrone: '',
    ...surcharges,
  };
}

const CLE = cleEnsemble({ codeFiliere: 'DEVOWFS_S', anneeFormation: 1 });

describe('copierAffectationsPresentiel', () => {
  it('reporte les formateurs sur les autres groupes de l\'ensemble', () => {
    const depart = [
      groupe('DEV101', [
        module('M101', { formateurPresentiel: 'AHMED' }),
        module('M102', { formateurPresentiel: 'FATIMA' }),
      ]),
      groupe('DEV102', [module('M101'), module('M102')]),
      groupe('DEV103', [module('M101'), module('M102')]),
    ];

    const { groupes, touches } = copierAffectationsPresentiel(depart, 'DEV101');

    expect(touches).toBe(2);
    for (const nom of ['DEV102', 'DEV103']) {
      const cible = groupes.find((g) => g.nom === nom);
      expect(cible.modules.map((m) => m.formateurPresentiel)).toEqual(['AHMED', 'FATIMA']);
    }
  });

  it('ne touche pas aux groupes d\'un autre ensemble', () => {
    const depart = [
      groupe('DEV101', [module('M101', { formateurPresentiel: 'AHMED' })]),
      groupe('DEV201', [module('M101')], { anneeFormation: 2 }),
    ];

    const { groupes, touches } = copierAffectationsPresentiel(depart, 'DEV101');

    expect(touches).toBe(0);
    expect(groupes.find((g) => g.nom === 'DEV201').modules[0].formateurPresentiel).toBe('');
  });

  it('laisse intact un module que la source ne porte pas', () => {
    // Copier depuis un groupe amputé d'un module ne doit pas vider ce module
    // partout ailleurs.
    const depart = [
      groupe('DEV101', [module('M101', { formateurPresentiel: 'AHMED' })]),
      groupe('DEV102', [
        module('M101'),
        module('M102', { formateurPresentiel: 'FATIMA' }),
      ]),
    ];

    const { groupes } = copierAffectationsPresentiel(depart, 'DEV101');
    const cible = groupes.find((g) => g.nom === 'DEV102');

    expect(cible.modules[0].formateurPresentiel).toBe('AHMED');
    expect(cible.modules[1].formateurPresentiel).toBe('FATIMA');
  });

  it('efface bien une affectation que la source a laissée vide', () => {
    const depart = [
      groupe('DEV101', [module('M101')]),
      groupe('DEV102', [module('M101', { formateurPresentiel: 'FATIMA' })]),
    ];

    const { groupes } = copierAffectationsPresentiel(depart, 'DEV101');
    expect(groupes.find((g) => g.nom === 'DEV102').modules[0].formateurPresentiel).toBe('');
  });

  it('ne fait rien quand le groupe source n\'existe pas', () => {
    const depart = [groupe('DEV101', [module('M101')])];
    const { groupes, touches } = copierAffectationsPresentiel(depart, 'INCONNU');

    expect(touches).toBe(0);
    expect(groupes).toBe(depart);
  });

  it('ne modifie pas le tableau d\'origine', () => {
    const depart = [
      groupe('DEV101', [module('M101', { formateurPresentiel: 'AHMED' })]),
      groupe('DEV102', [module('M101')]),
    ];

    copierAffectationsPresentiel(depart, 'DEV101');
    expect(depart[1].modules[0].formateurPresentiel).toBe('');
  });
});

describe('lignes synchrones', () => {
  it('n\'en dérive aucune quand rien n\'est affecté', () => {
    const depart = [groupe('DEV101', [module('M101')]), groupe('DEV102', [module('M101')])];
    expect(lignesSynchrone(depart, CLE, 'M101')).toEqual([]);
  });

  it('enregistre une séance et note sa fusion sur chaque groupe couvert', () => {
    const depart = [
      groupe('DEV101', [module('M101')]),
      groupe('DEV102', [module('M101')]),
      groupe('DEV103', [module('M101')]),
    ];

    const groupes = definirLignesSynchrone(depart, CLE, 'M101', [
      { formateur: 'AHMED', groupes: ['DEV101', 'DEV102'] },
    ]);

    expect(groupes[0].modules[0]).toMatchObject({
      formateurSynchrone: 'AHMED',
      groupeFusion: 'DEV101 DEV102',
    });
    expect(groupes[1].modules[0].formateurSynchrone).toBe('AHMED');
    // Groupe non coché : aucune séance.
    expect(groupes[2].modules[0]).toMatchObject({ formateurSynchrone: '', groupeFusion: '' });
  });

  it('accepte plusieurs séances pour le même module', () => {
    // Dix groupes ne tiennent pas dans une seule classe Teams : deux formateurs
    // se partagent la promotion. C'était le modèle de l'existant.
    const depart = [
      groupe('DEV101', [module('M101')]),
      groupe('DEV102', [module('M101')]),
      groupe('DEV103', [module('M101')]),
    ];

    const groupes = definirLignesSynchrone(depart, CLE, 'M101', [
      { formateur: 'AHMED', groupes: ['DEV101', 'DEV102'] },
      { formateur: 'FATIMA', groupes: ['DEV103'] },
    ]);

    expect(groupes[2].modules[0]).toMatchObject({
      formateurSynchrone: 'FATIMA',
      groupeFusion: 'DEV103',
    });

    const lignes = lignesSynchrone(groupes, CLE, 'M101');
    expect(lignes).toEqual([
      { formateur: 'AHMED', groupes: ['DEV101', 'DEV102'] },
      { formateur: 'FATIMA', groupes: ['DEV103'] },
    ]);
  });

  it('fait un aller-retour fidèle', () => {
    const depart = [groupe('DEV101', [module('M101')]), groupe('DEV102', [module('M101')])];
    const lignes = [{ formateur: 'AHMED', groupes: ['DEV101', 'DEV102'] }];

    expect(lignesSynchrone(definirLignesSynchrone(depart, CLE, 'M101', lignes), CLE, 'M101'))
      .toEqual(lignes);
  });

  it('garde SÉPARÉES deux séances du même formateur', () => {
    /*
     * Le cas signalé à l'usage : BRAHIM LOURID sur GM101 d'un côté, GM102 de
     * l'autre. Le regroupement se faisait sur le seul formateur — les deux
     * lignes revenaient donc réunies en une, portant les deux groupes, et la
     * séparation faite à l'écran disparaissait au rechargement.
     */
    const depart = [groupe('DEV101', [module('M101')]), groupe('DEV102', [module('M101')])];
    const lignes = [
      { formateur: 'AHMED', groupes: ['DEV101'] },
      { formateur: 'AHMED', groupes: ['DEV102'] },
    ];

    const groupes = definirLignesSynchrone(depart, CLE, 'M101', lignes);

    expect(groupes[0].modules[0].groupeFusion).toBe('DEV101');
    expect(groupes[1].modules[0].groupeFusion).toBe('DEV102');
    expect(lignesSynchrone(groupes, CLE, 'M101')).toEqual(lignes);
  });

  it('traite une fusion VIDE comme une séance propre au groupe', () => {
    // Ce que produit la reconstruction depuis la base pour une affectation à un
    // seul groupe : « fusionné avec personne », et non « fusion inconnue ».
    const depart = [
      groupe('DEV101', [module('M101', { formateurSynchrone: 'AHMED', groupeFusion: '' })]),
      groupe('DEV102', [module('M101', { formateurSynchrone: 'AHMED', groupeFusion: '' })]),
    ];

    expect(lignesSynchrone(depart, CLE, 'M101')).toEqual([
      { formateur: 'AHMED', groupes: ['DEV101'] },
      { formateur: 'AHMED', groupes: ['DEV102'] },
    ]);
  });

  it('retire la séance quand la liste des lignes est vidée', () => {
    const depart = [
      groupe('DEV101', [module('M101', { formateurSynchrone: 'AHMED', groupeFusion: 'DEV101' })]),
    ];

    const groupes = definirLignesSynchrone(depart, CLE, 'M101', []);
    expect(groupes[0].modules[0]).toMatchObject({ formateurSynchrone: '', groupeFusion: '' });
  });

  it('ignore une ligne sans formateur', () => {
    const depart = [groupe('DEV101', [module('M101')])];
    const groupes = definirLignesSynchrone(depart, CLE, 'M101', [
      { formateur: '', groupes: ['DEV101'] },
    ]);

    expect(groupes[0].modules[0].formateurSynchrone).toBe('');
  });

  it('n\'attribue un groupe qu\'à une seule séance', () => {
    const depart = [groupe('DEV101', [module('M101')])];
    const groupes = definirLignesSynchrone(depart, CLE, 'M101', [
      { formateur: 'AHMED', groupes: ['DEV101'] },
      { formateur: 'FATIMA', groupes: ['DEV101'] },
    ]);

    // Un groupe ne suit qu'une séance : la première ligne l'emporte.
    expect(groupes[0].modules[0].formateurSynchrone).toBe('AHMED');
  });

  it('ne touche jamais au formateur présentiel', () => {
    // C'est le défaut signalé : affecter en présentiel ne doit rien écrire en
    // synchrone, et l'inverse non plus.
    const depart = [groupe('DEV101', [module('M101', { formateurPresentiel: 'AHMED' })])];
    const groupes = definirLignesSynchrone(depart, CLE, 'M101', [
      { formateur: 'FATIMA', groupes: ['DEV101'] },
    ]);

    expect(groupes[0].modules[0].formateurPresentiel).toBe('AHMED');
    expect(groupes[0].modules[0].formateurSynchrone).toBe('FATIMA');
  });

  it('n\'affecte que l\'ensemble visé', () => {
    const depart = [
      groupe('DEV101', [module('M101')]),
      groupe('DEV201', [module('M101')], { anneeFormation: 2 }),
    ];

    const groupes = definirLignesSynchrone(depart, CLE, 'M101', [
      { formateur: 'AHMED', groupes: ['DEV101', 'DEV201'] },
    ]);

    expect(groupes[0].modules[0].formateurSynchrone).toBe('AHMED');
    expect(groupes[1].modules[0].formateurSynchrone).toBe('');
  });

  it('ne touche pas aux autres modules', () => {
    const depart = [
      groupe('DEV101', [module('M101'), module('M102', { formateurSynchrone: 'FATIMA' })]),
    ];

    const groupes = definirLignesSynchrone(depart, CLE, 'M101', [
      { formateur: 'AHMED', groupes: ['DEV101'] },
    ]);

    expect(groupes[0].modules[1].formateurSynchrone).toBe('FATIMA');
  });
});

describe('libererFormateursInconnus', () => {
  it('efface les noms absents de la liste des formateurs', () => {
    const depart = [
      groupe('DEV101', [
        module('M101', { formateurPresentiel: 'AHMED', formateurSynchrone: 'PARTI' }),
      ]),
    ];

    const groupes = libererFormateursInconnus(depart, [{ nom: 'AHMED' }]);

    expect(groupes[0].modules[0].formateurPresentiel).toBe('AHMED');
    // Sans cela, l'import recréerait « PARTI » sans matricule ni masse horaire.
    expect(groupes[0].modules[0].formateurSynchrone).toBe('');
  });

  it('apparie sans tenir compte de la casse ni des espaces', () => {
    const depart = [groupe('DEV101', [module('M101', { formateurPresentiel: ' ahmed ' })])];
    const groupes = libererFormateursInconnus(depart, [{ nom: 'AHMED' }]);

    expect(groupes[0].modules[0].formateurPresentiel).toBe(' ahmed ');
  });

  it('vide tout quand la liste des formateurs est vide', () => {
    const depart = [groupe('DEV101', [module('M101', { formateurPresentiel: 'AHMED' })])];
    const groupes = libererFormateursInconnus(depart, []);

    expect(groupes[0].modules[0].formateurPresentiel).toBe('');
  });
});

describe('activerModule', () => {
  it('désactive le module dans tous les groupes de l\'ensemble', () => {
    const depart = [
      groupe('DEV101', [module('M101'), module('M102')]),
      groupe('DEV102', [module('M101'), module('M102')]),
    ];

    const groupes = activerModule(depart, CLE, 'M101', false);

    for (const g of groupes) {
      expect(g.modules[0].actif).toBe(false);
      // Les autres modules ne sont pas touchés.
      expect(g.modules[1].actif).toBeUndefined();
    }
  });

  it('réactive sans avoir à retrouver le module dans la répartition', () => {
    const depart = [groupe('DEV101', [module('M101', { actif: false, formateurPresentiel: 'AHMED' })])];
    const groupes = activerModule(depart, CLE, 'M101', true);

    expect(groupes[0].modules[0].actif).toBe(true);
    // L'affectation a survécu à la désactivation.
    expect(groupes[0].modules[0].formateurPresentiel).toBe('AHMED');
  });

  it('ne touche pas aux autres ensembles', () => {
    const depart = [
      groupe('DEV101', [module('M101')]),
      groupe('DEV201', [module('M101')], { anneeFormation: 2 }),
    ];

    const groupes = activerModule(depart, CLE, 'M101', false);

    expect(groupes[0].modules[0].actif).toBe(false);
    expect(groupes[1].modules[0].actif).toBeUndefined();
  });

  it('ne modifie pas le tableau d\'origine', () => {
    const depart = [groupe('DEV101', [module('M101')])];
    activerModule(depart, CLE, 'M101', false);

    expect(depart[0].modules[0].actif).toBeUndefined();
  });
});

describe('definirMasseHoraire', () => {
  const alterne = (modules) => groupe('GM101', modules, { mode: 'Alterné' });
  const avecReference = (surcharges = {}) =>
    module('M101', { reference: { mhpS1: 30, mhpS2: 30 }, ...surcharges });

  it('ajuste la masse d\'un groupe alterné et le signale', () => {
    const groupes = definirMasseHoraire([alterne([avecReference()])], 'GM101', 'M101', 'mhpS1', 18);

    expect(groupes[0].modules[0].mhpS1).toBe(18);
    expect(groupes[0].modules[0].mhpS2).toBe(30);
    expect(groupes[0].modules[0].masseAjustee).toBe(true);
  });

  it('refuse d\'ajuster un groupe résidentiel', () => {
    // Le résidentiel suit la répartition à la lettre : diverger fausserait
    // l'avancement face au référentiel.
    const depart = [groupe('GM101', [avecReference()], { mode: 'Résidentiel' })];
    const groupes = definirMasseHoraire(depart, 'GM101', 'M101', 'mhpS1', 18);

    expect(groupes[0].modules[0].mhpS1).toBe(30);
  });

  it('accepte le mode « Par apprentissage »', () => {
    const depart = [groupe('GM101', [avecReference()], { mode: 'Par apprentissage' })];
    const groupes = definirMasseHoraire(depart, 'GM101', 'M101', 'mhpS2', 12);

    expect(groupes[0].modules[0].mhpS2).toBe(12);
  });

  it('rétablit la masse de la répartition DRIF', () => {
    const depart = [alterne([avecReference({ mhpS1: 18, mhpS2: 10, masseAjustee: true })])];
    const groupes = definirMasseHoraire(depart, 'GM101', 'M101', 'mhpS1', null);

    expect(groupes[0].modules[0]).toMatchObject({ mhpS1: 30, mhpS2: 30, masseAjustee: false });
  });

  it('ramène une valeur négative ou illisible à zéro', () => {
    const groupes = definirMasseHoraire([alterne([avecReference()])], 'GM101', 'M101', 'mhpS1', -5);
    expect(groupes[0].modules[0].mhpS1).toBe(0);

    const autres = definirMasseHoraire([alterne([avecReference()])], 'GM101', 'M101', 'mhpS1', 'n/a');
    expect(autres[0].modules[0].mhpS1).toBe(0);
  });

  it('n\'affecte pas les autres groupes', () => {
    const depart = [alterne([avecReference()]), groupe('GM102', [avecReference()], { mode: 'Alterné' })];
    const groupes = definirMasseHoraire(depart, 'GM101', 'M101', 'mhpS1', 18);

    expect(groupes[1].modules[0].mhpS1).toBe(30);
  });

  it('refuse un champ qui n\'est pas une masse présentielle', () => {
    expect(() => definirMasseHoraire([alterne([avecReference()])], 'GM101', 'M101', 'mhsynS1', 5))
      .toThrow(TypeError);
  });
});

describe('masseModifiable', () => {
  it('distingue les modes qui s\'écartent de la répartition', () => {
    expect(masseModifiable({ mode: 'Alterné' })).toBe(true);
    expect(masseModifiable({ mode: 'Par apprentissage' })).toBe(true);
    expect(masseModifiable({ mode: 'Résidentiel' })).toBe(false);
    expect(masseModifiable({})).toBe(false);
  });
});

describe('projeterSynchrones', () => {
  it('reporte les lignes de plusieurs modules et ensembles', () => {
    const depart = [
      groupe('DEV101', [module('M101'), module('M102')]),
      groupe('DEV201', [module('M201')], { anneeFormation: 2 }),
    ];
    const AUTRE = cleEnsemble({ codeFiliere: 'DEVOWFS_S', anneeFormation: 2 });

    const groupes = projeterSynchrones(depart, {
      [CLE]: {
        M101: [{ formateur: 'AHMED', groupes: ['DEV101'] }],
        M102: [{ formateur: 'FATIMA', groupes: ['DEV101'] }],
      },
      [AUTRE]: { M201: [{ formateur: 'SAID', groupes: ['DEV201'] }] },
    });

    expect(groupes[0].modules[0].formateurSynchrone).toBe('AHMED');
    expect(groupes[0].modules[1].formateurSynchrone).toBe('FATIMA');
    expect(groupes[1].modules[0].formateurSynchrone).toBe('SAID');
  });

  it('ignore une ligne encore vide — elle est en cours de saisie', () => {
    const depart = [groupe('DEV101', [module('M101')])];
    const groupes = projeterSynchrones(depart, {
      [CLE]: { M101: [{ formateur: '', groupes: [] }] },
    });

    expect(groupes[0].modules[0].formateurSynchrone).toBe('');
  });

  it('rend les groupes inchangés pour une table vide', () => {
    const depart = [groupe('DEV101', [module('M101')])];
    expect(projeterSynchrones(depart, {})[0].modules[0].formateurSynchrone).toBe('');
  });
});

describe('défauts synchrones', () => {
  const synchrone = (surcharges = {}) =>
    module('M101', { mhsynS1: 10, mhsynS2: 10, ...surcharges });

  it('propose le formateur présentiel dominant et tous les groupes', () => {
    // Le formateur qui tient déjà le module en présentiel assurera
    // vraisemblablement la séance : c'est la proposition de l'existant.
    const depart = [
      groupe('DEV101', [synchrone({ formateurPresentiel: 'AHMED' })]),
      groupe('DEV102', [synchrone({ formateurPresentiel: 'AHMED' })]),
      groupe('DEV103', [synchrone({ formateurPresentiel: 'FATIMA' })]),
    ];

    expect(defautSynchrone(depart, CLE, 'M101')).toEqual({
      formateur: 'AHMED',
      groupes: ['DEV101', 'DEV102', 'DEV103'],
    });
  });

  it('ne propose rien quand aucun présentiel n\'est affecté', () => {
    const depart = [groupe('DEV101', [synchrone()])];
    expect(defautSynchrone(depart, CLE, 'M101')).toBeNull();
  });

  it('retient le dominant, pas le premier venu', () => {
    const depart = [
      groupe('DEV101', [synchrone({ formateurPresentiel: 'FATIMA' })]),
      groupe('DEV102', [synchrone({ formateurPresentiel: 'AHMED' })]),
      groupe('DEV103', [synchrone({ formateurPresentiel: 'AHMED' })]),
    ];

    expect(formateurPresentielDominant(depart, CLE, 'M101')).toBe('AHMED');
  });
});

describe('synchronesEffectifs', () => {
  const synchrone = (surcharges = {}) =>
    module('M101', { mhsynS1: 10, mhsynS2: 10, ...surcharges });

  it('complète les modules non touchés par la proposition', () => {
    const depart = [groupe('DEV101', [synchrone({ formateurPresentiel: 'AHMED' })])];

    expect(synchronesEffectifs(depart, {})[CLE].M101).toEqual([
      { formateur: 'AHMED', groupes: ['DEV101'] },
    ]);
  });

  it('repart des séances DÉJÀ AFFECTÉES plutôt que de la proposition', () => {
    /*
     * `table` ne porte que ce qui a été touché depuis l'ouverture de l'écran :
     * au rechargement d'une carte enregistrée, elle est VIDE. On retombait donc
     * sur la proposition — formateur présentiel dominant, tous les groupes de
     * l'ensemble — qui écrasait à l'affichage deux séances réellement
     * enregistrées et les faisait réapparaître fusionnées.
     */
    const depart = [
      groupe('DEV101', [
        synchrone({ formateurPresentiel: 'AHMED', formateurSynchrone: 'AHMED', groupeFusion: 'DEV101' }),
      ]),
      groupe('DEV102', [
        synchrone({ formateurPresentiel: 'AHMED', formateurSynchrone: 'AHMED', groupeFusion: 'DEV102' }),
      ]),
    ];

    expect(synchronesEffectifs(depart, {})[CLE].M101).toEqual([
      { formateur: 'AHMED', groupes: ['DEV101'] },
      { formateur: 'AHMED', groupes: ['DEV102'] },
    ]);
  });

  it('laisse le choix explicite l\'emporter, même vide', () => {
    const depart = [groupe('DEV101', [synchrone({ formateurPresentiel: 'AHMED' })])];

    // Tableau vide = « j'ai décidé qu'il n'y a pas de séance ».
    expect(synchronesEffectifs(depart, { [CLE]: { M101: [] } })[CLE].M101).toEqual([]);
  });

  it('ignore un module sans heures synchrones', () => {
    const depart = [groupe('DEV101', [module('M101', { formateurPresentiel: 'AHMED' })])];
    expect(synchronesEffectifs(depart, {})[CLE]).toBeUndefined();
  });

  it('ignore un module désactivé', () => {
    const depart = [
      groupe('DEV101', [synchrone({ formateurPresentiel: 'AHMED', actif: false })]),
    ];
    expect(synchronesEffectifs(depart, {})[CLE]).toBeUndefined();
  });

  it('conserve une entrée explicite portant sur un module absent', () => {
    const depart = [groupe('DEV101', [synchrone()])];
    const table = { [CLE]: { M999: [{ formateur: 'AHMED', groupes: ['DEV101'] }] } };

    expect(synchronesEffectifs(depart, table)[CLE].M999).toEqual(table[CLE].M999);
  });
});

describe('renommerGroupes', () => {
  const RENOMMAGES = [
    { ancien: 'GE101', nouveau: 'GE101 (GC)' },
    { ancien: 'GE102', nouveau: 'GE102 (GC)' },
  ];

  it('renomme le groupe ET la fusion portée par ses modules', () => {
    const depart = [
      groupe('GE101', [module('M1', { formateurSynchrone: 'AHMED', groupeFusion: 'GE101 GE102' })]),
      groupe('GE103', [module('M1')]),
    ];

    const { groupes } = renommerGroupes(depart, {}, RENOMMAGES);

    expect(groupes.map((g) => g.nom)).toEqual(['GE101 (GC)', 'GE103']);
    // Un nom suffixé porte une espace : la fusion se relit avec `separerFusion`.
    expect(groupes[0].modules[0].groupeFusion).toBe('GE101 (GC) GE102 (GC)');
    expect(groupes[1].modules[0]).toBe(depart[1].modules[0]);
  });

  it('renomme les groupes cités par les séances synchrones saisies', () => {
    const table = { [CLE]: { M1: [{ formateur: 'AHMED', groupes: ['GE101', 'GE102', 'GE103'] }] } };

    const resultat = renommerGroupes([], table, RENOMMAGES).table;

    expect(resultat[CLE].M1[0]).toEqual({
      formateur: 'AHMED',
      groupes: ['GE101 (GC)', 'GE102 (GC)', 'GE103'],
    });
    // Sans cela la séance ne couvrait plus aucun groupe existant.
  });

  it('ne touche à rien sans renommage', () => {
    const depart = [groupe('GE101', [])];
    const table = { [CLE]: {} };

    expect(renommerGroupes(depart, table, [])).toEqual({ groupes: depart, table });
    expect(renommerGroupes(depart, table).groupes).toBe(depart);
  });
});
