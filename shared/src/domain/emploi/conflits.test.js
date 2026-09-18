import { TYPES_COURS } from '../../constants/index.js';
import { describe, it, expect } from 'vitest';
import {
  SALLES_SANS_CONFLIT,
  detecterConflits,
  estSalleReelle,
  groupesCompares,
  groupesSeCroisent,
  memeGroupe,
  optionsDuFormateur,
} from './conflits.js';

const posee = (surcharges = {}) => ({
  id: 'existante',
  formateurMatricule: '4211',
  groupe: 'GM102',
  module: 'M102',
  salle: 'B02',
  ...surcharges,
});

const candidate = (surcharges = {}) => ({
  formateurMatricule: '9863',
  groupe: 'GM101',
  module: 'M101',
  salle: 'A12',
  ...surcharges,
});

describe('estSalleReelle', () => {
  it('⚠️ TEAMS et ABSENT ne sont PAS des salles', () => {
    /*
     * « TEAMS » désigne une séance à distance : il n'y a pas de local à occuper,
     * et dix groupes peuvent l'employer en même temps. Les traiter comme des
     * salles ferait refuser toutes les séances à distance de la semaine à partir
     * de la deuxième.
     */
    expect(estSalleReelle('TEAMS')).toBe(false);
    expect(estSalleReelle('absent')).toBe(false);
    expect(SALLES_SANS_CONFLIT).toEqual(['TEAMS', 'ABSENT']);
  });

  it('une salle vide n’occupe rien', () => {
    expect(estSalleReelle('')).toBe(false);
    expect(estSalleReelle(null)).toBe(false);
  });

  it('reconnaît une vraie salle', () => {
    expect(estSalleReelle('A12')).toBe(true);
  });
});

describe('memeGroupe', () => {
  it('⚠️ « GE102 (GC) » et « GE102 » sont LE MÊME groupe', () => {
    /*
     * Le suffixe de secteur est ajouté après coup : une séance saisie avant
     * porte encore le nom nu. Sans ce rapprochement, on pourrait placer deux
     * cours au même moment pour les mêmes stagiaires.
     */
    expect(memeGroupe('GE102 (GC)', 'GE102')).toBe(true);
    expect(memeGroupe('GE102', 'GE102 (GC)')).toBe(true);
  });

  it('⚠️⚠️ « GE101 (GC) » et « GE101 (GE) » sont DEUX groupes', () => {
    // Le cas signalé par le porteur (2026-09-11) : Gestion des Entreprises et
    // Génie électrique. Retirer tout suffixe les confondait.
    expect(memeGroupe('GE101 (GC)', 'GE101 (GE)')).toBe(false);
    expect(memeGroupe('GE101 (CDS)', 'GE101 (GC)')).toBe(false);
  });

  it('un suffixe ajouté par-dessus un autre reste la même classe', () => {
    expect(memeGroupe('GE101 (CDS)', 'GE101 (CDS) (GE)')).toBe(true);
    expect(memeGroupe('ge101  (gc)', 'GE101 (GC)')).toBe(true);
  });

  it('deux bases différentes ne se rapprochent jamais', () => {
    expect(memeGroupe('GE101', 'GE102')).toBe(false);
    expect(memeGroupe('', '')).toBe(false);
  });
});

describe('groupesSeCroisent', () => {
  it('compare membre à membre, fusions comprises', () => {
    expect(groupesSeCroisent('GE101 (GC) GE102 (GC)', 'GE102')).toBe(true);
    expect(groupesSeCroisent('GE101 (GC) GE102 (GC)', 'GE101 (GE) GE102 (GE)')).toBe(false);
  });
});

describe('groupesCompares', () => {
  it('rend les noms ENTIERS, sans leur forme nue', () => {
    // La forme nue dans l'ensemble, c'est ce qui croisait GE101 (GC) et
    // GE101 (GE) : la comparaison passe désormais par `memeGroupe`.
    expect([...groupesCompares('GE102 (GC)')]).toEqual(['GE102 (GC)']);
  });

  it('sépare une FUSION sans casser un suffixe', () => {
    // Découper sur les espaces casserait « ACADA101 (FQ) » en deux groupes
    // fantômes — c'est le défaut déjà rencontré sur la carte.
    const groupes = groupesCompares('GM101 GM102');
    expect(groupes.has('GM101')).toBe(true);
    expect(groupes.has('GM102')).toBe(true);

    expect(groupesCompares('ACADA101 (FQ)').has('ACADA101 (FQ)')).toBe(true);
  });

  it('rend un ensemble vide sur une valeur vide', () => {
    expect(groupesCompares('').size).toBe(0);
  });
});

describe('detecterConflits', () => {
  it('laisse poser quand le créneau est libre', () => {
    expect(detecterConflits(candidate(), [])).toEqual([]);
  });

  it('refuse un FORMATEUR déjà occupé', () => {
    const conflits = detecterConflits(candidate(), [posee({ formateurMatricule: '9863' })]);
    expect(conflits.map((c) => c.type)).toContain('formateur');
    expect(conflits[0].message).toContain('M102');
  });

  it('refuse un GROUPE déjà en cours', () => {
    const conflits = detecterConflits(candidate(), [posee({ groupe: 'GM101' })]);
    expect(conflits.map((c) => c.type)).toContain('groupe');
  });

  it('refuse un groupe MASQUÉ PAR SON SUFFIXE', () => {
    const conflits = detecterConflits(candidate({ groupe: 'GM101 (CDS)' }), [
      posee({ groupe: 'GM101' }),
    ]);
    expect(conflits.map((c) => c.type)).toContain('groupe');
  });

  it('⚠️⚠️ LAISSE POSER deux filières homonymes sur le même créneau', () => {
    // Capture du porteur : LAASAL a « GE101 (GE) GE102 (GE) » en S2, et la
    // séance de « GE101 (GC) … GE104 (GC) » était marquée PRIS.
    const conflits = detecterConflits(
      candidate({ groupe: 'GE101 (GC) GE102 (GC) GE103 (GC) GE104 (GC)', salle: 'TEAMS' }),
      [posee({ groupe: 'GE101 (GE) GE102 (GE)', salle: 'TEAMS' })]
    );
    expect(conflits).toEqual([]);
  });

  it('mais refuse toujours le nom nu face au nom suffixé', () => {
    const conflits = detecterConflits(candidate({ groupe: 'GE101 (GC)' }), [
      posee({ groupe: 'GE101' }),
    ]);
    expect(conflits.map((c) => c.type)).toContain('groupe');
  });

  it('refuse une SALLE occupée', () => {
    const conflits = detecterConflits(candidate(), [posee({ salle: 'A12' })]);
    expect(conflits.map((c) => c.type)).toContain('salle');
    expect(conflits.find((c) => c.type === 'salle').message).toContain('A12');
  });

  it('⚠️ la salle est occupée MÊME sans groupe en face', () => {
    // C'est la correction que l'existant porte en toutes lettres : la présence
    // d'un groupe n'est pas requise pour que le local soit pris.
    const conflits = detecterConflits(candidate(), [posee({ groupe: '', salle: 'A12' })]);
    expect(conflits.map((c) => c.type)).toContain('salle');
  });

  it('⚠️ N’OPPOSE PAS deux séances TEAMS', () => {
    const conflits = detecterConflits(candidate({ salle: 'TEAMS' }), [posee({ salle: 'TEAMS' })]);
    expect(conflits.map((c) => c.type)).not.toContain('salle');
  });

  it('ne s’oppose PAS à elle-même quand on la modifie', () => {
    // Corriger le module d'une séance existante ne doit pas buter sur sa propre
    // salle ni sur son propre groupe.
    const conflits = detecterConflits(
      { id: 'existante', ...posee({ module: 'AUTRE' }) },
      [posee()]
    );
    expect(conflits).toEqual([]);
  });

  it('rapporte TOUS les conflits, pas seulement le premier', () => {
    // Un seul message enverrait corriger la salle, puis découvrir le groupe :
    // deux allers-retours pour une seule saisie.
    const conflits = detecterConflits(candidate(), [
      posee({ formateurMatricule: '9863', groupe: 'GM101', salle: 'A12' }),
    ]);
    expect(conflits.map((c) => c.type).sort()).toEqual(['formateur', 'groupe', 'salle']);
  });
});

describe('optionsDuFormateur', () => {
  const affectations = [
    { formateur: '9863', groupe: 'GM101', module: 'M101' },
    { formateur: '9863', groupe: 'GM101', module: 'M102' },
    { formateur: '9863', groupe: 'GM101 GM102', module: 'M103' },
    { formateur: '4211', groupe: 'PM101', module: 'M201' },
  ];

  it('⚠️ n’offre QUE ce à quoi il est affecté', () => {
    /*
     * Offrir tous les groupes reviendrait à laisser poser un cours que personne
     * n'a été affecté à donner — et l'avancement compterait des heures que le
     * chronogramme n'a jamais prévues.
     */
    const { groupes } = optionsDuFormateur(affectations, '9863');
    expect(groupes).not.toContain('PM101');
  });

  it('rend les modules DE CHAQUE groupe', () => {
    const { modulesParGroupe } = optionsDuFormateur(affectations, '9863');
    expect(modulesParGroupe.get('GM101')).toEqual(['M101', 'M102', 'M103']);
  });

  it('propose le libellé FUSIONNÉ en plus de ses membres', () => {
    // C'est lui qu'on choisit pour une séance à distance mutualisée ; ses
    // membres restent proposés séparément pour le présentiel.
    const { groupes, modulesParGroupe } = optionsDuFormateur(affectations, '9863');

    expect(groupes).toContain('GM101 GM102');
    expect(modulesParGroupe.get('GM101 GM102')).toEqual(['M103']);
    expect(modulesParGroupe.get('GM102')).toEqual(['M103']);
  });

  it('rend vide pour un formateur sans affectation', () => {
    expect(optionsDuFormateur(affectations, 'INCONNU').groupes).toEqual([]);
  });
});

describe('optionsDuFormateur — filtre par TYPE de séance', () => {
  const affectations = [
    { formateur: '9863', groupe: 'GM101', module: 'M101', type: TYPES_COURS.PRESENTIEL },
    { formateur: '9863', groupe: 'GM102', module: 'M101', type: TYPES_COURS.PRESENTIEL },
    { formateur: '9863', groupe: 'GM101 GM102', module: 'M101', type: TYPES_COURS.SYNCHRONE },
  ];

  it('⚠️ le PRÉSENTIEL n’offre PAS le libellé fusionné', () => {
    // On ne réunit pas deux classes dans une salle.
    const { groupes } = optionsDuFormateur(affectations, '9863', {
      type: TYPES_COURS.PRESENTIEL,
    });

    expect(groupes).toEqual(['GM101', 'GM102']);
  });

  it('⚠️ le SYNCHRONE n’offre QUE le libellé fusionné, jamais ses membres', () => {
    /*
     * Poser « GM101 » seul en TEAMS alors que la carte a fusionné les deux
     * groupes créerait une séance qui ne couvre plus qu'un groupe — l'autre
     * n'aurait jamais ce cours, sans que rien ne le signale.
     */
    const { groupes } = optionsDuFormateur(affectations, '9863', {
      type: TYPES_COURS.SYNCHRONE,
    });

    expect(groupes).toEqual(['GM101 GM102']);
  });

  it('un synchrone NON fusionné reste proposé tel quel', () => {
    const { groupes } = optionsDuFormateur(
      [{ formateur: '9863', groupe: 'GM101', module: 'M101', type: TYPES_COURS.SYNCHRONE }],
      '9863',
      { type: TYPES_COURS.SYNCHRONE }
    );

    expect(groupes).toEqual(['GM101']);
  });

  it('SANS filtre — le cas du serveur — rend l’UNION des deux formes', () => {
    // La route doit accepter aussi bien la séance en salle que la mutualisée.
    const { groupes } = optionsDuFormateur(affectations, '9863');

    expect(groupes).toEqual(['GM101', 'GM101 GM102', 'GM102']);
  });

  it('les modules suivent le type : le module d’un groupe seul disparaît en synchrone', () => {
    const synchrone = optionsDuFormateur(affectations, '9863', { type: TYPES_COURS.SYNCHRONE });

    expect(synchrone.modulesParGroupe.get('GM101')).toBeUndefined();
    expect(synchrone.modulesParGroupe.get('GM101 GM102')).toEqual(['M101']);
  });
});

describe('Groupes FQ — un groupe virtuel occupe ses groupes réels', () => {
  /*
   * Le cas de production : APILC101 (FQ) est composé d'EEM101 et EEM102.
   * ← fq_group_mappings + getImpactedGroups() de emploi.html
   */
  const composition = [
    { groupeFq: 'APILC101 (FQ)', groupeConstituant: 'EEM101' },
    { groupeFq: 'APILC101 (FQ)', groupeConstituant: 'EEM102' },
  ];

  it('le FQ entraîne ses constituants', () => {
    expect(groupesCompares('APILC101 (FQ)', composition)).toContain('EEM101');
    expect(groupesCompares('APILC101 (FQ)', composition)).toContain('EEM102');
  });

  /*
   * ⚠️ LE CONSTITUANT NE REMONTE PAS À SON FQ, et c'est voulu : le FQ
   * descend déjà jusqu'à lui, et une intersection est symétrique. Remonter en
   * plus ferait se croiser deux constituants SUR LEUR PARENT.
   */
  it('⚠️ un constituant ne remonte PAS à son FQ — inutile, et néfaste', () => {
    expect(groupesCompares('EEM101', composition)).not.toContain('APILC101 (FQ)');
  });

  /*
   * ⚠️⚠️ LE SAUT EST UNIQUE : deux constituants d'un même FQ sont deux
   * CLASSES DISTINCTES. Les rendre solidaires interdirait à EEM102 d'avoir cours
   * pendant qu'EEM101 en a — ce que rien ne justifie.
   */
  it('⚠️ mais deux constituants du même FQ ne s’entraînent PAS l’un l’autre', () => {
    expect(groupesCompares('EEM101', composition)).not.toContain('EEM102');
  });

  it('poser un cours sur le FQ entre en conflit avec un cours d’un constituant', () => {
    const conflits = detecterConflits(
      candidate({ groupe: 'APILC101 (FQ)', salle: 'A01' }),
      [posee({ groupe: 'EEM101', salle: 'B02' })],
      { groupesFq: composition }
    );

    expect(conflits.map((c) => c.type)).toEqual(['groupe']);
  });

  it('et l’inverse aussi — la comparaison est symétrique', () => {
    const conflits = detecterConflits(
      candidate({ groupe: 'EEM101', salle: 'A01' }),
      [posee({ groupe: 'APILC101 (FQ)', salle: 'B02' })],
      { groupesFq: composition }
    );

    expect(conflits.map((c) => c.type)).toEqual(['groupe']);
  });

  it('deux constituants différents peuvent avoir cours en même temps', () => {
    const conflits = detecterConflits(
      candidate({ groupe: 'EEM102', salle: 'A01' }),
      [posee({ groupe: 'EEM101', salle: 'B02' })],
      { groupesFq: composition }
    );

    expect(conflits).toEqual([]);
  });

  /*
   * ⚠️ LE SUFFIXE NE DOIT PAS FAIRE RATER LE LIEN. La composition est saisie
   * avec le nom complet (« APILC101 (FQ) »), mais une séance peut porter le nom
   * sans suffixe — c'est déjà la règle de `groupesCompares`.
   */
  it('⚠️ le lien se fait aussi sur le nom sans suffixe', () => {
    // « APILC101 » désigne le même FQ que « APILC101 (FQ) ».
    const conflits = detecterConflits(
      candidate({ groupe: 'APILC101', salle: 'A01' }),
      [posee({ groupe: 'EEM101', salle: 'B02' })],
      { groupesFq: composition }
    );

    expect(conflits.map((c) => c.type)).toEqual(['groupe']);
  });

  it('une FUSION qui contient un constituant heurte le FQ', () => {
    const conflits = detecterConflits(
      candidate({ groupe: 'EEM101 EEM103', salle: 'A01' }),
      [posee({ groupe: 'APILC101 (FQ)', salle: 'B02' })],
      { groupesFq: composition }
    );

    expect(conflits.map((c) => c.type)).toEqual(['groupe']);
  });

  /*
   * ⚠️ UN GROUPE PEUT COMPOSER PLUSIEURS FQ (décision du porteur) : on remonte
   * à CHACUN de ses parents, comme la boucle de l'existant.
   */
  it('⚠️ un groupe partagé par deux FQ les rend incompatibles entre eux', () => {
    const partage = [
      { groupeFq: 'APILC101 (FQ)', groupeConstituant: 'EEM101' },
      { groupeFq: 'BUREA201 (FQ)', groupeConstituant: 'EEM101' },
    ];

    // Les deux FQ réunissent les mêmes stagiaires : ils ne peuvent pas siéger
    // ensemble, et chacun heurte le groupe partagé.
    const conflits = detecterConflits(
      candidate({ groupe: 'APILC101 (FQ)', salle: 'A01' }),
      [posee({ groupe: 'BUREA201 (FQ)', salle: 'B02' })],
      { groupesFq: partage }
    );

    expect(conflits.map((c) => c.type)).toEqual(['groupe']);
  });

  it('sans composition déclarée, rien ne change', () => {
    expect(detecterConflits(
      candidate({ groupe: 'APILC101 (FQ)', salle: 'A01' }),
      [posee({ groupe: 'EEM101', salle: 'B02' })]
    )).toEqual([]);
  });

  /*
   * ⚠️ L'INDEX EST MÉMORISÉ SUR LA RÉFÉRENCE DU TABLEAU : la grille appelle
   * cette fonction pour chaque case. Une composition MODIFIÉE doit donc être un
   * NOUVEAU tableau — ce que rend le cache de requêtes — sans quoi le changement
   * ne serait pas vu. Ce test fige les deux moitiés de la règle.
   */
  it('⚠️ une composition modifiée (nouveau tableau) est bien reprise', () => {
    const avant = [{ groupeFq: 'APILC101 (FQ)', groupeConstituant: 'EEM101' }];
    expect(groupesCompares('APILC101 (FQ)', avant)).not.toContain('EEM102');

    const apres = [...avant, { groupeFq: 'APILC101 (FQ)', groupeConstituant: 'EEM102' }];
    expect(groupesCompares('APILC101 (FQ)', apres)).toContain('EEM102');
  });

  it('le même tableau interrogé deux fois rend le même résultat', () => {
    const premier = groupesCompares('APILC101 (FQ)', composition);
    const second = groupesCompares('APILC101 (FQ)', composition);
    expect([...second].sort()).toEqual([...premier].sort());
  });

  it('une composition mal formée ne fait pas tomber la détection', () => {
    expect(() =>
      groupesCompares('EEM101', [{ groupeFq: '', groupeConstituant: null }])
    ).not.toThrow();
  });
});
