import { describe, it, expect } from 'vitest';
import { carteVersLignesEnote,
  modulesInactifs, NB_COLONNES, nomsGroupesDeLaCarte } from './lignesEnote.js';
import { cleGroupeLigne, construireBase } from '../enote/parseBase.js';

const MAINTENANT = new Date(2026, 7, 15, 9, 5, 3); // 15/08/2026 09:05:03

function carteMinimale(surcharges = {}) {
  return {
    formateurs: [{ nom: 'AHMED CHERKAOUI', matricule: '9863' }],
    groupes: [
      {
        nom: 'DEVOWFS201',
        codeFiliere: 'DEVOWFS_S',
        intituleFiliere: 'Développement Full Stack',
        anneeFormation: 2,
        niveau: 'TS',
        secteur: 'Digital',
        typeFormation: 'Diplômante',
        creneau: 'CDJ',
        mode: 'Résidentiel',
        modules: [
          {
            code: 'M201',
            nom: 'Programmation',
            mhpS1: 30,
            mhpS2: 30,
            mhsynS1: 10,
            mhsynS2: 10,
            mhasynS1: 5,
            mhasynS2: 5,
            estRegional: true,
            formateurPresentiel: 'AHMED CHERKAOUI',
          },
        ],
      },
    ],
    ...surcharges,
  };
}

describe('carteVersLignesEnote', () => {
  it('produit une ligne de 51 colonnes par module', () => {
    const lignes = carteVersLignesEnote(carteMinimale(), 2026, { maintenant: MAINTENANT });

    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toHaveLength(NB_COLONNES);
  });

  it('place chaque valeur à la colonne que l\'import lit', () => {
    const [ligne] = carteVersLignesEnote(carteMinimale(), 2026, { maintenant: MAINTENANT });

    expect(ligne[0]).toBe('15/08/2026 09:05:03');
    expect(ligne[1]).toBe('2026');
    expect(ligne[2]).toBe('TS');
    expect(ligne[3]).toBe('Digital');
    expect(ligne[4]).toBe('DEVOWFS_S');
    expect(ligne[8]).toBe('DEVOWFS201');
    expect(ligne[14]).toBe('2');
    expect(ligne[15]).toBe('Résidentiel');
    expect(ligne[16]).toBe('M201');
    expect(ligne[18]).toBe('O');
    expect(ligne[19]).toBe('9863');
    expect(ligne[20]).toBe('AHMED CHERKAOUI');
  });

  it('calcule les totaux horaires par semestre', () => {
    const [ligne] = carteVersLignesEnote(carteMinimale(), 2026, { maintenant: MAINTENANT });

    expect(ligne[26]).toBe(45); // S1 : 30 + 10 + 5
    expect(ligne[30]).toBe(45); // S2
    expect(ligne[31]).toBe(60); // MHP totale
    expect(ligne[32]).toBe(20); // MHSYN totale
    expect(ligne[34]).toBe(90); // MH totale
  });

  it('ne compte comme affectée que la masse d\'un module réellement affecté', () => {
    const carte = carteMinimale();
    const [avec] = carteVersLignesEnote(carte, 2026, { maintenant: MAINTENANT });
    expect(avec[35]).toBe(60);
    expect(avec[36]).toBe(0); // aucun formateur synchrone
    expect(avec[37]).toBe(60);

    carte.groupes[0].modules[0].formateurPresentiel = '';
    const [sans] = carteVersLignesEnote(carte, 2026, { maintenant: MAINTENANT });
    expect(sans[35]).toBe(0);
  });

  it('laisse le matricule vide pour un formateur absent de la liste', () => {
    const carte = carteMinimale({ formateurs: [] });
    const [ligne] = carteVersLignesEnote(carte, 2026, { maintenant: MAINTENANT });

    expect(ligne[19]).toBe('');
    expect(ligne[20]).toBe('AHMED CHERKAOUI'); // l'import retombera sur le nom
  });

  it('retire le suffixe que l\'import recalcule, et garde celui qu\'il ignore', () => {
    const soir = carteMinimale();
    soir.groupes[0].nom = 'BECM101 (CDS)';
    soir.groupes[0].codeFiliere = 'GM_BECM_TS_RCDS';
    expect(carteVersLignesEnote(soir, 2026, { maintenant: MAINTENANT })[0][8]).toBe('BECM101');

    // (FGT) est le premier segment du code : l'import le redéduira.
    const ambigu = carteMinimale();
    ambigu.groupes[0].nom = 'GE101 (FGT)';
    ambigu.groupes[0].codeFiliere = 'FGT_GE_TS';
    expect(carteVersLignesEnote(ambigu, 2026, { maintenant: MAINTENANT })[0][8]).toBe('GE101');

    // Celui-ci n'est déductible d'aucun code : il reste.
    const etranger = carteMinimale();
    etranger.groupes[0].nom = 'GE101 (SOIR)';
    etranger.groupes[0].codeFiliere = 'FGT_GE_TS';
    expect(carteVersLignesEnote(etranger, 2026, { maintenant: MAINTENANT })[0][8]).toBe(
      'GE101 (SOIR)'
    );
  });

  it('trie les groupes naturellement — DEV102 après DEV2', () => {
    const carte = carteMinimale();
    const modele = carte.groupes[0];
    carte.groupes = [
      { ...modele, nom: 'DEV102' },
      { ...modele, nom: 'DEV2' },
      { ...modele, nom: 'DEV11' },
    ];

    const noms = carteVersLignesEnote(carte, 2026, { maintenant: MAINTENANT }).map((l) => l[8]);
    expect(noms).toEqual(['DEV2', 'DEV11', 'DEV102']);
  });

  it('laisse à 0 les deux colonnes que seul le serveur connaît', () => {
    const [ligne] = carteVersLignesEnote(carteMinimale(), 2026, { maintenant: MAINTENANT });
    expect(ligne[9]).toBe(0); // effectif du groupe
    expect(ligne[13]).toBe(0); // code de fusion
  });

  it('remet à zéro le réalisé — une carte neuve n\'a rien réalisé', () => {
    const [ligne] = carteVersLignesEnote(carteMinimale(), 2026, { maintenant: MAINTENANT });
    expect([ligne[41], ligne[42], ligne[43], ligne[45]]).toEqual([0, 0, 0, 0]);
  });

  it('rejette une carte sans tableau de groupes', () => {
    expect(() => carteVersLignesEnote({}, 2026)).toThrow(TypeError);
    expect(() => carteVersLignesEnote(null, 2026)).toThrow(TypeError);
  });

  it('accepte un module sans masse horaire ni formateur', () => {
    const carte = carteMinimale();
    carte.groupes[0].modules = [{ code: 'M202', nom: 'Stage' }];

    const [ligne] = carteVersLignesEnote(carte, 2026, { maintenant: MAINTENANT });
    expect(ligne[16]).toBe('M202');
    expect(ligne[18]).toBe('N');
    expect(ligne[34]).toBe(0);
  });
});

describe('la carte manuelle et l\'import e-note produisent la même base', () => {
  it('construireBase accepte les lignes de la carte sans traitement particulier', () => {
    const carte = carteMinimale();
    carte.groupes.push({
      ...carte.groupes[0],
      nom: 'DEVOWFS202',
      modules: [
        {
          code: 'M202',
          nom: 'Base de données',
          mhpS1: 20,
          mhpS2: 20,
          formateurPresentiel: 'FATIMA BENALI',
        },
      ],
    });
    carte.formateurs.push({ nom: 'FATIMA BENALI', matricule: '10241' });

    const lignes = carteVersLignesEnote(carte, 2026, { maintenant: MAINTENANT });
    const base = construireBase(lignes);

    expect(base.groupes).toEqual(['DEVOWFS201', 'DEVOWFS202']);
    expect(base.formateurs.map((f) => f.matricule)).toEqual(['9863', '10241']);
    expect(base.affectations).toHaveLength(2);
    expect(base.affectations[0]).toMatchObject({
      formateur: '9863',
      groupe: 'DEVOWFS201',
      module: 'M201',
    });
  });
});

describe('nomsGroupesDeLaCarte — les noms de la carte survivent à l’enregistrement', () => {
  /*
   * Le cas exact signalé par le porteur (2026-09-11) : Gestion des Entreprises
   * (GC_GE_TS, quatre groupes) et Génie électrique (GE_GE_TS, deux groupes)
   * partagent le préfixe « GE ». La carte suffixe les SIX groupes ; le parseur
   * de l'import ne suffixait que les noms en collision, GE101 et GE102.
   */
  function carteHomonymes() {
    const modele = carteMinimale().groupes[0];
    const groupe = (nom, codeFiliere, mode = 'Résidentiel') => ({
      ...modele,
      nom,
      codeFiliere,
      anneeFormation: 1,
      mode,
      modules: [{ code: 'EGTS101', nom: 'Arabe', mhpS1: 15, formateurPresentiel: 'AHMED CHERKAOUI' }],
    });

    return carteMinimale({
      groupes: [
        groupe('GE101 (GC)', 'GC_GE_TS'),
        groupe('GE102 (GC)', 'GC_GE_TS'),
        groupe('GE103 (GC)', 'GC_GE_TS'),
        groupe('GE104 (GC)', 'GC_GE_TS', 'Alterné'),
        groupe('GE101 (GE)', 'GE_GE_TS'),
        groupe('GE102 (GE)', 'GE_GE_TS'),
      ],
    });
  }

  it('sans elle, le parseur défaisait le suffixe des groupes sans homonyme — le défaut', () => {
    const lignes = carteVersLignesEnote(carteHomonymes(), 2026, { maintenant: MAINTENANT });
    const base = construireBase(lignes);

    // GE103 et GE104 perdaient leur « (GC) » : c'est ce qui créait les fantômes.
    expect(base.groupes).toContain('GE103');
    expect(base.groupes).not.toContain('GE103 (GC)');
  });

  it('impose les six noms de la carte, suffixe compris', () => {
    const carte = carteHomonymes();
    const lignes = carteVersLignesEnote(carte, 2026, { maintenant: MAINTENANT });
    const base = construireBase(lignes, { nomsGroupes: nomsGroupesDeLaCarte(carte) });

    expect(base.groupes).toEqual([
      'GE101 (GC)',
      'GE101 (GE)',
      'GE102 (GC)',
      'GE102 (GE)',
      'GE103 (GC)',
      'GE104 (GC)',
    ]);
    // Les affectations et les modes suivent le même nom — sinon ils seraient
    // rangés sous un groupe qui n'existe pas.
    expect(new Set(base.affectations.map((a) => a.groupe))).toEqual(new Set(base.groupes));
    expect(base.groupeModes['GE104 (GC)']).toBe('Alterné');
  });

  it('respecte aussi un renommage REFUSÉ : les anciens groupes restent sans suffixe', () => {
    const carte = carteHomonymes();
    carte.groupes = carte.groupes.map((g) =>
      g.codeFiliere === 'GC_GE_TS' ? { ...g, nom: g.nom.replace(' (GC)', '') } : g
    );

    const lignes = carteVersLignesEnote(carte, 2026, { maintenant: MAINTENANT });
    const base = construireBase(lignes, { nomsGroupes: nomsGroupesDeLaCarte(carte) });

    expect(base.groupes).toEqual(['GE101', 'GE101 (GE)', 'GE102', 'GE102 (GE)', 'GE103', 'GE104']);
  });

  it('garde les suffixes que l’import recalcule — cours du soir', () => {
    const carte = carteMinimale();
    carte.groupes[0].nom = 'BECM101 (CDS)';
    carte.groupes[0].codeFiliere = 'GM_BECM_TS_RCDS';

    const lignes = carteVersLignesEnote(carte, 2026, { maintenant: MAINTENANT });
    const base = construireBase(lignes, { nomsGroupes: nomsGroupesDeLaCarte(carte) });

    expect(base.groupes).toEqual(['BECM101 (CDS)']);
  });

  it('indexe par code filière ET nom brut : deux filières homonymes restent distinctes', () => {
    const noms = nomsGroupesDeLaCarte(carteHomonymes());

    expect(noms.get(cleGroupeLigne('GC_GE_TS', 'GE101'))).toBe('GE101 (GC)');
    expect(noms.get(cleGroupeLigne('GE_GE_TS', 'GE101'))).toBe('GE101 (GE)');
    expect(nomsGroupesDeLaCarte()).toEqual(new Map());
  });
});

describe('modulesInactifs', () => {
  const carte = (modules) => ({ groupes: [{ nom: 'GM101', modules }] });

  it('relève les modules désactivés, par groupe', () => {
    expect(
      modulesInactifs(carte([{ code: 'M101', actif: false }, { code: 'M102' }]))
    ).toEqual({ GM101: ['M101'] });
  });

  it('un module SANS le champ vaut ACTIF', () => {
    // Les modules issus de la répartition DRIF n'ont pas ce champ : les traiter
    // comme désactivés viderait la carte entière au premier enregistrement.
    expect(modulesInactifs(carte([{ code: 'M101' }, { code: 'M102', actif: true }]))).toEqual({});
  });

  it('n’écrit RIEN pour un groupe sans module désactivé', () => {
    // Une entrée vide par groupe gonflerait le document sans rien dire de plus.
    expect(modulesInactifs(carte([{ code: 'M101' }]))).toEqual({});
  });

  it('tolère une carte vide', () => {
    expect(modulesInactifs()).toEqual({});
    expect(modulesInactifs({ groupes: [] })).toEqual({});
  });
});
